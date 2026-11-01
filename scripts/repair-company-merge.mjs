#!/usr/bin/env bun
// Repairs a company merge that left references on the archived company (for
// example trade docs, POs or bills still pointing at a merged vendor). It
// builds the exact statements the in-app merge uses
// (src/lib/domain/contacts/company-merge.ts, companyMergeRepairStatements):
// each one does nothing unless the source is merged into the destination, so
// a partial or repeated run is safe, and the first records a
// `<kind>_repair` activity event on the kept company with what was left.
//
// Dry run by default: prints read-only preflight queries and the write SQL in
// batches of at most 100 bound values (inlined as literals). It never runs
// anything against the remote database.
//
//   bun scripts/repair-company-merge.mjs --kind vendor_company --org <org-id> --source <archived-id> --destination <kept-id>
//   bun scripts/repair-company-merge.mjs ... --out repair.sql             # also write the batches to a file
//   bun scripts/repair-company-merge.mjs ... --apply-local [--database compass-db]   # run on the LOCAL D1 only
//   bun scripts/repair-company-merge.mjs ... --move-extra vendor_alias_pointers.vendor_id   # also move a drift-table column
//
// The preflight prints the definitions of production tables no migration here creates (vendor_alias_pointers,
// merge_audit). Move a reference column in one with --move-extra once its column is confirmed; leave audit history.
//
// After a vendor repair, the kept vendor's Sage certificate sync is not
// queued by this script; the next trade-doc change (or Settings → Trade docs
// → re-sync) queues it.
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"

import { companyMergeRepairStatements, companyReferenceCountsSql } from "../src/lib/domain/contacts/company-merge.ts"
import { companyMoveGuard } from "../src/lib/domain/contacts/company-merge-references.ts"

export const MAX_BATCH_VALUES = 100
const KINDS = { vendor_company: "vendor", customer_company: "customer" }

/** A D1 stand-in that only records each statement's SQL and bound values. */
function recordingDatabase() {
  return { prepare: (sql) => ({ bind: (...binds) => ({ sql, binds }) }) }
}

function literal(value) {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "number" || typeof value === "bigint") return String(value)
  if (typeof value === "boolean") return value ? "1" : "0"
  return `'${String(value).replaceAll("'", "''")}'`
}

/** Replaces each `?` outside quoted strings with its value as an SQL literal. */
export function inlineStatement(sql, binds) {
  let index = 0
  let quoted = false
  let out = ""
  for (const char of sql) {
    if (char === "'") quoted = !quoted
    if (char === "?" && !quoted) {
      if (index >= binds.length) throw new Error("More placeholders than values")
      out += literal(binds[index++])
    } else out += char
  }
  if (index !== binds.length) throw new Error("More values than placeholders")
  return `${out.replace(/\s+/g, " ").trim()};`
}

/** Splits statements, in order, into batches of at most `MAX_BATCH_VALUES` bound values. */
export function batchStatements(statements) {
  const batches = []
  let current = []
  let values = 0
  for (const statement of statements) {
    if (statement.binds.length > MAX_BATCH_VALUES) throw new Error(`A statement binds ${statement.binds.length} values`)
    if (current.length > 0 && values + statement.binds.length > MAX_BATCH_VALUES) {
      batches.push(current)
      current = []
      values = 0
    }
    current.push(statement)
    values += statement.binds.length
  }
  if (current.length > 0) batches.push(current)
  return batches.map((batch) => ({
    values: batch.reduce((sum, statement) => sum + statement.binds.length, 0),
    sql: batch.map((statement) => inlineStatement(statement.sql, statement.binds)),
  }))
}

/**
 * The preflight reads and the write batches for one archived/kept pair.
 * @param {{ kind: string, organizationId: string, sourceId: string, destinationId: string, now: string, moveExtra?: readonly string[] }} input
 */
