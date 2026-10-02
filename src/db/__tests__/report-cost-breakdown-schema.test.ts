import Database from "better-sqlite3"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("customer report cost breakdown migration", () => {
  it("hides breakdowns for existing and new estimates without changing their report choices or amounts", () => {
    const db = new Database(":memory:")
    try {
      db.exec("CREATE TABLE project_estimates (id TEXT PRIMARY KEY, client_report_mode TEXT, builder_fee_cents INTEGER, estimate_total_cents INTEGER); INSERT INTO project_estimates VALUES ('existing', 'assembly_items', 25, 125)")
      db.exec(readFileSync(resolve(process.cwd(), "drizzle/0180_estimate_report_cost_breakdowns.sql"), "utf8"))
      db.exec("INSERT INTO project_estimates (id, client_report_mode, builder_fee_cents, estimate_total_cents) VALUES ('new', 'line_items', 40, 240)")
      expect(db.prepare("SELECT * FROM project_estimates ORDER BY id").all()).toEqual([
        { id: "existing", client_report_mode: "assembly_items", builder_fee_cents: 25, estimate_total_cents: 125, show_cost_breakdowns: 0 },
        { id: "new", client_report_mode: "line_items", builder_fee_cents: 40, estimate_total_cents: 240, show_cost_breakdowns: 0 },
      ])
    } finally { db.close() }
  })
})
