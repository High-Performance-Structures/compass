import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"

import { ID_REFERENCE_EXEMPT, ID_REFERENCE_NEEDS_REVIEW, ID_REFERENCE_TRIGGERS } from "@/db/id-integrity"
import { normalizedSql, recorded, recordingD1 } from "@/lib/domain/__tests__/recording-d1"
import { companyMergeRepairStatements, companyReferenceMoveStatements } from "@/lib/domain/contacts/company-merge"
import {
  COMPANY_MERGE_SIDES,
  COMPANY_REFERENCES,
  type CompanyMergeSide,
} from "@/lib/domain/contacts/company-merge-references"
import { isRecord } from "@/lib/shared/guards"

/*
 * Ratchet: every column that points at a vendor or a client company must be
 * handled by the company merge, either moved to the kept company or kept on
 * the archived one with a written reason, in company-merge-references.ts.
 * A new table with a foreign key to vendors or customers fails here until it
 * is listed, so a merge can never again strand a feature's rows on a hidden
 * merged company (the lost trade docs of 2026-11-01).
 */

const sqlite = new Database(":memory:")
const dir = join(process.cwd(), "drizzle")
for (const file of readdirSync(dir).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
  sqlite.exec(readFileSync(join(dir, file), "utf8").replaceAll("--> statement-breakpoint", ""))
}

const PARENTS: Readonly<Record<string, CompanyMergeSide>> = { vendors: "vendor", customers: "customer" }

function rows(query: string): Record<string, unknown>[] {
  return sqlite.prepare(query).all().filter(isRecord)
}

const tables = rows("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => String(row.name))
const columnsOf = (table: string): readonly string[] => rows(`PRAGMA table_info(\`${table}\`)`).map((row) => String(row.name))

type Required = { readonly side: CompanyMergeSide; readonly table: string; readonly column: string; readonly why: string }

function requiredReferences(): Required[] {
  const required: Required[] = []
  for (const table of tables) {
    for (const key of rows(`PRAGMA foreign_key_list(\`${table}\`)`)) {
      const side = PARENTS[String(key.table)]
      if (side) required.push({ side, table, column: String(key.from), why: "foreign key" })
    }
  }
  for (const entry of [...ID_REFERENCE_TRIGGERS, ...ID_REFERENCE_NEEDS_REVIEW]) {
    const side = PARENTS[entry.parent]
    if (side) required.push({ side, table: entry.table, column: entry.column, why: "id-integrity reference" })
  }
  // Polymorphic id columns whose reason names a vendor or customer company (not their people).
  for (const [key, reason] of Object.entries(ID_REFERENCE_EXEMPT)) {
    const [table = "", column = ""] = key.split(".")
    for (const side of COMPANY_MERGE_SIDES) {
      if (new RegExp(`\\b${side}(?![_a-z])`).test(reason)) required.push({ side, table, column, why: "polymorphic id" })
    }
  }
  return required
}

describe("company merge reference ratchet", () => {
  it("handles every column that references vendors or customers", () => {
    const missing = requiredReferences()
      .filter((need) => !COMPANY_REFERENCES.some((reference) =>
        reference.side === need.side && reference.table === need.table && reference.column === need.column))
      .map((need) => `${need.side}: ${need.table}.${need.column} (${need.why})`)
    expect(missing, "List each in COMPANY_REFERENCES (src/lib/domain/contacts/company-merge-references.ts): move it in the owning store's companyMerge*Statements, or keep it with a written reason.").toEqual([])
  })

  it("lists only real columns, and gives every kept column a reason", () => {
    const stale = COMPANY_REFERENCES.filter((reference) => !columnsOf(reference.table).includes(reference.column))
      .map((reference) => `${reference.table}.${reference.column}`)
    expect(stale).toEqual([])
    const unexplained = COMPANY_REFERENCES.filter((reference) => reference.handling.action === "keep" && reference.handling.reason.trim().length < 20)
    expect(unexplained).toEqual([])
  })

  for (const side of COMPANY_MERGE_SIDES) {
    it(`moves every "move" reference for ${side}s, each statement guarded`, () => {
      const move = { side, mode: "merge", organizationId: "o", sourceId: "s", destinationId: "d", now: "n" } as const
      const statements = companyReferenceMoveStatements(recordingD1(), move).map((statement) => normalizedSql(recorded(statement).sql))
      for (const sql of statements) expect(sql).toContain("merge_source.id = ?")
      const unmoved = COMPANY_REFERENCES
        .filter((reference) => reference.side === side && reference.handling.action === "move")
        .filter((reference) => !statements.some((sql) => {
          if (!sql.startsWith(`UPDATE ${reference.table} SET `)) return false
          const set = sql.slice(0, sql.indexOf(" WHERE "))
          return new RegExp(`[ ,]${reference.column} = `).test(set)
        }))
        .map((reference) => `${reference.table}.${reference.column}`)
      expect(unmoved).toEqual([])
    })
  }

  it("repairs with the same moves, after the repair event", () => {
    const pair = { side: "vendor", organizationId: "o", sourceId: "s", destinationId: "d", now: "n" } as const
    const repair = companyMergeRepairStatements(recordingD1(), pair).map((statement) => normalizedSql(recorded(statement).sql))
    const moves = companyReferenceMoveStatements(recordingD1(), { ...pair, mode: "repair" }).map((statement) => normalizedSql(recorded(statement).sql))
    expect(repair[0]).toMatch(/^INSERT INTO activity_events/)
    expect(repair.slice(1)).toEqual(moves)
  })
})
