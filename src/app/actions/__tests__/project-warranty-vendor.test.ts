import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), getCloudflareContext: vi.fn() }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, getCurrentUser: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/lib/project-access", () => ({ assertProjectAccess: vi.fn().mockResolvedValue({ organizationId: "org-a" }) }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: vi.fn() }))
vi.mock("@/lib/notifications/events", () => ({ notifyWarrantyClaimUpdated: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { getVendorWarrantyWorkspace, updateVendorWarrantyClaim } from "../project-warranty-vendor"
import { openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "../../../../__tests__/helpers/correspondence-core"

let database: CorrespondenceTestDatabase | null = null
afterEach(() => {
  database?.close()
  database = null
  vi.clearAllMocks()
})

const now = "2026-10-09T12:00:00.000Z"

function open(): CorrespondenceTestDatabase {
  const db = openCorrespondenceTestDatabase()
  db.sqlite.exec(`
    CREATE TABLE vendors (id TEXT PRIMARY KEY, name TEXT NOT NULL, organization_id TEXT);
    ALTER TABLE project_contacts ADD COLUMN vendor_id TEXT;
    ALTER TABLE project_contacts ADD COLUMN vendor_contact_id TEXT;
    CREATE TABLE project_access_invitations (id TEXT PRIMARY KEY, project_id TEXT, project_contact_id TEXT, accepted_by TEXT, status TEXT, accepted_at TEXT);
    INSERT INTO users (id,email,first_name,last_name,display_name,role,is_active,created_at,updated_at) VALUES
      ('ted','ted@tedsplumbing.test','Ted','P','Ted P','subcontractor',1,'${now}','${now}'),
      ('ann','ann@tedsplumbing.test','Ann','T','Ann T','subcontractor',1,'${now}','${now}'),
      ('bob','bob@otherelectric.test','Bob','E','Bob E','subcontractor',1,'${now}','${now}');
    INSERT INTO project_members (id,project_id,user_id,role,assigned_at) VALUES
      ('pm-ted','project-a','ted','subcontractor','${now}'),
      ('pm-ann','project-a','ann','subcontractor','${now}'),
      ('pm-bob','project-a','bob','subcontractor','${now}');
    INSERT INTO vendors (id,name,organization_id) VALUES ('v-ted','Ted''s Plumbing & Hydronics','org-a'),('v-bob','Other Electric','org-a');
    INSERT INTO project_contacts (id,project_id,contact_type,display_name,email,company_name,vendor_id) VALUES
      ('pc-ted','project-a','subcontractor','Ted P','ted@tedsplumbing.test','Ted''s Plumbing & Hydronics','v-ted'),
      ('pc-ann','project-a','subcontractor','Ann T','ann@tedsplumbing.test','Ted''s Plumbing & Hydronics','v-ted'),
      ('pc-bob','project-a','subcontractor','Bob E','bob@otherelectric.test','Other Electric','v-bob');
  `)
  for (const file of ["drizzle/0109_warranty_claims.sql", "drizzle/0198_warranty_assigned_contact.sql"]) {
    db.sqlite.exec(readFileSync(resolve(process.cwd(), file), "utf8").replaceAll("--> statement-breakpoint", ""))
  }
  db.sqlite.exec(`
    INSERT INTO project_warranty_claims (id,organization_id,project_id,claim_number,title,category,description,claimant_name,assigned_name,assigned_project_contact_id,assigned_vendor_id,internal_notes,submitted_at,created_at,updated_at)
    VALUES
      ('w-ted','org-a','project-a','A-1-W-001','Boiler error messages','Plumbing','E110 ignition failure','Ted Shultz','Ted''s Plumbing & Hydronics','pc-ted','v-ted','office-only note','${now}','${now}','${now}'),
      ('w-bob','org-a','project-a','A-1-W-002','Breaker trips','Electrical','Kitchen circuit','Ted Shultz','Other Electric',NULL,'v-bob',NULL,'${now}','${now}','${now}'),
      ('w-none','org-a','project-a','A-1-W-003','Door sticks','Carpentry','Front door','Ted Shultz',NULL,NULL,NULL,NULL,'${now}','${now}','${now}');
  `)
  mocks.getCloudflareContext.mockResolvedValue({ env: { DB: db.d1 } })
  return db
}

function as(id: string, email: string): void {
  mocks.requireAuth.mockResolvedValue({ id, email, role: "subcontractor", organizationId: "org-a", displayName: id })
}

describe("vendor warranty access", () => {
  it("shows a vendor only claims assigned to them or their company, without internal notes", async () => {
    database = open()
    as("ted", "ted@tedsplumbing.test")
    const ted = await getVendorWarrantyWorkspace("project-a")
    expect(ted.claims.map((claim) => claim.id)).toEqual(["w-ted"])
    expect(JSON.stringify(ted)).not.toContain("office-only note")
    // A coworker at the same company sees the company's claim too.
    as("ann", "ann@tedsplumbing.test")
    expect((await getVendorWarrantyWorkspace("project-a")).claims.map((claim) => claim.id)).toEqual(["w-ted"])
    as("bob", "bob@otherelectric.test")
    expect((await getVendorWarrantyWorkspace("project-a")).claims.map((claim) => claim.id)).toEqual(["w-bob"])
  })

  it("lets the assigned vendor update visit, status and an owner-visible note", async () => {
    database = open()
    as("ted", "ted@tedsplumbing.test")
    const result = await updateVendorWarrantyClaim("project-a", "w-ted", { status: "visit_scheduled", scheduledFor: "2026-10-14T09:00", note: "Will bring a new igniter and check gas pressure." })
    expect(result).toEqual({ success: true })
    const row = database.sqlite.prepare("SELECT status, scheduled_for, priority, assigned_name, internal_notes FROM project_warranty_claims WHERE id='w-ted'").get()
    expect(row).toMatchObject({ status: "visit_scheduled", scheduled_for: "2026-10-14T09:00", priority: "normal", internal_notes: "office-only note" })
    const event = database.sqlite.prepare("SELECT note, owner_visible FROM project_warranty_claim_events WHERE claim_id='w-ted'").get()
    expect(event).toMatchObject({ note: "Will bring a new igniter and check gas pressure.", owner_visible: 1 })
  })

  it("refuses claims assigned to someone else and statuses vendors don't set", async () => {
    database = open()
    as("bob", "bob@otherelectric.test")
    expect(await updateVendorWarrantyClaim("project-a", "w-ted", { status: "in_progress", scheduledFor: null, note: null }))
      .toEqual({ success: false, error: "This claim isn't assigned to you." })
    as("ted", "ted@tedsplumbing.test")
    expect((await updateVendorWarrantyClaim("project-a", "w-ted", { status: "closed", scheduledFor: null, note: null })).success).toBe(false)
  })
})
