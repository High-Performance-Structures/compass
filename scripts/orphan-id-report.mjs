#!/usr/bin/env bun
// Read-only report: for every internal *_id column that has no foreign key
// (the columns 0281 guards with validation triggers, plus the ones still
// waiting for review) it counts rows whose id points at no parent row and
// lists a sample of them. Run it against production BEFORE applying 0281:
// a trigger does not touch existing rows, but a later UPDATE that sets an
// orphaned column again would abort.
//
//   bun scripts/orphan-id-report.mjs --local                 # local D1
//   bun scripts/orphan-id-report.mjs --remote                # production D1 (read only)
//   bun scripts/orphan-id-report.mjs --remote --limit 50 --out orphan-report.json
//   bun scripts/orphan-id-report.mjs --local --database compass-demo-db
//
// One small query per column (LEFT JOIN parent ... LIMIT, then COUNT), never
// a UNION across tables. The column list lives in src/db/id-integrity.ts.
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"

import { ID_REFERENCE_NEEDS_REVIEW, ID_REFERENCE_TRIGGERS } from "../src/db/id-integrity.ts"

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

const remote = process.argv.includes("--remote")
const local = process.argv.includes("--local")
if (remote === local) {
  console.error("Pass exactly one of --local or --remote.")
  process.exit(1)
}
const database = argValue("--database") ?? "compass-db"
const limit = Math.max(1, Math.min(500, Number(argValue("--limit") ?? 20) || 20))
const out = argValue("--out") ?? `orphan-id-report-${remote ? "remote" : "local"}.json`

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/

/** Runs one SELECT through wrangler and returns its rows. */
function select(sql) {
  // Guard: this report must never write.
  if (!/^\s*select\b/i.test(sql) || sql.includes(";")) {
    throw new Error("orphan-id-report only runs single SELECT statements")
  }
  const output = execFileSync(
    "bunx",
    ["wrangler", "d1", "execute", database, remote ? "--remote" : "--local", "--json", "--command", sql],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  )
  return JSON.parse(output).flatMap((result) => result.results ?? [])
}

function check({ table, column, parent, parentColumn = "id" }) {
  for (const name of [table, column, parent, parentColumn]) {
    if (!IDENTIFIER.test(name)) throw new Error(`unexpected identifier ${name}`)
  }
  const from = `FROM "${table}" AS child LEFT JOIN "${parent}" AS parent ON parent."${parentColumn}" = child."${column}"
    WHERE child."${column}" IS NOT NULL AND parent."${parentColumn}" IS NULL`
  try {
    const sample = select(`SELECT child.rowid AS row_id, child."${column}" AS orphan_id ${from} LIMIT ${limit}`)
    const count =
      sample.length < limit ? sample.length : Number(select(`SELECT COUNT(*) AS n ${from}`)[0]?.n ?? 0)
    return { table, column, parent, orphanCount: count, sample }
  } catch (error) {
    // A table that exists in the schema but not on this database (or a
    // network failure) is reported, not fatal, so one bad column does not
    // hide the rest of the report.
    return { table, column, parent, error: String(error?.stderr ?? error?.message ?? error).slice(0, 500) }
  }
}

const columns = [
  ...ID_REFERENCE_TRIGGERS.map((entry) => ({ ...entry, group: "triggered" })),
  ...ID_REFERENCE_NEEDS_REVIEW.map((entry) => ({ ...entry, group: "needs-review" })),
]

const results = []
for (const entry of columns) {
  const result = { group: entry.group, ...check(entry) }
  results.push(result)
  const status = "error" in result ? "ERROR" : String(result.orphanCount)
  console.log(`${entry.group.padEnd(12)} ${`${entry.table}.${entry.column}`.padEnd(64)} ${status}`)
}

const report = {
  generatedAt: new Date().toISOString(),
  database,
  target: remote ? "remote" : "local",
  readOnly: true,
  sampleLimit: limit,
  totals: {
    columns: results.length,
    columnsWithOrphans: results.filter((result) => (result.orphanCount ?? 0) > 0).length,
    orphanRows: results.reduce((sum, result) => sum + (result.orphanCount ?? 0), 0),
    errors: results.filter((result) => "error" in result).length,
  },
  // Triggered columns with orphans: an UPDATE that sets the column again
  // aborts after 0281 until the row is repaired or the column is cleared.
  triggeredWithOrphans: results
    .filter((result) => result.group === "triggered" && (result.orphanCount ?? 0) > 0)
    .map((result) => `${result.table}.${result.column}`),
  results,
}
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
console.log(`\nRead only: nothing was written to the database. Report: ${out}`)
console.log(
  `${report.totals.columnsWithOrphans} of ${report.totals.columns} columns have orphans (${report.totals.orphanRows} rows); ${report.totals.errors} errors.`,
)
