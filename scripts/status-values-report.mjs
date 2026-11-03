#!/usr/bin/env bun
// Read-only report: for every status, state, kind, type or role column typed
// with a shared list (`enum: LIST` in src/db/schema*.ts), lists the values
// actually stored in D1 and compares them with the list.
//
//   bun scripts/status-values-report.mjs --local                 # local D1
//   bun scripts/status-values-report.mjs --remote                # production D1 (read only)
//   bun scripts/status-values-report.mjs --local --out tmp/sv    # where to write the files
//   bun scripts/status-values-report.mjs --local --database compass-demo-db
//
// It only runs single-table SELECT DISTINCT statements, a few per wrangler
// call, and never writes. It writes three files to --out (default
// tmp/status-values):
//   report.json      every column: listed values, exact variants, unknown values
//   normalise.sql    UPDATEs for exact case, whitespace or known-spelling
//                    variants. NOT applied: review it, then apply it yourself.
//   review.json      values that match no list entry, for a person to decide
// Classification rules live in src/lib/shared/status-values.ts.
import { execFileSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { distinctValuesSql, normalisationScript, reportColumn } from "../src/lib/shared/status-values.ts"
import { enumeratedSchemaColumns } from "./architecture-metrics.mjs"

const root = process.cwd()

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

const remote = process.argv.includes("--remote")
const local = process.argv.includes("--local")
if (remote === local) {
  console.error("Pass exactly one of --local or --remote.")
  process.exit(2)
}
const database = argValue("--database") ?? "compass-db"
const outDir = argValue("--out") ?? "tmp/status-values"
// Statements per wrangler call. Each is a single-table SELECT DISTINCT, so a
// chunk stays far below D1's limits; it only saves process start-up time.
const CHUNK = 8

/** Every exported string list in src/lib/domain/<module>/statuses.ts. */
async function loadLists() {
  const files = readdirSync(join(root, "src/lib/domain"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, "src/lib/domain", entry.name, "statuses.ts"))
    .filter((path) => {
      try {
        return readFileSync(path, "utf8").length > 0
      } catch {
        return false
      }
    })
  const lists = new Map()
  for (const path of files) {
    const exports = await import(pathToFileURL(path).href)
    for (const [name, value] of Object.entries(exports)) {
      if (Array.isArray(value) && value.every((item) => typeof item === "string")) lists.set(name, value)
    }
  }
  return lists
}

/** Listed columns from the schema files, each with its list's values. */
function listedColumns(lists) {
  const schemaFiles = readdirSync(join(root, "src/db")).filter((file) => /^schema.*\.ts$/.test(file))
  const columns = []
  const unresolved = []
  for (const file of schemaFiles) {
    const text = readFileSync(join(root, "src/db", file), "utf8")
    for (const column of enumeratedSchemaColumns(text)) {
      if (!column.listed) continue
      const list = lists.get(column.listName)
      if (list) columns.push({ table: column.table, column: column.column, listName: column.listName, list })
      else unresolved.push(`${column.key} (${column.listName})`)
    }
  }
  return { columns, unresolved }
}

function assertReadOnly(sql) {
  if (!/^\s*SELECT DISTINCT\b/.test(sql) || sql.includes(";")) {
    throw new Error(`status-values-report only runs single SELECT DISTINCT statements: ${sql}`)
  }
}

function wrangler(sql) {
  const output = execFileSync(
    "bunx",
    ["wrangler", "d1", "execute", database, remote ? "--remote" : "--local", "--json", "--command", sql],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  )
  return JSON.parse(output)
}

/** Stored values per column. A failing chunk is retried one statement at a time, so one missing table only skips itself. */
function readValues(columns) {
  const values = new Map()
  const errors = []
  for (let start = 0; start < columns.length; start += CHUNK) {
    const chunk = columns.slice(start, start + CHUNK)
    const statements = chunk.map((column) => distinctValuesSql(column.table, column.column))
    statements.forEach(assertReadOnly)
    try {
      const results = wrangler(statements.join(";\n"))
      chunk.forEach((column, index) => {
        values.set(column, (results[index]?.results ?? []).map((row) => String(row.value)))
      })
    } catch {
      chunk.forEach((column, index) => {
        try {
          const [result] = wrangler(statements[index])
          values.set(column, (result?.results ?? []).map((row) => String(row.value)))
        } catch (error) {
          errors.push({ table: column.table, column: column.column, error: String(error?.stderr ?? error).slice(0, 300) })
        }
      })
    }
  }
  return { values, errors }
}

const lists = await loadLists()
const { columns, unresolved } = listedColumns(lists)
const { values, errors } = readValues(columns)
const reports = columns.filter((column) => values.has(column)).map((column) => reportColumn(column, values.get(column)))
const sql = normalisationScript(reports)
const review = reports.flatMap((report) =>
  report.unknown.map((value) => ({ table: report.table, column: report.column, listName: report.listName, value })),
)

mkdirSync(outDir, { recursive: true })
writeFileSync(
  join(outDir, "report.json"),
  `${JSON.stringify({ database, remote, generatedAt: new Date().toISOString(), columns: reports, unresolved, errors }, null, 2)}\n`,
)
writeFileSync(
  join(outDir, "normalise.sql"),
  [
    `-- Proposed by scripts/status-values-report.mjs against ${remote ? "remote" : "local"} ${database}.`,
    "-- Exact case, whitespace or known-spelling variants only. Review before applying; this script never applies it.",
    ...sql,
    "",
  ].join("\n"),
)
writeFileSync(join(outDir, "review.json"), `${JSON.stringify(review, null, 2)}\n`)

const variantCount = reports.reduce((sum, report) => sum + report.variants.length, 0)
console.log(`Columns checked: ${reports.length} of ${columns.length} listed columns (${errors.length} could not be read).`)
console.log(`Exact variants with a proposed UPDATE: ${variantCount} -> ${join(outDir, "normalise.sql")}`)
console.log(`Unknown values for review: ${review.length} -> ${join(outDir, "review.json")}`)
if (unresolved.length > 0) console.log(`Lists not found for: ${unresolved.join(", ")}`)
for (const entry of review) console.log(`  review ${entry.table}.${entry.column}: ${JSON.stringify(entry.value)} (not in ${entry.listName})`)
