#!/usr/bin/env bun
// Copies project_saved_views and schedule_saved_views into saved_views, and
// project default-view preferences (user_view_preferences
// `project-hub-default:<org>`) into saved_view_defaults (migration 0282).
// Ids are kept, so links and defaults that point at a view stay valid.
//
// Dry run by default: only SELECTs run, and a JSON report is written.
//
//   bun scripts/saved-views-backfill.mjs                    # local D1, dry run
//   bun scripts/saved-views-backfill.mjs --remote           # production D1, dry run (read only)
//   bun scripts/saved-views-backfill.mjs --remote --apply   # write (backup first)
//   bun scripts/saved-views-backfill.mjs --persist-to <dir> # a local D1 kept in another folder
//   bun scripts/saved-views-backfill.mjs --database compass-demo-db --out output/x
//
// With --apply it first writes a backup JSON (the source rows it will copy
// and the current saved_views / saved_view_defaults rows), then runs only
// INSERT ... ON CONFLICT DO NOTHING. It never updates or deletes, so a re-run
// is a no-op. Rows it cannot copy unambiguously (unknown visibility, a name
// collision, an id already holding different values, a missing organization)
// go to the report's review list instead.
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  DEFAULT_COLUMNS,
  insertStatements,
  LEGACY_DEFAULT_KEY_PREFIXES,
  LEGACY_VIEW_TABLES,
  planSavedViewsBackfill,
  sqlLiteral,
  VIEW_COLUMNS,
} from "./lib/saved-views-backfill.mjs"

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

const remote = process.argv.includes("--remote")
const apply = process.argv.includes("--apply")
const database = argValue("--database") ?? "compass-db"
const persistTo = argValue("--persist-to")
const outDir = resolve(argValue("--out") ?? "output/saved-views-backfill")
const PAGE_SIZE = 500

if (remote && persistTo) throw new Error("--persist-to only applies to a local database")

function wrangler(extra) {
  const target = remote ? ["--remote"] : ["--local", ...(persistTo ? ["--persist-to", persistTo] : [])]
  const output = execFileSync("bunx", ["wrangler", "d1", "execute", database, ...target, "--json", ...extra], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  })
  // Remote --file runs print a progress table instead of JSON; only reads need the parsed rows.
  try {
    return JSON.parse(output)
  } catch {
    if (extra.includes("--file")) return []
    throw new Error(`wrangler returned non-JSON output: ${output.slice(0, 200)}`)
  }
}

/** One read-only SELECT. */
function select(sql) {
  if (!/^\s*select\b/i.test(sql) || /;\s*\S/.test(sql)) throw new Error("reads must be single SELECT statements")
  return wrangler(["--command", sql]).flatMap((result) => result.results ?? [])
}

/** Reads a table in id order, PAGE_SIZE rows at a time (keyset pages, no giant IN lists). */
function selectPaged(columns, table, where, keyColumns) {
  const rows = []
  let after = null
  for (;;) {
    const keyset = after === null ? "" : `(${keyColumns.join(", ")}) > (${keyColumns.map((column) => sqlLiteral(after[column])).join(", ")})`
    const conditions = [where, keyset].filter(Boolean)
    const page = select(
      `SELECT ${columns} FROM ${table}${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""} ORDER BY ${keyColumns.join(", ")} LIMIT ${PAGE_SIZE}`,
    )
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
    after = page[page.length - 1]
  }
}

function readState() {
  const legacyViews = Object.entries(LEGACY_VIEW_TABLES).flatMap(([scope, table]) =>
    selectPaged(`'${scope}' AS scope, ${VIEW_COLUMNS.filter((column) => column !== "scope").join(", ")}`, table, "", ["id"]),
  )
  const prefixFilter = Object.values(LEGACY_DEFAULT_KEY_PREFIXES)
    .map((prefix) => `substr(view_key, 1, ${prefix.length}) = ${sqlLiteral(prefix)}`)
    .join(" OR ")
  return {
    legacyViews,
    existingViews: selectPaged(VIEW_COLUMNS.join(", "), "saved_views", "", ["id"]),
    legacyDefaults: selectPaged("user_id, view_key, value, updated_at", "user_view_preferences", `(${prefixFilter})`, ["user_id", "view_key"]),
    existingDefaults: selectPaged(DEFAULT_COLUMNS.join(", "), "saved_view_defaults", "", ["user_id", "organization_id", "scope"]),
    organizationIds: selectPaged("id", "organizations", "", ["id"]).map((row) => row.id),
  }
}

function counts(state) {
  return {
    legacyViews: state.legacyViews.length,
    savedViews: state.existingViews.length,
    legacyDefaults: state.legacyDefaults.length,
    savedViewDefaults: state.existingDefaults.length,
  }
}

const stamp = new Date().toISOString().replaceAll(":", "-")
mkdirSync(outDir, { recursive: true })
const target = remote ? `remote ${database}` : `local ${database}${persistTo ? ` (${persistTo})` : ""}`

const before = readState()
const plan = planSavedViewsBackfill(before)
const report = {
  target,
  mode: apply ? "apply" : "dry-run",
  generatedAt: new Date().toISOString(),
  before: counts(before),
  toInsert: { savedViews: plan.viewInserts.length, savedViewDefaults: plan.defaultInserts.length },
  alreadyCopied: { savedViews: plan.viewsAlreadyCopied.length, savedViewDefaults: plan.defaultsAlreadyPresent.length },
  review: plan.review,
  viewIdsToInsert: plan.viewInserts.map((row) => row.id),
  defaultsToInsert: plan.defaultInserts.map(({ user_id, organization_id, scope }) => ({ user_id, organization_id, scope })),
}

if (apply && (plan.viewInserts.length > 0 || plan.defaultInserts.length > 0)) {
  const backupPath = join(outDir, `saved-views-backup-${stamp}.json`)
  writeFileSync(backupPath, `${JSON.stringify({
    target,
    takenAt: new Date().toISOString(),
    rowsToInsert: { savedViews: plan.viewInserts, savedViewDefaults: plan.defaultInserts },
    currentRows: { savedViews: before.existingViews, savedViewDefaults: before.existingDefaults },
  }, null, 2)}\n`)
  console.log(`Backup written: ${backupPath}`)

  // Views first: a default may later point at one.
  const statements = [
    ...insertStatements("saved_views", VIEW_COLUMNS, plan.viewInserts),
    ...insertStatements("saved_view_defaults", DEFAULT_COLUMNS, plan.defaultInserts),
  ]
  const sqlPath = join(outDir, `saved-views-apply-${stamp}.sql`)
  writeFileSync(sqlPath, `${statements.join("\n")}\n`)
  wrangler(["--file", sqlPath, "--yes"])
  report.appliedStatements = statements.length
  report.sqlFile = sqlPath
  report.backupFile = backupPath
}

if (apply) {
  const after = readState()
  report.after = counts(after)
  const remaining = planSavedViewsBackfill(after)
  report.remainingAfterApply = { savedViews: remaining.viewInserts.length, savedViewDefaults: remaining.defaultInserts.length }
}

const reportPath = join(outDir, `saved-views-report-${stamp}.json`)
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ target, mode: report.mode, before: report.before, toInsert: report.toInsert, alreadyCopied: report.alreadyCopied, review: plan.review.length, after: report.after ?? null }, null, 2))
console.log(`Report written: ${reportPath}`)
