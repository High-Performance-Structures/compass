import { drizzle } from "drizzle-orm/d1"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { countingD1, migratedDatabase } from "@/lib/domain/contacts/__tests__/directory-seed"

const state = vi.hoisted(() => {
  const initial: { d1: unknown; userId: string; canUpdate: boolean } = { d1: null, userId: "user-a", canUpdate: true }
  return initial
})
function user(): Record<string, unknown> {
  return {
    id: state.userId, email: "a@example.com", firstName: "Avery", lastName: "Office", displayName: null, avatarUrl: null,
    role: "office", googleEmail: null, isActive: true, lastLoginAt: null, organizationId: "org-a",
    organizationName: "A", organizationType: "company", createdAt: "", updatedAt: "",
  }
}
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => user(), requireAuth: async () => user() }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: state.d1 } }) }))
vi.mock("@/lib/permission-enforcement", () => ({
  canFeature: async (_user: unknown, _feature: string, action: string) => action === "read" || state.canUpdate,
}))
vi.mock("@/db", () => ({ getDb: (d1: never) => drizzle(d1) }))

import { adoptSageCompanyName, getSageCompanyNameState } from "@/app/actions/sage-company-names"
import { SAGE_COMPANY_NAME_MAX_AGE_MS } from "@/lib/sage/company-name-adoption"

const VENDOR_GUID = "3f2a9c1e-0000-4000-8000-000000000038"
const CLIENT_GUID = "7b1d2e3f-0000-4000-8000-000000000052"
const SAGE_TABLES = [
  "sage_contact_change_proposals", "sage_contact_read_requests",
  "sage_contact_create_proposals", "sage_client_project_write_operations",
] as const

let sqlite: ReturnType<typeof migratedDatabase>

function capturedAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

function seed(vendorCapturedAt: string, clientCapturedAt: string): void {
  const now = "2026-10-01T00:00:00.000Z"
  sqlite.exec(`DELETE FROM activity_events; DELETE FROM project_contacts; DELETE FROM projects;
    DELETE FROM vendors; DELETE FROM customers;
    DELETE FROM sage_vendor_directory_entries; DELETE FROM sage_client_directory_entries;`)
  sqlite.prepare(`INSERT INTO vendors (id, name, category, organization_id, sage_vendor_id, sage_vendor_number,
    source_system, source_record_id, created_at, updated_at) VALUES ('vendor-1', 'JRL Construction', 'Subcontractor', 'org-a', ?, '38', 'buildertrend', 'bt-38', ?, ?)`)
    .run(VENDOR_GUID, now, now)
  sqlite.prepare(`INSERT INTO vendors (id, name, category, organization_id, created_at, updated_at)
    VALUES ('vendor-unlinked', 'Loose Lumber', 'Supplier', 'org-a', ?, ?)`).run(now, now)
  sqlite.prepare(`INSERT INTO customers (id, name, organization_id, sage_client_id, sage_client_number, created_at, updated_at)
    VALUES ('customer-1', 'Kelly Girl Painting', 'org-a', ?, '52', ?, ?)`).run(CLIENT_GUID.toUpperCase(), now, now)
  sqlite.prepare(`INSERT INTO sage_vendor_directory_entries (organization_id, sage_record_id, sage_vendor_number, name, email, captured_at)
    VALUES ('org-a', ?, '38', 'JRL Construction LLC', NULL, ?)`).run(VENDOR_GUID, vendorCapturedAt)
  sqlite.prepare(`INSERT INTO sage_client_directory_entries (organization_id, sage_record_id, sage_client_number, name, email, captured_at)
    VALUES ('org-a', ?, '52', 'Kelley Girl Painting and Exteriors, LLC', NULL, ?)`).run(CLIENT_GUID, clientCapturedAt)
  sqlite.prepare(`INSERT INTO projects (id, name, status, organization_id, created_at)
    VALUES ('project-1', 'Job', 'active', 'org-a', ?)`).run(now)
  sqlite.prepare(`INSERT INTO project_contacts (id, project_id, contact_type, display_name, company_name, vendor_id, created_at, updated_at)
    VALUES ('pc-1', 'project-1', 'vendor', 'JRL Construction', 'JRL Construction', 'vendor-1', ?, ?)`).run(now, now)
}

function value(sql: string): unknown {
  const row: unknown = sqlite.prepare(sql).get()
  return row && typeof row === "object" ? Object.values(row)[0] : undefined
}

beforeAll(() => {
  sqlite = migratedDatabase()
  const now = "2026-10-01T00:00:00.000Z"
  sqlite.prepare("INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-a', 'A', 'a', 'company', 1, ?, ?)").run(now, now)
  sqlite.prepare("INSERT INTO users (id, email, role, is_active, created_at, updated_at) VALUES ('user-a', 'a@example.com', 'office', 1, ?, ?)").run(now, now)
  state.d1 = countingD1(sqlite).d1
})
afterAll(() => sqlite.close())
beforeEach(() => {
  state.userId = "user-a"
  state.canUpdate = true
  seed(capturedAgo(60_000), capturedAgo(60_000))
})

