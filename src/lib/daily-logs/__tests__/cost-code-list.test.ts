import { beforeEach, describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { dailyLogCostCodeList, ON_BUDGET_GROUP } from "@/lib/daily-logs/cost-code-lines"
import { validateDailyLogForm, DEFAULT_DAILY_LOG_REQUIREMENTS } from "@/lib/daily-logs/daily-log-form"
import { d1, migratedSqlite, type Sqlite } from "./sqlite-d1"

describe("daily log cost code lists", () => {
  let sqlite: Sqlite
  let db: ReturnType<typeof getDb>

  beforeEach(() => {
    sqlite = migratedSqlite()
    sqlite.exec(`
      INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at)
        VALUES ('org-1', 'Example', 'example', 'internal', 1, '2026-10-21', '2026-10-21');
      INSERT INTO projects (id, name, organization_id, department, project_number, status, created_at)
        VALUES ('design', 'Design job', 'org-1', 'D', 'D-26-33', 'active', '2026-10-21'),
               ('field', 'Construction job', 'org-1', 'O', 'O-210', 'active', '2026-10-21'),
               ('hps', 'HPS job', 'org-1', 'H', 'H-210', 'active', '2026-10-21'),
               ('nutech', 'NuTech job', 'org-1', 'N', 'N-210', 'active', '2026-10-21');
      INSERT INTO sage_cost_codes (id, code, description, display_label, division_code, division_description, division_display_label, active, created_at, updated_at)
        VALUES ('concrete', '03 30 00', 'Concrete', '03 30 00 Concrete', '03', 'Concrete', '03 Concrete', 1, '2026-10-21', '2026-10-21');
    `)
    db = getDb(d1(sqlite))
  })

  it("offers and accepts Division 00 and 01 on D jobs even when Sage has neither", async () => {
    const list = await dailyLogCostCodeList(db, "org-1", "design")
    expect(list.source).toBe("company")
    expect(list.phoneOptions).toEqual([])
    expect(list.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "00 25 00", name: expect.stringContaining("Procurement Meetings") }),
      expect.objectContaining({ code: "01 31 19.13", name: expect.stringContaining("Preconstruction Meetings") }),
      expect.objectContaining({ code: "03 30 00", name: "Concrete" }),
    ]))
    const result = validateDailyLogForm({
      logDate: "2026-10-21", workCompleted: "Planning",
      crewPresent: "", materialsUsed: "", safetyIncidents: "", visitorLog: "", issues: "", notes: "",
      workLines: [{ costCode: "00 25 00", hours: "1", description: "Procurement" }, { costCode: "01 31 19.13", hours: "2", description: "Preconstruction" }],
    }, DEFAULT_DAILY_LOG_REQUIREMENTS, list.options)
    expect(result.errors).toEqual([])
    expect(result.workLines).toHaveLength(2)
  })

  it("keeps budget codes first without duplicating a catalog code", async () => {
    sqlite.exec(`INSERT INTO project_budget_lines (id, project_id, cost_code, description, csi_division, csi_division_name, created_at, updated_at)
      VALUES ('budget', 'design', '00 25 00', 'Job procurement', '00', 'Procurement', '2026-10-21', '2026-10-21');`)
    const list = await dailyLogCostCodeList(db, "org-1", "design")
    expect(list.options[0]).toMatchObject({ code: "00 25 00", group: ON_BUDGET_GROUP })
    expect(list.options.filter((option) => option.code === "00 25 00")).toHaveLength(1)
  })

  it.each(["field", "hps"])("includes 00/01 alongside the existing labor codes on %s, including phones", async (projectId) => {
    const list = await dailyLogCostCodeList(db, "org-1", projectId)
    expect(list.source).toBe("labor")
    expect(list.options.some((option) => option.code === "00 31 32")).toBe(true)
    expect(list.options.some((option) => option.code === "01 31 19.13")).toBe(true)
    expect(list.options.some((option) => option.code === "06 11 00")).toBe(true)
    expect(list.options.filter((option) => option.code === "00 25 00")).toHaveLength(1)
    expect(list.phoneOptions).toEqual(list.options)
  })

  it("leaves other departments' catalogs unchanged", async () => {
    const list = await dailyLogCostCodeList(db, "org-1", "nutech")
    expect(list.options.map((option) => option.code)).toEqual(["03 30 00"])
    expect(list.phoneOptions).toEqual([])
  })

  it("keeps preconstruction codes available if D is configured to use the labor list", async () => {
    sqlite.exec(`INSERT INTO organization_feature_settings (organization_id, feature_key, value, updated_at)
      VALUES ('org-1', 'daily-logs', '{"laborCodeDepartments":["D","H","O"]}', '2026-10-21');`)
    const list = await dailyLogCostCodeList(db, "org-1", "design")
    expect(list.source).toBe("labor")
    expect(list.options.some((option) => option.code === "00 31 32")).toBe(true)
    expect(list.options.filter((option) => option.code === "00 25 00")).toHaveLength(1)
    expect(list.phoneOptions).toEqual(list.options)
  })
})
