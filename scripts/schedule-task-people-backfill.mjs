#!/usr/bin/env bun
// Gives every schedule item that has a single assigned_to, and no people
// rows yet, its one schedule_task_people row (migration 0284), so the people
// list covers today's single assignee. Readers already fall back to
// assigned_to, so nothing breaks while this has not run.
//
// Dry run by default: only SELECTs run, and a JSON report is written.
//
//   bun scripts/schedule-task-people-backfill.mjs                    # local D1, dry run
//   bun scripts/schedule-task-people-backfill.mjs --remote           # production D1, dry run (read only)
//   bun scripts/schedule-task-people-backfill.mjs --remote --apply   # write (needs approval)
//   bun scripts/schedule-task-people-backfill.mjs --persist-to <dir> # a local D1 kept in another folder
//   bun scripts/schedule-task-people-backfill.mjs --database compass-demo-db --out output/x
//
// --apply only INSERTs, each guarded by NOT EXISTS, so a re-run is a no-op.
// It never updates or deletes.
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { insertStatements, planScheduleTaskPeopleBackfill, sqlLiteral } from "./lib/schedule-task-people-backfill.mjs"

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

const remote = process.argv.includes("--remote")
const apply = process.argv.includes("--apply")
const database = argValue("--database") ?? "compass-db"
const persistTo = argValue("--persist-to")
const outDir = resolve(argValue("--out") ?? "output/schedule-task-people-backfill")
const PAGE_SIZE = 500

if (remote && persistTo) throw new Error("--persist-to only applies to a local database")

function wrangler(extra, { json }) {
  const target = remote ? ["--remote"] : ["--local", ...(persistTo ? ["--persist-to", persistTo] : [])]
  const output = execFileSync(
    "bunx",
    ["wrangler", "d1", "execute", database, ...target, ...(json ? ["--json"] : []), ...extra],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] },
  )
  return json ? JSON.parse(output) : output
}

/** One read-only SELECT. */
function select(sql) {
  if (!/^\s*select\b/i.test(sql) || /;\s*\S/.test(sql)) throw new Error("reads must be single SELECT statements")
  return wrangler(["--command", sql], { json: true }).flatMap((result) => result.results ?? [])
}

/** Items with a name and no people rows, in id order, PAGE_SIZE at a time. */
function itemsMissingPeople() {
  const rows = []
  let after = null
  for (;;) {
    const page = select(
      "SELECT t.id, t.assigned_to, t.assigned_user_id FROM schedule_tasks t " +
        "WHERE t.assigned_to IS NOT NULL AND trim(t.assigned_to) <> '' " +
        "AND NOT EXISTS (SELECT 1 FROM schedule_task_people p WHERE p.schedule_task_id = t.id)" +
        (after === null ? "" : ` AND t.id > ${sqlLiteral(after)}`) +
        ` ORDER BY t.id LIMIT ${PAGE_SIZE}`,
    )
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
    after = page[page.length - 1].id
  }
}

const stamp = new Date().toISOString().replaceAll(":", "-")
mkdirSync(outDir, { recursive: true })
const target = remote ? `remote ${database}` : `local ${database}${persistTo ? ` (${persistTo})` : ""}`

const missing = itemsMissingPeople()
const plan = planScheduleTaskPeopleBackfill(missing, { now: new Date().toISOString(), newId: randomUUID })
const report = {
  target,
  mode: apply ? "apply" : "dry-run",
  generatedAt: new Date().toISOString(),
  itemsMissingPeople: missing.length,
  toInsert: plan.rows.length,
  skipped: plan.skipped,
  taskIdsToInsert: plan.rows.map((row) => row.schedule_task_id),
}

if (apply && plan.rows.length > 0) {
  const sqlPath = join(outDir, `schedule-task-people-apply-${stamp}.sql`)
  writeFileSync(sqlPath, `${insertStatements(plan.rows).join("\n")}\n`)
  // --file prints progress text, not JSON.
  wrangler(["--file", sqlPath, "--yes"], { json: false })
  report.sqlFile = sqlPath
  report.remainingAfterApply = itemsMissingPeople().length
}

const reportPath = join(outDir, `schedule-task-people-report-${stamp}.json`)
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(
  JSON.stringify(
    { target, mode: report.mode, itemsMissingPeople: missing.length, toInsert: plan.rows.length, remainingAfterApply: report.remainingAfterApply ?? null },
    null,
    2,
  ),
)
console.log(`Report written: ${reportPath}`)
