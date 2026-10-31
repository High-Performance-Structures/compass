import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { enumeratedSchemaColumns, STATUS_COLUMN_EXEMPTIONS } from "../../../scripts/architecture-metrics.mjs"

/*
 * The statusColumnsWithoutList ratchet (architecture standard, section 3):
 * which schema columns count as enumerated, and which count as listed.
 */

const SAMPLE = `
import { STATUSES } from "../lib/domain/sample/statuses"
export const letters = sqliteTable("letters", {
  id: text("id").primaryKey(),
  status: text("status", { enum: STATUSES }).notNull(),
  kind: text("kind", { enum: ["a", "b"] }).notNull(),
  role: text("role"),
  mood: text("mood", { enum: ["calm"] }),
  title: text("title").notNull(),
})
export const customers = sqliteTable(
  "customers",
  { state: text("state") },
)
`

describe("enumeratedSchemaColumns", () => {
  it("finds status-like names and inline enums, and recognises shared lists", () => {
    const columns = enumeratedSchemaColumns(SAMPLE)
    const summary = columns.map((column: { key: string; listed: boolean; exempt: boolean; listName: string | null }) => [
      column.key,
      column.listed,
      column.exempt,
      column.listName,
    ])
    expect(summary).toEqual([
      ["letters.status", true, false, "STATUSES"],
      ["letters.kind", false, false, null],
      ["letters.role", false, false, null],
      ["letters.mood", false, false, null],
      ["customers.state", false, true, null],
    ])
  })

  it("names only real schema columns in the exemptions", () => {
    const schemaDir = join(process.cwd(), "src/db")
    const keys = new Set(
      readdirSync(schemaDir)
        .filter((file) => /^schema.*\.ts$/.test(file))
        .flatMap((file) =>
          enumeratedSchemaColumns(readFileSync(join(schemaDir, file), "utf8")).map(
            (column: { key: string }) => column.key,
          ),
        ),
    )
    const stale = Object.keys(STATUS_COLUMN_EXEMPTIONS).filter((key) => !keys.has(key))
    expect(stale).toEqual([])
  })
})
