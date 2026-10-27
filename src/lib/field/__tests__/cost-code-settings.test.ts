import { beforeEach, describe, expect, it } from "vitest"
import { getDb } from "@/db"
import { dailyLogCostCodeList, dailyLogFormSetup, phoneDailyLogForm } from "@/lib/daily-logs/cost-code-lines"
import { migratedSqlite, d1, type Sqlite } from "@/lib/daily-logs/__tests__/sqlite-d1"
import { fieldCostCodeListSchema, mergeFieldCostCodes, parseProjectFieldCostCodes } from "../cost-code-settings"

let sqlite: Sqlite
let db: ReturnType<typeof getDb>
beforeEach(() => {
  sqlite = migratedSqlite()
  sqlite.exec(`
    INSERT INTO organizations (id,name,slug,type,is_active,created_at,updated_at) VALUES ('org','Example','example','internal',1,'2026-10-26','2026-10-26'),('other','Other','other','internal',1,'2026-10-26','2026-10-26');
    INSERT INTO projects (id,name,organization_id,department,created_at,updated_at) VALUES ('job','Job','org','O','2026-10-26','2026-10-26'),('peer','Peer','org','O','2026-10-26','2026-10-26'),('design','Design','org','D','2026-10-26','2026-10-26'),('foreign','Foreign','other','O','2026-10-26','2026-10-26');
  `)
  db = getDb(d1(sqlite))
})
function settings(key: string, value: unknown): void {
  sqlite.prepare("INSERT OR REPLACE INTO organization_feature_settings (organization_id,feature_key,value,updated_at) VALUES ('org',?,?, '2026-10-26')").run(key, JSON.stringify(value))
}
function additions(projectId: string, organizationId = "org"): void {
  sqlite.prepare("INSERT INTO project_field_cost_codes (project_id,organization_id,codes_json,updated_at) VALUES (?,?,?, '2026-10-26')").run(projectId, organizationId, JSON.stringify([{ code: "48 14 00", name: "Solar" }]))
}

describe("explicit Field Mode code boundaries", () => {
  it("uses explicit company defaults without narrowing Full Compass", async () => {
    settings("field-cost-codes", { defaultCodes: [{ code: "03 30 00", name: "Concrete" }] })
    const list = await dailyLogCostCodeList(db, "org", "job")
    expect(list.phoneOptions.map((code) => code.code)).toEqual(["03 30 00"])
    expect(list.options.some((code) => code.code === "48 14 00")).toBe(true)
    expect(list.options.length).toBeGreaterThan(1000)
  })
  it("treats empty defaults as intentional rather than falling back to the catalog", async () => {
    settings("field-cost-codes", { defaultCodes: [] })
    const form = phoneDailyLogForm(await dailyLogFormSetup(db, "org", "job"))
    expect(form.costCodes).toEqual([])
    expect(form.requirements.requireCostCodeTime).toBe(false)
  })
  it("adds codes for just one project and retains inherited defaults", async () => {
    settings("field-cost-codes", { defaultCodes: [{ code: "03 30 00", name: "Concrete" }] })
    additions("job")
    expect((await dailyLogCostCodeList(db, "org", "job")).phoneOptions.map((code) => code.code)).toEqual(["03 30 00", "48 14 00"])
    expect((await dailyLogCostCodeList(db, "org", "peer")).phoneOptions.map((code) => code.code)).toEqual(["03 30 00"])
    sqlite.exec("DELETE FROM project_field_cost_codes WHERE project_id='job'")
    expect((await dailyLogCostCodeList(db, "org", "job")).phoneOptions.map((code) => code.code)).toEqual(["03 30 00"])
  })
  it("allows deliberate project additions when the department has no default Field list", async () => {
    additions("design")
    expect((await dailyLogCostCodeList(db, "org", "design")).phoneOptions.map((code) => code.code)).toEqual(["48 14 00"])
  })
  it("does not let a budget or catalog update expand Field choices", async () => {
    settings("field-cost-codes", { defaultCodes: [{ code: "03 30 00", name: "Concrete" }] })
    sqlite.exec("INSERT INTO project_budget_lines (id,project_id,cost_code,description,csi_division,csi_division_name,created_at,updated_at) VALUES ('budget','job','48 14 00','Solar','48','Power','2026-10-26','2026-10-26')")
    const list = await dailyLogCostCodeList(db, "org", "job")
    expect(list.options[0]?.code).toBe("48 14 00")
    expect(list.phoneOptions.map((code) => code.code)).toEqual(["03 30 00"])
  })
  it("keeps internal phone-enabled duties and explicit additions separate from job defaults", async () => {
    sqlite.exec("UPDATE projects SET workspace_kind='office' WHERE id='job'")
    settings("field-cost-codes", { defaultCodes: [{ code: "03 30 00", name: "Concrete" }] })
    settings("internal-duties", { duties: [
      { code: "OFFICE", label: "Office meeting", workspace: "office", active: true, onPhones: true },
      { code: "PRIVATE", label: "Office only", workspace: "office", active: true, onPhones: false },
    ] })
    additions("job")
    expect((await dailyLogCostCodeList(db, "org", "job")).phoneOptions.map((code) => ({ code: code.code, group: code.group }))).toEqual([{ code: "OFFICE", group: "Customized duty codes" }, { code: "48 14 00", group: "Project additions" }])
  })
  it("does not expose a foreign organization or mismatched override", async () => {
    additions("job", "other")
    expect((await dailyLogCostCodeList(db, "org", "job")).phoneOptions.some((code) => code.code === "48 14 00")).toBe(false)
    expect(await dailyLogCostCodeList(db, "org", "foreign")).toMatchObject({ options: [], phoneOptions: [] })
  })
  it("preserves code access for legacy projects with no organization recorded", async () => {
    sqlite.exec("INSERT INTO projects (id,name,department,created_at,updated_at) VALUES ('legacy','Legacy job','O','2026-10-26','2026-10-26')")
    const list = await dailyLogCostCodeList(db, "org", "legacy")
    expect(list.options.length).toBeGreaterThan(1000)
    expect(list.phoneOptions.length).toBeGreaterThan(0)
  })

  it("keeps invalid persisted additions empty and deduplicates inherited codes", () => {
    expect(parseProjectFieldCostCodes('{"code":"x"}')).toEqual([])
    expect(fieldCostCodeListSchema.safeParse([{ code: "X", name: "One" }, { code: "X", name: "Two" }]).success).toBe(false)
    expect(mergeFieldCostCodes([{ code: "X", name: "One" }], [{ code: "X", name: "Two" }])).toEqual([{ code: "X", name: "Two" }])
  })
})