describe("Use Sage name", () => {
  it("shows both names and copies Sage's vendor name into Compass, leaving ids and links alone", async () => {
    const before = await getSageCompanyNameState("vendor_company", "vendor-1")
    expect(before).toMatchObject({ success: true, data: { compassName: "JRL Construction", sageName: "JRL Construction LLC", status: "differs" } })

    expect(await adoptSageCompanyName("vendor_company", "vendor-1"))
      .toEqual({ success: true, data: { name: "JRL Construction LLC", changed: true } })
    expect(sqlite.prepare("SELECT id, name, sage_vendor_id, sage_vendor_number, source_system, source_record_id FROM vendors WHERE id = 'vendor-1'").get())
      .toEqual({ id: "vendor-1", name: "JRL Construction LLC", sage_vendor_id: VENDOR_GUID, sage_vendor_number: "38", source_system: "buildertrend", source_record_id: "bt-38" })
    expect(value("SELECT company_name FROM project_contacts WHERE id = 'pc-1'")).toBe("JRL Construction LLC")
    const activity: unknown = sqlite.prepare("SELECT action, entity_id, metadata FROM activity_events").get()
    expect(activity).toMatchObject({ action: "vendor.sage_name_adopted", entity_id: "vendor-1" })
    expect(String(Reflect.get(Object(activity), "metadata"))).toContain("\"previousName\":\"JRL Construction\"")
    for (const table of SAGE_TABLES) expect(value(`SELECT count(*) FROM ${table}`)).toBe(0)
  })

  it("copies a client's Sage name, matching the record id whatever its case", async () => {
    expect(await adoptSageCompanyName("client_company", "customer-1"))
      .toEqual({ success: true, data: { name: "Kelley Girl Painting and Exteriors, LLC", changed: true } })
    expect(value("SELECT name FROM customers WHERE id = 'customer-1'")).toBe("Kelley Girl Painting and Exteriors, LLC")
    for (const table of SAGE_TABLES) expect(value(`SELECT count(*) FROM ${table}`)).toBe(0)
  })

  it("does nothing when the names already match", async () => {
    sqlite.exec("UPDATE vendors SET name = 'JRL Construction LLC', updated_at = 'unchanged' WHERE id = 'vendor-1'")
    expect(await adoptSageCompanyName("vendor_company", "vendor-1"))
      .toEqual({ success: true, data: { name: "JRL Construction LLC", changed: false } })
    expect(value("SELECT updated_at FROM vendors WHERE id = 'vendor-1'")).toBe("unchanged")
    expect(value("SELECT count(*) FROM activity_events")).toBe(0)
  })

  it("refuses a stale or missing Sage list and asks for a refresh", async () => {
    seed(capturedAgo(SAGE_COMPANY_NAME_MAX_AGE_MS + 60_000), capturedAgo(SAGE_COMPANY_NAME_MAX_AGE_MS + 60_000))
    const vendor = await adoptSageCompanyName("vendor_company", "vendor-1")
    expect(vendor.success === false && vendor.error).toMatch(/^Refresh this contact from Sage/)
    const client = await adoptSageCompanyName("client_company", "customer-1")
    expect(client.success === false && client.error).toMatch(/^Refresh this contact from Sage/)
    sqlite.exec("DELETE FROM sage_vendor_directory_entries")
    const missing = await adoptSageCompanyName("vendor_company", "vendor-1")
    expect(missing.success === false && missing.error).toMatch(/Refresh this contact from Sage/)
    const unlinked = await adoptSageCompanyName("vendor_company", "vendor-unlinked")
    expect(unlinked.success).toBe(false)
    expect(value("SELECT name FROM vendors WHERE id = 'vendor-1'")).toBe("JRL Construction")
    expect(value("SELECT name FROM customers WHERE id = 'customer-1'")).toBe("Kelly Girl Painting")
  })

  it("refuses staff without directory update permission and the demo account", async () => {
    state.canUpdate = false
    expect((await adoptSageCompanyName("vendor_company", "vendor-1")).success).toBe(false)
    state.canUpdate = true
    state.userId = "demo-user-001"
    expect(await adoptSageCompanyName("vendor_company", "vendor-1")).toEqual({ success: false, error: "DEMO_READ_ONLY" })
    expect(value("SELECT name FROM vendors WHERE id = 'vendor-1'")).toBe("JRL Construction")
  })

  it("refuses kinds other than client and vendor companies", async () => {
    expect((await adoptSageCompanyName("employee", "vendor-1")).success).toBe(false)
  })
})
