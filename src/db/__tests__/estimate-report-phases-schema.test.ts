import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { getTableColumns } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { projectEstimateLines, projectEstimateReportPhases } from "@/db/schema-estimates"

describe("custom estimate report phase persistence", () => {
  it("stores phase presentation separately from original CSI codes", () => {
    expect(projectEstimateReportPhases.name.name).toBe("name")
    expect(projectEstimateReportPhases.itemize.name).toBe("itemize")
    expect(projectEstimateLines.reportPhaseId.name).toBe("report_phase_id")
  })

  it("keeps the RFQ guarded insert-select aligned with the expanded estimate line schema", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/actions/project-rfq-bids.ts"), "utf8")
    const select = source.match(/insert\(projectEstimateLines\)\.select\(\s*sql`SELECT([\s\S]*?)WHERE EXISTS/)?.[1]
    if (!select) throw new Error("RFQ guarded estimate line insert not found")
    // Use the actual action projection and Drizzle target column order, not a
    // duplicated fixture; the existence guard does not affect projection arity.
    const projection = select.replace(/\$\{[^}]+\}/g, "'sample'")
    const columns = Object.values(getTableColumns(projectEstimateLines)).map((column) => `"${column.name}"`)
    const db = new DatabaseSync(":memory:")
    try {
      db.exec(`CREATE TABLE project_estimate_lines (${columns.map((column) => `${column} TEXT`).join(", ")})`)
      db.prepare(`INSERT INTO project_estimate_lines (${columns.join(", ")}) SELECT ${projection}`).run()
      expect(db.prepare("SELECT template_line_id, report_phase_id, division_code FROM project_estimate_lines").get()).toMatchObject({ template_line_id: null, report_phase_id: null, division_code: "sample" })
    } finally { db.close() }
  })

  it("migrates safely, supports repeated source divisions, and preserves costs on deletion", () => {
    const db = new DatabaseSync(":memory:")
    try {
      db.exec(`PRAGMA foreign_keys = ON;
        CREATE TABLE projects (id TEXT PRIMARY KEY);
        CREATE TABLE project_estimates (id TEXT PRIMARY KEY);
        CREATE TABLE project_estimate_lines (id TEXT PRIMARY KEY, estimate_id TEXT, division_code TEXT, cost_code TEXT, line_total_cents INTEGER);
        INSERT INTO projects VALUES ('project-1');
        INSERT INTO project_estimates VALUES ('estimate-1');
        INSERT INTO project_estimate_lines VALUES ('line-1', 'estimate-1', '03', '03 11 19', 3600000);`)
      db.exec(readFileSync(resolve(process.cwd(), "drizzle/0161_estimate_report_phases.sql"), "utf8"))
      expect(db.prepare("SELECT report_phase_id FROM project_estimate_lines").get()).toMatchObject({ report_phase_id: null })
      const insert = db.prepare(`INSERT INTO project_estimate_report_phases
        (id, project_id, estimate_id, division_code, name, created_at, updated_at)
        VALUES (?, 'project-1', 'estimate-1', '03', ?, '2026-09-18', '2026-09-18')`)
      for (let index = 0; index < 150; index++) insert.run(`phase-${index}`, `Phase ${index}`)
      expect(db.prepare("SELECT COUNT(*) AS count FROM project_estimate_report_phases").get()).toMatchObject({ count: 150 })
      db.exec("UPDATE project_estimate_lines SET report_phase_id = 'phase-0'; DELETE FROM project_estimate_report_phases WHERE id = 'phase-0';")
      expect(db.prepare("SELECT * FROM project_estimate_lines").get()).toMatchObject({ report_phase_id: null, division_code: "03", cost_code: "03 11 19", line_total_cents: 3600000 })
      db.exec("DELETE FROM project_estimates WHERE id = 'estimate-1'")
      expect(db.prepare("SELECT COUNT(*) AS count FROM project_estimate_report_phases").get()).toMatchObject({ count: 0 })
    } finally { db.close() }
  })
})