export function buildRepairPlan({ kind, organizationId, sourceId, destinationId, now, moveExtra = [] }) {
  const side = KINDS[kind]
  if (!side) throw new Error(`--kind must be one of ${Object.keys(KINDS).join(", ")}`)
  for (const [name, value] of Object.entries({ organizationId, sourceId, destinationId })) {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`Missing ${name}`)
  }
  const table = side === "vendor" ? "vendors" : "customers"
  const mergedInto = side === "vendor" ? "merged_into_vendor_id" : "merged_into_customer_id"
  const counts = companyReferenceCountsSql(side, sourceId)
  const preflight = [
    inlineStatement(`SELECT id, name, ${mergedInto} AS merged_into FROM ${table} WHERE organization_id = ? AND id IN (?, ?)`,
      [organizationId, sourceId, destinationId]),
    inlineStatement(`SELECT ${counts.sql} AS still_on_archived_company`, counts.binds),
    ...(side === "vendor"
      ? [inlineStatement(`SELECT id, vendor_id, doc_type, drive_file_id, superseded_at FROM vendor_trade_documents
          WHERE organization_id = ? AND vendor_id IN (?, ?) ORDER BY vendor_id, doc_type`, [organizationId, sourceId, destinationId])]
      : []),
  ]
  // Production also has tables that no migration in this repository creates (schema drift), which may hold
  // company ids. Print their definitions so the operator can decide; move one only with --move-extra.
  preflight.push(inlineStatement(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN (${DRIFT_TABLES.map(() => "?").join(", ")})`, DRIFT_TABLES))
  const move = { side, mode: "repair", organizationId, sourceId, destinationId, now }
  const extras = moveExtra.map((reference) => extraMoveStatement(move, reference))
  const statements = [...companyMergeRepairStatements(recordingDatabase(), { side, organizationId, sourceId, destinationId, now }), ...extras]
  return { kind, side, preflight, batches: batchStatements(statements) }
}

/** Tables seen in production that no migration here creates; see the preflight output before moving them. */
export const DRIFT_TABLES = ["vendor_alias_pointers", "merge_audit"]
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/

/**
 * A guarded move of one extra `table.column` (a drift table the repository's schema does not know). Only
 * for operator-confirmed reference columns; history/audit tables (such as merge_audit) should stay as they are.
 */
function extraMoveStatement(move, reference) {
  const [table, column, ...rest] = String(reference).split(".")
  if (!table || !column || rest.length > 0 || !IDENTIFIER.test(table) || !IDENTIFIER.test(column)) {
    throw new Error(`--move-extra expects table.column, got ${reference}`)
  }
  const guard = companyMoveGuard(move)
  return { sql: `UPDATE ${table} SET ${column} = ? WHERE ${column} = ? AND ${guard.sql}`, binds: [move.destinationId, move.sourceId, ...guard.binds] }
}

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

function main() {
  if (process.argv.includes("--remote")) {
    console.error("This script never runs against the remote database. Review the printed SQL and apply it deliberately.")
    process.exit(1)
  }
  const plan = buildRepairPlan({
    kind: argValue("--kind"),
    organizationId: argValue("--org"),
    sourceId: argValue("--source"),
    destinationId: argValue("--destination"),
    now: new Date().toISOString(),
    moveExtra: process.argv.flatMap((arg, index) => (arg === "--move-extra" && process.argv[index + 1] ? [process.argv[index + 1]] : [])),
  })
  const lines = [
    `-- Company merge repair (${plan.kind}): ${plan.batches.length} batch(es), at most ${MAX_BATCH_VALUES} bound values each.`,
    "-- Preflight (read only): the archived row must point at the kept row, and the counts show what is left.",
    ...plan.preflight,
    "",
    ...plan.batches.flatMap((batch, index) => [`-- Batch ${index + 1} (${batch.values} values)`, ...batch.sql, ""]),
  ]
  const text = lines.join("\n")
  console.log(text)
  const out = argValue("--out")
  if (out) {
    writeFileSync(out, `${text}\n`)
    console.error(`Wrote ${out}`)
  }
  if (process.argv.includes("--apply-local")) {
    const database = argValue("--database") ?? "compass-db"
    for (const [index, batch] of plan.batches.entries()) {
      execFileSync("bunx", ["wrangler", "d1", "execute", database, "--local", "--command", batch.sql.join("\n")], { stdio: "inherit" })
      console.error(`Applied batch ${index + 1} locally`)
    }
  } else {
    console.error("Dry run: nothing was applied.")
  }
}

if (import.meta.main) main()
