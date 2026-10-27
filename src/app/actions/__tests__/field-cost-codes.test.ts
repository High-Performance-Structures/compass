import { beforeEach, describe, expect, it, vi } from "vitest"
import { d1, migratedSqlite, type Sqlite } from "@/lib/daily-logs/__tests__/sqlite-d1"
const mocks = vi.hoisted(() => ({ auth: vi.fn(), cloudflare: vi.fn(), access: vi.fn(), canFeature: vi.fn() }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.auth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.cloudflare }))
vi.mock("@/lib/project-access", () => ({ getProjectAccessRecord: mocks.access }))
vi.mock("@/lib/permission-enforcement", () => ({ canFeature: mocks.canFeature, requireFeaturePermission: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
import { getCompanyFieldCostCodes, getProjectFieldCostCodes, resetCompanyFieldCostCodes, saveCompanyFieldCostCodes, saveProjectFieldCostCodes } from "../field-cost-codes"
let sqlite: Sqlite
beforeEach(() => {
  vi.clearAllMocks()
  sqlite = migratedSqlite()
  sqlite.exec(`
    INSERT INTO organizations (id,name,slug,type,is_active,created_at,updated_at) VALUES ('org','Example','example','internal',1,'2026-10-26','2026-10-26');
    INSERT INTO users (id,email,role,is_active,created_at,updated_at) VALUES ('staff','staff@example.test','admin',1,'2026-10-26','2026-10-26');
    INSERT INTO projects (id,name,organization_id,department,created_at,updated_at) VALUES ('job','Job','org','O','2026-10-26','2026-10-26'),('peer','Peer','org','O','2026-10-26','2026-10-26');
  `)
  mocks.auth.mockResolvedValue({ id: "staff", email: "staff@example.test", displayName: "Example Admin", role: "admin", organizationId: "org", isActive: true })
  mocks.cloudflare.mockResolvedValue({ env: { DB: d1(sqlite) } })
  mocks.access.mockResolvedValue({ organizationId: "org" })
  mocks.canFeature.mockResolvedValue(true)
})
function count(table: string): unknown { return sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() }

describe("Field cost-code settings actions", () => {
  it("saves canonical company choices and audits save/reset", async () => {
    expect(await saveCompanyFieldCostCodes(["48 14 00"])).toEqual({ success: true })
    const view = await getCompanyFieldCostCodes()
    expect(view.success && view.data.codes.map((code) => code.code)).toEqual(["48 14 00"])
    expect(view.success && view.data.customized).toBe(true)
    expect(await resetCompanyFieldCostCodes()).toEqual({ success: true })
    const reset = await getCompanyFieldCostCodes()
    expect(reset.success && reset.data.customized).toBe(false)
    expect(count("activity_events")).toMatchObject({ n: 2 })
    expect(sqlite.prepare("SELECT actor_name FROM activity_events").all()).toEqual([{ actor_name: "Example Admin" }, { actor_name: "Example Admin" }])
  })
  it("reports when adopting a company list would combine different department lists", async () => {
    sqlite.prepare("INSERT INTO organization_feature_settings (organization_id,feature_key,value,updated_at) VALUES ('org','daily-logs',?,'2026-10-26')").run(JSON.stringify({ laborCodeDepartments: ["H", "N"] }))
    const view = await getCompanyFieldCostCodes()
    expect(view.success && view.data.combinesDepartmentLists).toBe(true)
    expect(await saveCompanyFieldCostCodes(["48 14 00"])).toEqual({ success: true })
    const saved = await getCompanyFieldCostCodes()
    expect(saved.success && saved.data.combinesDepartmentLists).toBe(false)
  })

  it("supports an explicitly empty company list", async () => {
    expect(await saveCompanyFieldCostCodes([])).toEqual({ success: true })
    const view = await getCompanyFieldCostCodes()
    expect(view.success && view.data.codes).toEqual([])
    expect(view.success && view.data.customized).toBe(true)
  })
  it("saves and removes project additions with audit records", async () => {
    expect(await saveProjectFieldCostCodes("job", ["48 14 00"])).toEqual({ success: true })
    const view = await getProjectFieldCostCodes("job")
    expect(view.success && view.data.codes.map((code) => code.code)).toEqual(["48 14 00"])
    const peer = await getProjectFieldCostCodes("peer")
    expect(peer.success && peer.data.codes).toEqual([])
    expect(await saveProjectFieldCostCodes("job", [])).toEqual({ success: true })
    expect(count("project_field_cost_codes")).toMatchObject({ n: 0 })
    expect(count("project_profile_audit_events")).toMatchObject({ n: 2 })
  })
  it("rejects unknown and duplicate codes", async () => {
    expect((await saveCompanyFieldCostCodes(["NOT-A-CODE"])).success).toBe(false)
    expect((await saveProjectFieldCostCodes("job", ["NOT-A-CODE"])).success).toBe(false)
    expect((await saveCompanyFieldCostCodes(["48 14 00", "48 14 00"])).success).toBe(false)
    expect(count("organization_feature_settings")).toMatchObject({ n: 0 })
  })
  it("rejects catalog names that cannot survive the persisted-list read schema", async () => {
    sqlite.prepare("INSERT INTO sage_cost_codes (id,code,description,display_label,division_code,division_description,division_display_label,active,created_at,updated_at) VALUES ('long','99 99 98',?,'99 99 98 Long name','99','Other','99 Other',1,'2026-10-26','2026-10-26')").run("x".repeat(501))
    expect((await saveCompanyFieldCostCodes(["99 99 98"])).success).toBe(false)
    expect((await saveProjectFieldCostCodes("job", ["99 99 98"])).success).toBe(false)
    expect(count("organization_feature_settings")).toMatchObject({ n: 0 })
    expect(count("project_field_cost_codes")).toMatchObject({ n: 0 })
  })

  it("lets project managers manage project additions but not company defaults", async () => {
    mocks.auth.mockResolvedValue({ id: "staff", email: "staff@example.test", role: "project_manager", organizationId: "org", isActive: true })
    expect((await saveCompanyFieldCostCodes(["48 14 00"])).success).toBe(false)
    expect(await saveProjectFieldCostCodes("job", ["48 14 00"])).toEqual({ success: true })
  })
  it("rejects writes without project permission or across organizations", async () => {
    mocks.canFeature.mockResolvedValue(false)
    expect((await saveProjectFieldCostCodes("job", ["48 14 00"])).success).toBe(false)
    mocks.canFeature.mockResolvedValue(true)
    mocks.access.mockResolvedValue({ organizationId: "another" })
    expect((await saveProjectFieldCostCodes("job", ["48 14 00"])).success).toBe(false)
    expect(count("project_field_cost_codes")).toMatchObject({ n: 0 })
  })
  it("keeps field crew read-only and rejects inactive accounts", async () => {
    mocks.auth.mockResolvedValue({ id: "staff", email: "staff@example.test", role: "field_crew", organizationId: "org", isActive: true })
    const view = await getProjectFieldCostCodes("job")
    expect(view.success && view.data.canEdit).toBe(false)
    expect((await saveProjectFieldCostCodes("job", [])).success).toBe(false)
    mocks.auth.mockResolvedValue({ id: "staff", email: "staff@example.test", role: "admin", organizationId: "org", isActive: false })
    expect((await saveCompanyFieldCostCodes([])).success).toBe(false)
  })
})
