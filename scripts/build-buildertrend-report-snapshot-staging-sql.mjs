import fs from "node:fs/promises"
import path from "node:path"

const DEFAULT_INPUTS = [
  ".codex-snapshots/buildertrend-daily-log-creation-by-job-report-2026-07-07.json",
  ".codex-snapshots/buildertrend-schedule-percent-complete-by-job-report-2026-07-07.json",
  ".codex-snapshots/buildertrend-invoicing-report-2026-07-07.json",
  ".codex-snapshots/buildertrend-work-in-progress-report-2026-07-07.json",
  ".codex-snapshots/buildertrend-budgeted-vs-projected-report-2026-07-07.json",
  ".codex-snapshots/buildertrend-lead-activities-by-salesperson-report-2026-07-07.json",
  ".codex-snapshots/buildertrend-lead-count-by-salesperson-report-2026-07-07.json",
  ".codex-snapshots/buildertrend-lead-status-by-source-report-2026-07-07.json",
]
const DEFAULT_OUTPUT =
  ".codex-snapshots/buildertrend-report-snapshots-staging-import.sql"

function sqlString(value) {
  if (value === null || value === undefined || value === "") return "NULL"
  return `'${String(value).replaceAll("'", "''")}'`
}

function text(value) {
  return String(value || "").trim()
}

function slug(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90)
}

async function loadReport(input) {
  const raw = await fs.readFile(input, "utf8")
  const snapshot = JSON.parse(raw)
  const report = text(snapshot.report || snapshot.page?.title || input)
  const page = snapshot.page || {}
  return {
    input,
    report,
    title: text(page.title || report),
    url: text(page.url || snapshot.sourceUrl),
    text: text(page.text || page.bodyTextPrefix),
    rows: Array.isArray(page.rows) ? page.rows.map(text).filter(Boolean) : [],
    buttons: Array.isArray(page.buttons)
      ? page.buttons.map(text).filter(Boolean)
      : [],
    anchors: Array.isArray(page.anchors) ? page.anchors : [],
    rawPayload: snapshot,
  }
}

function sourceRecordSql({ importRunId, report, now }) {
  const recordId = `bt-source-report-${slug(report.report)}`
  const summary = {
    report: report.report,
    title: report.title,
    rowCount: report.rows.length,
    buttonCount: report.buttons.length,
    source: path.basename(report.input),
  }
  return `INSERT INTO buildertrend_source_records (
  id, import_run_id, organization_id, source_scope, source_record_type,
  buildertrend_url, title, source_status, searchable_text,
  normalized_summary, raw_payload_json, review_status, promotion_status,
  sage_reconciliation_status, notes, created_at, updated_at
) VALUES (
  ${sqlString(recordId)}, ${sqlString(importRunId)}, 'org-1', 'report',
  'report_snapshot', ${sqlString(report.url)}, ${sqlString(report.title)},
  ${sqlString(JSON.stringify(summary))}, ${sqlString(report.text)},
  ${sqlString(`${report.title}: ${report.rows.length} visible rows captured from Buildertrend report.`)},
  ${sqlString(JSON.stringify(report.rawPayload))}, 'needs_review',
  'archive_only', 'not_reviewed',
  'Buildertrend report snapshot captured for compliance and migration planning.',
  ${sqlString(now)}, ${sqlString(now)}
)
ON CONFLICT(id) DO UPDATE SET
  import_run_id = excluded.import_run_id,
  buildertrend_url = excluded.buildertrend_url,
  title = excluded.title,
  source_status = excluded.source_status,
  searchable_text = excluded.searchable_text,
  normalized_summary = excluded.normalized_summary,
  raw_payload_json = excluded.raw_payload_json,
  updated_at = excluded.updated_at;`
}

async function main() {
  const args = process.argv.slice(2)
  const output = args.find((arg) => arg.endsWith(".sql")) || DEFAULT_OUTPUT
  const inputs = args.filter((arg) => arg.endsWith(".json"))
  const inputFiles = inputs.length > 0 ? inputs : DEFAULT_INPUTS
  const reports = []
  for (const input of inputFiles) reports.push(await loadReport(input))
  const now = new Date().toISOString()
  const importRunId = "bt-import-report-snapshots-2026-07-07"
  const statements = [
    "-- Buildertrend report snapshot staging import.",
    "-- Report data is archive evidence and migration planning material.",
    `INSERT INTO buildertrend_import_runs (
  id, source_method, source_label, status, started_at, completed_at,
  notes, summary_json, created_at, updated_at
) VALUES (
  ${sqlString(importRunId)}, 'browser_report_snapshots',
  'buildertrend-report-snapshots-2026-07-07', 'completed',
  ${sqlString(now)}, ${sqlString(now)},
  'Visible Buildertrend reports imported into staging.',
  ${sqlString(
    JSON.stringify({
      reports: reports.length,
      sources: inputFiles.map((input) => path.basename(input)),
    })
  )},
  ${sqlString(now)}, ${sqlString(now)}
)
ON CONFLICT(id) DO UPDATE SET
  status = excluded.status,
  completed_at = excluded.completed_at,
  notes = excluded.notes,
  summary_json = excluded.summary_json,
  updated_at = excluded.updated_at;`,
    ...reports.map((report) =>
      sourceRecordSql({ importRunId, report, now })
    ),
    "",
  ]

  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, statements.join("\n"))
  console.log(
    JSON.stringify(
      {
        output,
        reports: reports.length,
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
