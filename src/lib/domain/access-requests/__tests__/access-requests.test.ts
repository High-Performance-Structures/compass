import Database from "better-sqlite3"
import { beforeEach, describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"
import { migratedDatabase } from "@/lib/domain/contacts/__tests__/directory-seed"
import type { Db } from "@/lib/server/action-context"

import { companyAccessRequests, myAccessRequests, requestableOrganizationsFor } from "../queries"
import { accessRequestInputSchema, approvedOrganizationRole, canDecideAccessRequests, isRequestableOrganization } from "../rules"
import {
  approveAccessRequest,
  declineAccessRequest,
  submitAccessRequest,
  withdrawAccessRequest,
  type AccessRequestActor,
} from "../service"
import { reopenAccessRequest } from "../store"

/*
 * The Request access workflow against every migration replayed on SQLite:
 * who can ask, who can decide, and what an approval grants.
 */

type Sqlite = ReturnType<typeof migratedDatabase>

const NOW = "2026-11-10T12:00:00.000Z"

function seed(sqlite: Sqlite): void {
  sqlite.exec(`
    INSERT INTO organizations (id, name, slug, type, created_at, updated_at) VALUES
      ('org-a', 'Acme Builders', 'acme', 'internal', '${NOW}', '${NOW}'),
      ('org-b', 'Other Co', 'other', 'internal', '${NOW}', '${NOW}'),
      ('org-p', 'Rita''s Workspace', 'rita-personal', 'personal', '${NOW}', '${NOW}');
    INSERT INTO users (id, email, display_name, role, created_at, updated_at) VALUES
      ('admin-a', 'admin@acme.test', 'Ann Admin', 'admin', '${NOW}', '${NOW}'),
      ('pm-a', 'pm@acme.test', 'Pat PM', 'project_manager', '${NOW}', '${NOW}'),
      ('admin-b', 'admin@other.test', 'Bob Admin', 'admin', '${NOW}', '${NOW}'),
      ('user_rita', 'rita@client.test', 'Rita Client', 'office', '${NOW}', '${NOW}'),
      ('user_vic', 'vic@vendor.test', 'Vic Vendor', 'office', '${NOW}', '${NOW}'),
      ('user_ed', 'ed@acme.test', 'Ed Employee', 'office', '${NOW}', '${NOW}');
    INSERT INTO organization_members (id, organization_id, user_id, role, joined_at) VALUES
      ('m1', 'org-a', 'admin-a', 'admin', '${NOW}'),
      ('m2', 'org-a', 'pm-a', 'project_manager', '${NOW}'),
      ('m3', 'org-b', 'admin-b', 'admin', '${NOW}'),
      ('m4', 'org-p', 'user_rita', 'admin', '${NOW}');
    -- Acme allows requests; Other Co never saved the setting (off); the
    -- personal workspace turned it on but is never listed.
    INSERT INTO organization_feature_settings (organization_id, feature_key, value, updated_at) VALUES
      ('org-a', 'access-requests', '{"allowRequests":true}', '${NOW}'),
      ('org-p', 'access-requests', '{"allowRequests":true}', '${NOW}');
    INSERT INTO customers (id, organization_id, name, created_at) VALUES ('cust-1', 'org-a', 'Rita Client', '${NOW}');
    INSERT INTO customer_contacts (id, customer_id, name, email, created_at, updated_at) VALUES
      ('cc-1', 'cust-1', 'Rita Client', 'rita@client.test', '${NOW}', '${NOW}');
    INSERT INTO vendors (id, organization_id, name, created_at) VALUES ('ven-1', 'org-a', 'Vic Concrete', '${NOW}');
    INSERT INTO vendor_contacts (id, vendor_id, name, email, created_at, updated_at) VALUES
      ('vc-1', 'ven-1', 'Vic Vendor', 'vic@vendor.test', '${NOW}', '${NOW}');
    INSERT INTO projects (id, organization_id, name, project_number, created_at) VALUES
      ('p1', 'org-a', 'Smith Residence', 'O-1', '${NOW}'),
      ('p2', 'org-a', 'Held Job', 'O-2', '${NOW}'),
      ('p3', 'org-a', 'Vendor Job', 'O-3', '${NOW}');
    UPDATE projects SET imported_conversations_staff_only = 1 WHERE id = 'p2';
    INSERT INTO project_contacts (id, project_id, contact_type, display_name, customer_id, customer_contact_id, vendor_id, vendor_contact_id, created_at, updated_at) VALUES
      ('pc-1', 'p1', 'owner', 'Rita Client', 'cust-1', 'cc-1', NULL, NULL, '${NOW}', '${NOW}'),
      ('pc-2', 'p2', 'owner', 'Rita Client', 'cust-1', 'cc-1', NULL, NULL, '${NOW}', '${NOW}'),
      ('pc-3', 'p3', 'subcontractor', 'Vic Vendor', NULL, NULL, 'ven-1', 'vc-1', '${NOW}', '${NOW}');
  `)
}

function actor(id: string, role: string, organizationId: string | null): AccessRequestActor {
  return { id, email: `${id}@test`, displayName: id, firstName: null, lastName: null, role, organizationId, isActive: true }
}

const rita = { id: "user_rita", email: "rita@client.test", displayName: "Rita Client" }
const vic = { id: "user_vic", email: "vic@vendor.test", displayName: "Vic Vendor" }
const ed = { id: "user_ed", email: "ed@acme.test", displayName: "Ed Employee" }
const adminA = actor("admin-a", "admin", "org-a")

let sqlite: Sqlite
let d1: D1Database
let db: Db
let migratedImage: Buffer | null = null

/** Replaying every migration is slow, so it runs once and each test gets a copy. */
function migrated(): Sqlite {
  if (!migratedImage) {
    const base = migratedDatabase()
    migratedImage = base.serialize()
    base.close()
  }
  const copy = new Database(migratedImage)
  copy.exec("PRAGMA foreign_keys = ON")
  return copy
}

beforeEach(() => {
  sqlite = migrated()
  seed(sqlite)
  // @ts-expect-error The test binding implements only what drizzle's D1 driver and the batch calls use.
  d1 = d1Over(sqlite)
  db = getDb(d1)
})

function row<T>(query: string, ...values: unknown[]): T | undefined {
  const result: unknown = sqlite.prepare(query).get(...values)
  return result === undefined ? undefined : Object(result)
}

async function submit(requester: typeof rita, kind: "client" | "vendor" | "employee", organizationId = "org-a") {
  return submitAccessRequest(db, requester, {
    organizationId,
    kind,
    companyName: kind === "vendor" ? "Vic Concrete" : "",
    phone: "719-555-0100",
    jobReference: kind === "employee" ? "" : "Smith Residence",
    note: "",
  }, NOW)
}

describe("access request rules", () => {
  it("only lists active staff companies that turned requests on", () => {
    expect(isRequestableOrganization({ type: "internal", isActive: true, allowRequests: true })).toBe(true)
    expect(isRequestableOrganization({ type: "internal", isActive: true, allowRequests: false })).toBe(false)
    expect(isRequestableOrganization({ type: "personal", isActive: true, allowRequests: true })).toBe(false)
    expect(isRequestableOrganization({ type: "internal", isActive: false, allowRequests: true })).toBe(false)
  })

  it("lets only admins decide", () => {
    expect(canDecideAccessRequests("admin")).toBe(true)
    expect(canDecideAccessRequests("secondary_admin")).toBe(true)
    expect(canDecideAccessRequests("project_manager")).toBe(false)
    expect(canDecideAccessRequests("client")).toBe(false)
  })

  it("needs a company name from vendors and a job from clients and vendors", () => {
    const base = { organizationId: "org-a", phone: "719-555-0100", companyName: "", jobReference: "", note: "" }
    expect(accessRequestInputSchema.safeParse({ ...base, kind: "vendor", jobReference: "Job" }).success).toBe(false)
    expect(accessRequestInputSchema.safeParse({ ...base, kind: "client" }).success).toBe(false)
    expect(accessRequestInputSchema.safeParse({ ...base, kind: "employee" }).success).toBe(true)
  })

  it("never grants an admin role from an employee request", () => {
    expect(approvedOrganizationRole({ kind: "employee", requestId: "r", role: "admin" })).toBe("office")
    expect(approvedOrganizationRole({ kind: "client", requestId: "r", customerContactId: "c" })).toBe("client")
  })
})

describe("asking for access", () => {
  it("lists only companies that allow requests and the person isn't in", async () => {
    expect((await requestableOrganizationsFor(db, "user_rita")).map((org) => org.name)).toEqual(["Acme Builders"])
    expect(await requestableOrganizationsFor(db, "admin-a")).toEqual([])
  })

  it("refuses a company with the setting off", async () => {
    const result = await submit(rita, "client", "org-b")
    expect(result.success).toBe(false)
    expect(row("SELECT count(*) AS n FROM organization_access_requests")).toEqual({ n: 0 })
  })

  it("refuses a personal workspace even when its setting is on", async () => {
    expect((await submit(vic, "client", "org-p")).success).toBe(false)
  })

  it("keeps one pending request per person and company", async () => {
    expect((await submit(rita, "client")).success).toBe(true)
    const again = await submit(rita, "client")
    expect(again).toEqual({ success: false, error: "Your request to Acme Builders is already waiting for approval." })
    expect((await myAccessRequests(db, "user_rita")).map((request) => request.status)).toEqual(["pending"])
  })

  it("lets the person withdraw their own pending request, and only theirs", async () => {
    const submitted = await submit(rita, "client")
    if (!submitted.success) throw new Error(submitted.error)
    expect((await withdrawAccessRequest(db, vic, submitted.data.requestId, NOW)).success).toBe(false)
    expect((await withdrawAccessRequest(db, rita, submitted.data.requestId, NOW)).success).toBe(true)
    expect((await submit(rita, "client")).success).toBe(true)
  })
})

describe("deciding a request", () => {
  it("shows a company's requests only to that company", async () => {
    await submit(rita, "client")
    expect(await companyAccessRequests(db, "org-a")).toHaveLength(1)
    expect(await companyAccessRequests(db, "org-b")).toHaveLength(0)
  })

  it("refuses a non-admin and another company's admin", async () => {
    const submitted = await submit(rita, "client")
    if (!submitted.success) throw new Error(submitted.error)
    const input = { kind: "client" as const, requestId: submitted.data.requestId, customerContactId: "cc-1" }
    expect((await approveAccessRequest(db, d1, actor("pm-a", "project_manager", "org-a"), input, NOW)).success).toBe(false)
    expect(await approveAccessRequest(db, d1, actor("admin-b", "admin", "org-b"), input, NOW)).toEqual({ success: false, error: "Request not found." })
    expect((await declineAccessRequest(db, actor("admin-b", "admin", "org-b"), submitted.data.requestId, NOW)).success).toBe(false)
    expect(row("SELECT status FROM organization_access_requests")).toEqual({ status: "pending" })
  })

  it("approves a client: links the directory person and opens their jobs, except staff-only ones", async () => {
    const submitted = await submit(rita, "client")
    if (!submitted.success) throw new Error(submitted.error)
    const result = await approveAccessRequest(db, d1, adminA, { kind: "client", requestId: submitted.data.requestId, customerContactId: "cc-1" }, NOW)
    if (!result.success) throw new Error(result.error)
    expect(result.data.projects).toEqual(["O-1 - Smith Residence"])
    expect(result.data.skippedProjects).toEqual(["O-2 - Held Job"])
    expect(row("SELECT role FROM organization_members WHERE organization_id = 'org-a' AND user_id = 'user_rita'")).toEqual({ role: "client" })
    expect(row("SELECT user_id FROM customer_contacts WHERE id = 'cc-1'")).toEqual({ user_id: "user_rita" })
    expect(row("SELECT role FROM project_members WHERE project_id = 'p1' AND user_id = 'user_rita'")).toEqual({ role: "owner" })
    expect(row("SELECT count(*) AS n FROM project_members WHERE project_id = 'p2' AND user_id = 'user_rita'")).toEqual({ n: 0 })
    expect(row("SELECT status, accepted_by FROM project_access_invitations WHERE project_id = 'p1'")).toEqual({ status: "accepted", accepted_by: "user_rita" })
    expect(row("SELECT status, decided_by, granted_role, granted_project_count, customer_contact_id FROM organization_access_requests")).toEqual({
      status: "approved", decided_by: "admin-a", granted_role: "client", granted_project_count: 1, customer_contact_id: "cc-1",
    })
    // A decided request can't be decided again.
    expect((await declineAccessRequest(db, adminA, submitted.data.requestId, NOW)).success).toBe(false)
  })

  it("also opens a client's imported jobs that name no directory person but whose client record carries their sign-in email", async () => {
    sqlite.exec(`
      INSERT INTO customers (id, organization_id, name, email, created_at) VALUES
        ('cust-bt', 'org-a', 'Treasurer Rita', NULL, '${NOW}'),
        ('cust-bt2', 'org-a', 'Rita at home', ' RITA@client.test ', '${NOW}'),
        ('cust-old', 'org-a', 'Old Rita', 'rita@client.test', '${NOW}');
      UPDATE customers SET merged_into_customer_id = 'cust-1' WHERE id = 'cust-old';
      INSERT INTO projects (id, organization_id, name, project_number, created_at) VALUES
        ('p4', 'org-a', 'Range', 'O-4', '${NOW}'),
        ('p5', 'org-a', 'Pad', 'O-5', '${NOW}'),
        ('p6', 'org-a', 'Someone Else', 'O-6', '${NOW}'),
        ('p7', 'org-a', 'Merged Record Job', 'O-7', '${NOW}');
      INSERT INTO project_contacts (id, project_id, contact_type, display_name, email, customer_id, customer_contact_id, created_at, updated_at) VALUES
        ('pc-4', 'p4', 'owner', 'Treasurer Rita', 'Rita Client <Rita@Client.test>', 'cust-bt', NULL, '${NOW}', '${NOW}'),
        ('pc-5', 'p5', 'owner', 'Rita at home', NULL, 'cust-bt2', NULL, '${NOW}', '${NOW}'),
        ('pc-6', 'p6', 'owner', 'Somebody', 'not-rita@client.test', 'cust-bt', NULL, '${NOW}', '${NOW}'),
        ('pc-7', 'p7', 'owner', 'Old Rita', 'rita@client.test', 'cust-old', NULL, '${NOW}', '${NOW}');
    `)
    const submitted = await submit(rita, "client")
    if (!submitted.success) throw new Error(submitted.error)
    const result = await approveAccessRequest(db, d1, adminA, { kind: "client", requestId: submitted.data.requestId, customerContactId: "cc-1" }, NOW)
    if (!result.success) throw new Error(result.error)
    expect([...result.data.projects].sort()).toEqual(["O-1 - Smith Residence", "O-5 - Pad", "O-7 - Merged Record Job"])
    // The email copied onto a job contact is history: the directory record
    // (cust-bt, no email) is what counts, so p4 is not matched.
    expect(row("SELECT count(*) AS n FROM project_members WHERE project_id = 'p4' AND user_id = 'user_rita'")).toEqual({ n: 0 })
    expect(row("SELECT count(*) AS n FROM project_members WHERE project_id = 'p6' AND user_id = 'user_rita'")).toEqual({ n: 0 })
    // Read-only match: the job contact still names no directory person, and no job contact was added.
    expect(row("SELECT customer_contact_id FROM project_contacts WHERE id = 'pc-4'")).toEqual({ customer_contact_id: null })
    expect(row("SELECT count(*) AS n FROM project_contacts")).toEqual({ n: 7 })
  })

  it("approves a client picked as a client record with no people: adds its person and opens its jobs", async () => {
    sqlite.exec(`
      INSERT INTO customers (id, organization_id, name, company, email, created_at) VALUES
        ('cust-k', 'org-a', 'Kim Meyers', 'Shooting Society', 'kim@club.test', '${NOW}');
      INSERT INTO users (id, email, display_name, role, created_at, updated_at) VALUES
        ('user_kim', 'kim@club.test', 'Kim Meyers', 'office', '${NOW}', '${NOW}');
      INSERT INTO projects (id, organization_id, name, project_number, created_at) VALUES ('p8', 'org-a', 'Range', 'O-8', '${NOW}');
      INSERT INTO project_contacts (id, project_id, contact_type, display_name, email, customer_id, customer_contact_id, created_at, updated_at) VALUES
        ('pc-8', 'p8', 'owner', 'Kim Meyers', 'kim@club.test', 'cust-k', NULL, '${NOW}', '${NOW}');
    `)
    const kim = { id: "user_kim", email: "kim@club.test", displayName: "Kim Meyers" }
    const submitted = await submit(kim, "client")
    if (!submitted.success) throw new Error(submitted.error)
    const result = await approveAccessRequest(db, d1, adminA, { kind: "client", requestId: submitted.data.requestId, customerContactId: "customer:cust-k" }, NOW)
    if (!result.success) throw new Error(result.error)
    expect(result.data.projects).toEqual(["O-8 - Range"])
    const person = row<{ id: string; name: string; email: string; user_id: string }>("SELECT id, name, email, user_id FROM customer_contacts WHERE customer_id = 'cust-k'")
    expect(person).toMatchObject({ name: "Kim Meyers", email: "kim@club.test", user_id: "user_kim" })
    expect(row("SELECT customer_contact_id FROM organization_access_requests WHERE id = ?", submitted.data.requestId)).toEqual({ customer_contact_id: person?.id })
    expect(row("SELECT customer_contact_id FROM project_contacts WHERE id = 'pc-8'")).toEqual({ customer_contact_id: null })
  })

  it("approves someone nobody in Contacts matches as a new client, from what they entered", async () => {
    sqlite.exec(`UPDATE customer_contacts SET email = 'other@client.test' WHERE id = 'cc-1'`)
    const submitted = await submit(rita, "client")
    if (!submitted.success) throw new Error(submitted.error)
    const result = await approveAccessRequest(db, d1, adminA, { kind: "client", requestId: submitted.data.requestId, customerContactId: "new" }, NOW)
    if (!result.success) throw new Error(result.error)
    expect(row("SELECT c.name, c.email, c.phone, cc.user_id FROM customers c JOIN customer_contacts cc ON cc.customer_id = c.id WHERE cc.user_id = 'user_rita' AND c.id <> 'cust-1'")).toEqual({
      name: "Rita Client", email: "rita@client.test", phone: "719-555-0100", user_id: "user_rita",
    })
  })

  it("approves a vendor picked as a company by adding them as a person there", async () => {
    sqlite.exec(`INSERT INTO vendors (id, organization_id, name, created_at) VALUES ('ven-2', 'org-a', 'DMS Truss', '${NOW}');`)
    const submitted = await submit(vic, "vendor")
    if (!submitted.success) throw new Error(submitted.error)
    const result = await approveAccessRequest(db, d1, adminA, { kind: "vendor", requestId: submitted.data.requestId, vendorContactId: "vendor:ven-2", role: "supplier" }, NOW)
    if (!result.success) throw new Error(result.error)
    expect(row("SELECT name, email, user_id FROM vendor_contacts WHERE vendor_id = 'ven-2'")).toEqual({ name: "Vic Vendor", email: "vic@vendor.test", user_id: "user_vic" })
  })

  it("approves a vendor with the chosen role on the vendor person's jobs", async () => {
    const submitted = await submit(vic, "vendor")
    if (!submitted.success) throw new Error(submitted.error)
    const result = await approveAccessRequest(db, d1, adminA, { kind: "vendor", requestId: submitted.data.requestId, vendorContactId: "vc-1", role: "supplier" }, NOW)
    if (!result.success) throw new Error(result.error)
    expect(row("SELECT role FROM organization_members WHERE organization_id = 'org-a' AND user_id = 'user_vic'")).toEqual({ role: "supplier" })
    expect(row("SELECT role FROM project_members WHERE project_id = 'p3' AND user_id = 'user_vic'")).toEqual({ role: "subcontractor" })
    expect(row("SELECT user_id FROM vendor_contacts WHERE id = 'vc-1'")).toEqual({ user_id: "user_vic" })
  })

  it("won't link a directory person who belongs to another login", async () => {
    sqlite.exec(`INSERT INTO organization_members (id, organization_id, user_id, role, joined_at) VALUES ('m5', 'org-a', 'user_ed', 'client', '${NOW}')`)
    sqlite.exec("UPDATE customer_contacts SET user_id = 'user_ed' WHERE id = 'cc-1'")
    const submitted = await submit(rita, "client")
    if (!submitted.success) throw new Error(submitted.error)
    const result = await approveAccessRequest(db, d1, adminA, { kind: "client", requestId: submitted.data.requestId, customerContactId: "cc-1" }, NOW)
    expect(result).toEqual({ success: false, error: "That directory contact is already linked to a different Compass login." })
    expect(row("SELECT count(*) AS n FROM organization_members WHERE user_id = 'user_rita' AND organization_id = 'org-a'")).toEqual({ n: 0 })
  })

  it("approves an employee with a staff role and no jobs", async () => {
    const submitted = await submit(ed, "employee")
    if (!submitted.success) throw new Error(submitted.error)
    const result = await approveAccessRequest(db, d1, adminA, { kind: "employee", requestId: submitted.data.requestId, role: "project_manager" }, NOW)
    if (!result.success) throw new Error(result.error)
    expect(row("SELECT role FROM organization_members WHERE organization_id = 'org-a' AND user_id = 'user_ed'")).toEqual({ role: "project_manager" })
    const admin = await approveAccessRequest(db, d1, adminA, { kind: "employee", requestId: submitted.data.requestId, role: "admin" }, NOW)
    expect(admin.success).toBe(false)
  })

  it("declines without sharing anything and records who decided", async () => {
    const submitted = await submit(rita, "client")
    if (!submitted.success) throw new Error(submitted.error)
    const result = await declineAccessRequest(db, adminA, submitted.data.requestId, NOW)
    expect(result.success).toBe(true)
    expect(row("SELECT status, decided_by, decided_at FROM organization_access_requests")).toEqual({ status: "declined", decided_by: "admin-a", decided_at: NOW })
    expect(row("SELECT count(*) AS n FROM organization_members WHERE user_id = 'user_rita' AND organization_id = 'org-a'")).toEqual({ n: 0 })
    expect(row("SELECT user_id FROM customer_contacts WHERE id = 'cc-1'")).toEqual({ user_id: null })
  })
})

describe("never a second client or vendor record", () => {
  it("refuses \"new\" when the directory already has someone with this email, and adds nothing", async () => {
    const submitted = await submit(rita, "client")
    if (!submitted.success) throw new Error(submitted.error)
    const result = await approveAccessRequest(db, d1, adminA, { kind: "client", requestId: submitted.data.requestId, customerContactId: "new" }, NOW)
    expect(result).toEqual({ success: false, error: "Rita Client (Rita Client) is already in your clients with this email. Pick them instead of adding a new client." })
    expect(row("SELECT count(*) AS n FROM customers WHERE organization_id = 'org-a'")).toEqual({ n: 1 })
    expect(row("SELECT status FROM organization_access_requests")).toEqual({ status: "pending" })
  })

  it("refuses a \"new\" vendor the same way", async () => {
    const submitted = await submit(vic, "vendor")
    if (!submitted.success) throw new Error(submitted.error)
    const result = await approveAccessRequest(db, d1, adminA, { kind: "vendor", requestId: submitted.data.requestId, vendorContactId: "new", role: "subcontractor" }, NOW)
    expect(result).toEqual({ success: false, error: "Vic Vendor (Vic Concrete) is already in your vendors with this email. Pick them instead of adding a new vendor." })
    expect(row("SELECT count(*) AS n FROM vendors WHERE organization_id = 'org-a'")).toEqual({ n: 1 })
  })

  it("a retry after a failed grant reuses the client record the first attempt made", async () => {
    sqlite.exec(`UPDATE customer_contacts SET email = 'other@client.test' WHERE id = 'cc-1'`)
    const submitted = await submit(rita, "client")
    if (!submitted.success) throw new Error(submitted.error)
    const id = submitted.data.requestId
    // The first attempt made the record, remembered it, then its grant failed and the request reopened.
    sqlite.exec(`INSERT INTO customers (id, organization_id, name, email, created_at) VALUES ('cust-made', 'org-a', 'Rita Client', 'rita@client.test', '${NOW}');
      INSERT INTO customer_contacts (id, customer_id, name, email, created_at, updated_at) VALUES ('cc-made', 'cust-made', 'Rita Client', 'rita@client.test', '${NOW}', '${NOW}');
      UPDATE organization_access_requests SET status = 'approved', customer_contact_id = 'cc-made' WHERE id = '${id}';`)
    expect(await reopenAccessRequest(db, id, NOW)).toBe(true)
    const result = await approveAccessRequest(db, d1, adminA, { kind: "client", requestId: id, customerContactId: "new" }, NOW)
    if (!result.success) throw new Error(result.error)
    expect(row("SELECT count(*) AS n FROM customers WHERE organization_id = 'org-a'")).toEqual({ n: 2 })
    expect(row("SELECT user_id FROM customer_contacts WHERE id = 'cc-made'")).toEqual({ user_id: "user_rita" })
  })
})

describe("deciding a request twice at once", () => {
  const adminTwo = actor("admin-a2", "admin", "org-a")
  beforeEach(() => {
    sqlite.exec(`INSERT INTO users (id, email, display_name, role, created_at, updated_at) VALUES ('admin-a2', 'admin2@acme.test', 'Al Admin', 'admin', '${NOW}', '${NOW}');
      INSERT INTO organization_members (id, organization_id, user_id, role, joined_at) VALUES ('m6', 'org-a', 'admin-a2', 'admin', '${NOW}');`)
  })

  it("two admins approving as a new client: one wins and only one client record is added", async () => {
    sqlite.exec(`UPDATE customer_contacts SET email = 'other@client.test' WHERE id = 'cc-1'`)
    const submitted = await submit(rita, "client")
    if (!submitted.success) throw new Error(submitted.error)
    const choice = { kind: "client" as const, requestId: submitted.data.requestId, customerContactId: "new" }
    const results = await Promise.all([
      approveAccessRequest(db, d1, adminA, choice, NOW),
      approveAccessRequest(db, d1, adminTwo, choice, NOW),
    ])
    expect(results.filter((result) => result.success)).toHaveLength(1)
    expect(results.find((result) => !result.success)).toEqual({ success: false, error: "This request was already decided." })
    expect(row("SELECT count(*) AS n FROM customers WHERE organization_id = 'org-a'")).toEqual({ n: 2 })
    expect(row("SELECT count(*) AS n FROM organization_members WHERE organization_id = 'org-a' AND user_id = 'user_rita'")).toEqual({ n: 1 })
  })

  it("approve racing decline ends with exactly one outcome", async () => {
    const submitted = await submit(rita, "client")
    if (!submitted.success) throw new Error(submitted.error)
    const [approved, declined] = await Promise.all([
      approveAccessRequest(db, d1, adminA, { kind: "client", requestId: submitted.data.requestId, customerContactId: "cc-1" }, NOW),
      declineAccessRequest(db, adminTwo, submitted.data.requestId, NOW),
    ])
    expect([approved.success, declined.success].filter(Boolean)).toHaveLength(1)
    const status = row<{ status: string }>("SELECT status FROM organization_access_requests")?.status
    const members = row("SELECT count(*) AS n FROM organization_members WHERE organization_id = 'org-a' AND user_id = 'user_rita'")
    expect(members).toEqual({ n: status === "approved" ? 1 : 0 })
  })

  it("a withdrawn request can't be approved, and nothing is granted", async () => {
    const submitted = await submit(rita, "client")
    if (!submitted.success) throw new Error(submitted.error)
    const [withdrawn, approved] = await Promise.all([
      withdrawAccessRequest(db, rita, submitted.data.requestId, NOW),
      approveAccessRequest(db, d1, adminA, { kind: "client", requestId: submitted.data.requestId, customerContactId: "customer:cust-1" }, NOW),
    ])
    expect([withdrawn.success, approved.success].filter(Boolean)).toHaveLength(1)
    if (withdrawn.success) {
      expect(row("SELECT count(*) AS n FROM organization_members WHERE organization_id = 'org-a' AND user_id = 'user_rita'")).toEqual({ n: 0 })
      expect(row("SELECT user_id FROM customer_contacts WHERE id = 'cc-1'")).toEqual({ user_id: null })
    }
  })

  it("a failed grant reopens the request, unless the person has asked again since", async () => {
    const submitted = await submit(rita, "client")
    if (!submitted.success) throw new Error(submitted.error)
    const id = submitted.data.requestId
    sqlite.exec(`UPDATE organization_access_requests SET status = 'approved', granted_role = 'client' WHERE id = '${id}'`)
    expect(await reopenAccessRequest(db, id, NOW)).toBe(true)
    expect(row("SELECT status, granted_role FROM organization_access_requests")).toEqual({ status: "pending", granted_role: null })
    sqlite.exec(`UPDATE organization_access_requests SET status = 'approved' WHERE id = '${id}'`)
    expect((await submit(rita, "client")).success).toBe(true)
    expect(await reopenAccessRequest(db, id, NOW)).toBe(false)
    expect(row(`SELECT status FROM organization_access_requests WHERE id = '${id}'`)).toEqual({ status: "approved" })
  })
})
