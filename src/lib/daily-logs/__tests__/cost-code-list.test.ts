import { beforeEach, describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { loadProjectCostCodeCatalog, loadProjectCostCodeChoices } from "@/lib/cost-codes/catalog-server"
import { loadCostCodeOptions } from "@/lib/shop-tickets/data"
import { rfqScopeCodingErrors } from "@/lib/rfqs/cost-codes"
import { dailyLogCostCodeList, dailyLogFormSetup, phoneDailyLogForm, ON_BUDGET_GROUP } from "@/lib/daily-logs/cost-code-lines"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { projectEstimateCostCodeCatalog } from "@/lib/estimates/project-cost-code-catalog"
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

  it.each(["field", "hps"])("keeps the full browser catalog but only curated crew codes on %s phones", async (projectId) => {
    const list = await dailyLogCostCodeList(db, "org-1", projectId)
    expect(list.source).toBe("company")
    expect(list.options.some((option) => option.code === "00 31 32")).toBe(true)
    expect(list.options.some((option) => option.code === "01 31 19.13")).toBe(true)
    expect(list.options.some((option) => option.code === "06 11 00")).toBe(true)
    expect(list.options.filter((option) => option.code === "00 25 00")).toHaveLength(1)
    const settings = await readFeatureSettings(db, "org-1", "daily-logs")
    const existingPhoneCodes = new Set([
      ...settings.laborCostCodes.filter((row) => row.active).map((row) => row.code),
      ...projectEstimateCostCodeCatalog([], []).filter((row) => row.divisionCode === "00" || row.divisionCode === "01").map((row) => row.code),
    ])
    expect(new Set(list.phoneOptions.map((row) => row.code))).toEqual(existingPhoneCodes)
    expect(list.phoneOptions.some((row) => row.code === "48 14 00")).toBe(false)
  })

  it("offers the full catalog to every job department without changing phone eligibility", async () => {
    const list = await dailyLogCostCodeList(db, "org-1", "nutech")
    expect(list.options.map((option) => option.code)).toEqual((await loadProjectCostCodeCatalog(db)).map((row) => row.code).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
    expect(list.phoneOptions).toEqual([])
  })

  it("keeps O job daily logs and shop-ticket choices consistent with the full estimate catalog", async () => {
    const catalog = await loadProjectCostCodeCatalog(db)
    const logs = await dailyLogCostCodeList(db, "org-1", "field")
    const shop = await loadCostCodeOptions(db)
    const expected = new Set(catalog.map((row) => row.code))
    expect(expected.size).toBeGreaterThanOrEqual(1169)
    expect(new Set(logs.options.map((row) => row.code))).toEqual(expected)
    expect(new Set(shop.map((row) => row.code))).toEqual(expected)
    expect(logs.phoneOptions.some((row) => row.code === "48 14 00")).toBe(false)
    const outsideLabor = catalog.find((row) => row.code === "48 14 00")
    expect(outsideLabor).toBeDefined()
    const form = validateDailyLogForm({ logDate: "2026-10-26", workCompleted: "Test full catalog", crewPresent: "", materialsUsed: "", safetyIncidents: "", visitorLog: "", issues: "", notes: "", workLines: [{ costCode: "48 14 00", hours: "1", description: "Work" }] }, DEFAULT_DAILY_LOG_REQUIREMENTS, logs.options)
    expect(form.errors).toEqual([])
    expect(rfqScopeCodingErrors([{ costCode: "48 14 00", phaseCode: "48" }], new Map(catalog.map((row) => [row.code, row.divisionCode])), new Set(catalog.map((row) => row.divisionCode)))).toEqual([])
  })

  it("keeps unique project budget codes first even for O jobs with a labor list", async () => {
    sqlite.exec(`INSERT INTO project_budget_lines (id, project_id, cost_code, description, csi_division, csi_division_name, created_at, updated_at)
      VALUES ('o-budget', 'field', 'JOB-ONLY', 'Job scope', '01', 'General Requirements', '2026-10-26', '2026-10-26');`)
    const list = await dailyLogCostCodeList(db, "org-1", "field")
    expect(list.options[0]).toMatchObject({ code: "JOB-ONLY", group: ON_BUDGET_GROUP })
    expect(list.options.some((row) => row.code === "48 14 00")).toBe(true)
  })

  it("uses the latest ready budget, ignores building imports, and retains historical choices for edits", async () => {
    sqlite.exec(`INSERT INTO project_budget_applications (id,project_id,application_number,period_to,status,created_at,updated_at)
      VALUES ('old','field','1','2026-08-31','ready','2026-08-31','2026-08-31'),
             ('current','field','2','2026-09-30','ready','2026-09-30','2026-09-30'),
             ('importing','field','3','2026-10-31','building','2026-10-31','2026-10-31');`)
    for (const [id, application, code] of [["line-old", "old", "OLD"], ["line-current", "current", "CURRENT"], ["line-importing", "importing", "IMPORTING"]]) {
      sqlite.prepare("INSERT INTO project_budget_lines (id,project_id,application_id,cost_code,description,csi_division,csi_division_name,created_at,updated_at) VALUES (?,'field',?,?,?,'01','General','2026-10-26','2026-10-26')").run(id, application, code, code)
    }
    const choices = await loadProjectCostCodeChoices(db, "field")
    expect(choices.filter((row) => row.onBudget).map((row) => row.code)).toEqual(["CURRENT"])
    expect(choices.find((row) => row.code === "OLD")).toMatchObject({ onBudget: false })
    expect(choices.some((row) => row.code === "IMPORTING")).toBe(false)
    const otherProject = await loadProjectCostCodeChoices(db, "hps")
    expect(otherProject.some((row) => row.code === "CURRENT")).toBe(false)
  })

  it("keeps internal duty choices while making the company catalog searchable and valid", async () => {
    sqlite.exec("UPDATE projects SET workspace_kind='office' WHERE id='field'")
    const list = await dailyLogCostCodeList(db, "org-1", "field")
    expect(list.source).toBe("duties")
    expect(list.options.some((row) => row.group === "Customized duty codes")).toBe(true)
    expect(list.options.find((row) => row.code === "48 14 00")).toMatchObject({ group: "All cost codes" })
    expect(list.phoneOptions).toEqual([])
  })

  it("keeps preconstruction codes available if D is configured to use the labor list", async () => {
    sqlite.exec(`INSERT INTO organization_feature_settings (organization_id, feature_key, value, updated_at)
      VALUES ('org-1', 'daily-logs', '{"laborCodeDepartments":["D","H","O"]}', '2026-10-21');`)
    const list = await dailyLogCostCodeList(db, "org-1", "design")
    expect(list.source).toBe("company")
    expect(list.options.some((option) => option.code === "00 31 32")).toBe(true)
    expect(list.options.filter((option) => option.code === "00 25 00")).toHaveLength(1)
    const settings = await readFeatureSettings(db, "org-1", "daily-logs")
    expect(list.phoneOptions).toEqual(expect.arrayContaining(settings.laborCostCodes.filter((row) => row.active).map(({ code, name }) => ({ code, name, label: `${code} ${name}`, group: "" }))))
    expect(list.phoneOptions.some((row) => row.code === "00 25 00")).toBe(true)
    expect(list.phoneOptions.some((row) => row.code === "48 14 00")).toBe(false)
  })

  it("serializes only active configured labor codes even when the budget and catalog contain other codes", async () => {
    sqlite.prepare("INSERT INTO organization_feature_settings (organization_id, feature_key, value, updated_at) VALUES ('org-1', 'daily-logs', ?, '2026-10-26')").run(JSON.stringify({
      laborCostCodes: [
        { code: "CREW", payrollId: "1", name: "Crew work", active: true },
        { code: "OLD", payrollId: "2", name: "Retired work", active: false },
      ],
    }))
    sqlite.exec(`INSERT INTO project_budget_lines (id, project_id, cost_code, description, csi_division, csi_division_name, created_at, updated_at)
      VALUES ('budget-phone', 'field', 'JOB-ONLY', 'Job scope', '01', 'General Requirements', '2026-10-26', '2026-10-26');`)
    const setup = await dailyLogFormSetup(db, "org-1", "field")
    expect(setup.costCodes.some((row) => row.code === "JOB-ONLY")).toBe(true)
    expect(setup.costCodes.some((row) => row.code === "48 14 00")).toBe(true)
    const form = phoneDailyLogForm(setup)
    expect(form.costCodes[0]).toEqual({ code: "CREW", name: "Crew work", label: "CREW Crew work", group: "" })
    expect(form.costCodes.some((row) => row.code === "00 25 00")).toBe(true)
    const preconstructionCodes = new Set(projectEstimateCostCodeCatalog([], []).filter((row) => row.divisionCode === "00" || row.divisionCode === "01").map((row) => row.code))
    expect(form.costCodes.filter((row) => !preconstructionCodes.has(row.code)).map((row) => row.code)).toEqual(["CREW"])
    expect(form.requirements.requireCostCodeTime).toBe(true)
  })

  it("downloads only enabled duties for the selected internal workspace", async () => {
    sqlite.exec("UPDATE projects SET workspace_kind='field' WHERE id='field'")
    sqlite.prepare("INSERT INTO organization_feature_settings (organization_id, feature_key, value, updated_at) VALUES ('org-1', 'internal-duties', ?, '2026-10-26')").run(JSON.stringify({ duties: [
      { code: "YARD", label: "Yard work", workspace: "field", active: true },
      { code: "HIDDEN", label: "Office codes it", workspace: "field", active: true, onPhones: false },
      { code: "OLD", label: "Retired duty", workspace: "field", active: false, onPhones: true },
      { code: "OFFICE", label: "Office meeting", workspace: "office", active: true, onPhones: true },
    ] }))
    const setup = await dailyLogFormSetup(db, "org-1", "field")
    expect(setup.costCodes.some((row) => row.code === "48 14 00")).toBe(true)
    expect(phoneDailyLogForm(setup).costCodes.map((row) => row.code)).toEqual(["YARD"])
    sqlite.exec("UPDATE projects SET workspace_kind='office' WHERE id='field'")
    const office = await dailyLogFormSetup(db, "org-1", "field")
    expect(phoneDailyLogForm(office).costCodes.map((row) => row.code)).toEqual(["OFFICE"])
  })

  it("does not fall back to the company catalog when no crew codes are active", async () => {
    sqlite.prepare("INSERT INTO organization_feature_settings (organization_id, feature_key, value, updated_at) VALUES ('org-1', 'daily-logs', ?, '2026-10-26')").run(JSON.stringify({ laborCostCodes: [] }))
    const setup = await dailyLogFormSetup(db, "org-1", "field")
    expect(setup.costCodes.length).toBeGreaterThan(1000)
    expect(phoneDailyLogForm(setup)).toMatchObject({ costCodes: [], requirements: { requireCostCodeTime: false } })
  })
})
