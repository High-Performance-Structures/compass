import Database from "better-sqlite3"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("assembly builder-fee report migration", () => {
  it("defaults existing and new estimates to off without changing amounts", () => {
    const db = new Database(":memory:")
    try {
      db.exec("CREATE TABLE project_estimates (id TEXT PRIMARY KEY, builder_fee_cents INTEGER, estimate_total_cents INTEGER); INSERT INTO project_estimates VALUES ('existing', 25, 125)")
      db.exec(readFileSync(resolve(process.cwd(), "drizzle/0179_estimate_assembly_builder_fee.sql"), "utf8"))
      db.exec("INSERT INTO project_estimates (id, builder_fee_cents, estimate_total_cents) VALUES ('new', 40, 240)")
      expect(db.prepare("SELECT * FROM project_estimates ORDER BY id").all()).toEqual([
        { id: "existing", builder_fee_cents: 25, estimate_total_cents: 125, show_assembly_builder_fee: 0 },
        { id: "new", builder_fee_cents: 40, estimate_total_cents: 240, show_assembly_builder_fee: 0 },
      ])
    } finally { db.close() }
  })
})
