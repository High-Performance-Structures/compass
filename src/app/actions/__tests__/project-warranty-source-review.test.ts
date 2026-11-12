import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), context: vi.fn(), access: vi.fn(), permission: vi.fn() }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.auth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.context }))
vi.mock("@/lib/domain/project/access", () => ({ assertProjectAccess: mocks.access }))
vi.mock("@/lib/permission-enforcement", () => ({ requireFeaturePermission: mocks.permission }))

import { getProjectWarrantySourceReview, loadProjectWarrantySourceReviewPage } from "../project-warranty-source-review"
import { openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "../../../../__tests__/helpers/correspondence-core"

let database: CorrespondenceTestDatabase | null = null
afterEach(() => { database?.close(); database = null; vi.resetAllMocks() })

function open(): CorrespondenceTestDatabase {
  const db = openCorrespondenceTestDatabase()
  db.sqlite.exec(readFileSync(resolve(process.cwd(), "drizzle/0109_warranty_claims.sql"), "utf8").replaceAll("--> statement-breakpoint", ""))
  mocks.context.mockResolvedValue({ env: { DB: db.d1 } })
  mocks.access.mockResolvedValue({ organizationId: "org-a" })
  mocks.auth.mockResolvedValue({ id: "staff", role: "project_manager", organizationId: "org-a" })
  const insert = db.sqlite.prepare(`INSERT INTO buildertrend_warranty_claim_staging
    (id,organization_id,project_id,source_record_id,title,source_created_at,raw_payload_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
  for (let i = 0; i < 30; i += 1) insert.run(`source-${i}`, "org-a", "project-a", String(i), `Source ${i}`, "2026-01-02", JSON.stringify({ commentAudiences: { Internal: `Internal ${i}` }, duplicateReview: { existingCompassClaimId: "foreign-claim" } }), "audit-time", "audit-time")
  insert.run("foreign-source", "org-b", "project-a", "foreign", "Other org", "2026-01-02", "{}", "audit-time", "audit-time")
  insert.run("other-project-source", "org-a", "project-b", "other", "Other project", "2026-01-02", "{}", "audit-time", "audit-time")
  return db
}

describe("historical warranty project access", () => {
  it.each(["client", "owner", "subcontractor", "supplier", "guest"])("rejects %s before reading source evidence", async (role) => {
    mocks.auth.mockResolvedValue({ id: "external", role, organizationId: "org-a" })
    await expect(getProjectWarrantySourceReview("project-a")).rejects.toThrow("staff only")
    expect(mocks.context).not.toHaveBeenCalled()
  })

  it("requires feature permission and project access", async () => {
    database = open()
    mocks.permission.mockRejectedValueOnce(new Error("feature denied"))
    await expect(getProjectWarrantySourceReview("project-a")).rejects.toThrow("feature denied")
    expect(mocks.access).not.toHaveBeenCalled()
    mocks.access.mockRejectedValueOnce(new Error("project denied"))
    await expect(getProjectWarrantySourceReview("project-a")).rejects.toThrow("project denied")
  })

  it("scopes records to both project and organization and paginates without writes", async () => {
    database = open()
    const before = database.sqlite.prepare("SELECT * FROM buildertrend_warranty_claim_staging ORDER BY id").all()
    const first = await getProjectWarrantySourceReview("project-a")
    expect(first.total).toBe(30)
    expect(first.rows).toHaveLength(25)
    expect(first.rows.every((row) => row.sourceCreatedAt === "2026-01-02")).toBe(true)
    expect(first.rows.every((row) => row.existingClaim === null)).toBe(true)
    // A page past the end shows the last page.
    const last = await getProjectWarrantySourceReview("project-a", { pageIndex: 999999, pageSize: 25 })
    expect(last.rows).toHaveLength(5)
    expect(new Set([...first.rows, ...last.rows].map((row) => row.id)).size).toBe(30)
    const all = await getProjectWarrantySourceReview("project-a", { pageIndex: "bad", pageSize: 50 })
    expect(all.rows).toHaveLength(30)
    expect(JSON.stringify(all)).not.toContain("Other org")
    expect(JSON.stringify(all)).not.toContain("Other project")
    expect(database.sqlite.prepare("SELECT * FROM buildertrend_warranty_claim_staging ORDER BY id").all()).toEqual(before)
  })

  it("searches and sorts on the server", async () => {
    database = open()
    const found = await getProjectWarrantySourceReview("project-a", { search: "Source 2" })
    expect(found.total).toBe(11)
    expect(found.rows.every((row) => row.title.startsWith("Source 2"))).toBe(true)
    const sorted = await getProjectWarrantySourceReview("project-a", { sortId: "title", sortDesc: true, pageSize: 25 })
    expect(sorted.rows[0]?.title).toBe("Source 9")
    const ignored = await getProjectWarrantySourceReview("project-a", { sortId: "raw_payload_json; DROP" })
    expect(ignored.total).toBe(30)
  })

  it("returns an action failure to the browser instead of throwing", async () => {
    mocks.auth.mockResolvedValue({ id: "external", role: "client", organizationId: "org-a" })
    const result = await loadProjectWarrantySourceReviewPage("project-a", {})
    expect(result.success).toBe(false)
  })
})
