import fs from "node:fs/promises"
import path from "node:path"

const DEFAULT_INPUT =
  ".codex-snapshots/buildertrend-visible-jobs-2026-07-06.json"
const DEFAULT_OUTPUT =
  ".codex-snapshots/buildertrend-visible-jobs-staging-import.sql"

function buildertrendJobIdFromHref(href) {
  const match = text(href).match(/JobPage\/(\d+)/)
  return match ? match[1] : null
}

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
    .slice(0, 80)
}

function departmentCodeFromName(name) {
  const trimmed = text(name)
  const match = trimmed.match(/^([OHND])-/)
  return match ? match[1] : null
}

function projectNumberFromName(name) {
  const trimmed = text(name)
  const match = trimmed.match(/^([OHND]-\d+(?:-\d+){0,2})\b/)
  return match ? match[1] : null
}

function buildertrendContactIdFromHref(href) {
  const match = text(href).match(/Contact\/(\d+)/)
  return match ? match[1] : null
}

function hasCombinedOwnerName(name) {
  const normalized = text(name).toLowerCase()
  return (
    normalized.includes(" & ") ||
    normalized.includes(" and ") ||
    normalized.includes("+")
  )
}

function normalizeJobRow(row) {
  const cells = Array.isArray(row.cells) ? row.cells.map(text) : []
  const href = text(row.href || row.jobHref)
  const jobId = text(row.buildertrendJobId) || buildertrendJobIdFromHref(href)
  const name = text(row.name || row.jobName || cells[2])
  const contacts = Array.isArray(row.contacts)
    ? row.contacts
    : Array.isArray(row.contactLinks)
      ? row.contactLinks
      : []
  const projectNumber = projectNumberFromName(name)
  const rowText = text(row.rowText) || cells.filter(Boolean).join(" | ")
  const sourceStatus = text(row.buildertrendStatus || row.jobStatus)
  const sourceContext = text(row.sourceContext || row.pageSummary)
  return {
    jobId,
    name,
    projectNumber,
    departmentCode: departmentCodeFromName(name),
    projectId: projectIdForJob({ jobId, name, projectNumber }),
    href: href || `/app/JobPage/${jobId}/1`,
    sourceUrl: `https://buildertrend.net${href || `/app/JobPage/${jobId}/1`}`,
    rowText,
    sourceStatus,
    sourceContext,
    address: text(row.address || cells[3]),
    city: text(row.city || cells[4]),
    state: text(row.state || cells[5]),
    zipCode: text(row.zipCode || cells[6]),
    projectManager: text(row.projectManager || cells[7]),
    clientPhone: text(row.clientPhone || cells[9]),
    clientEmail: text(row.clientEmail || cells[10]),
    clientAddress: [cells[11], cells[12], cells[13], cells[14]]
      .filter(Boolean)
      .join(", "),
    scheduleStatus: text(row.scheduleStatus || cells[15]),
    clientName: contacts.map((contact) => text(contact.text)).filter(Boolean).join("; "),
    contacts: contacts
      .map((contact) => ({
        buildertrendContactId: buildertrendContactIdFromHref(contact.href),
        name: text(contact.text),
        href: text(contact.href),
      }))
      .filter((contact) => contact.name),
  }
}

function projectIdForJob({ jobId, name, projectNumber }) {
  if (jobId === "6257323") return "proj-h-office"
  if (projectNumber) {
    const projectSlug = slug(projectNumber)
    const nameSlug = slug(name.replace(projectNumber, "")).split("-")[0] || "project"
    return `proj-bt-${projectSlug}-${nameSlug}`.slice(0, 110)
  }
  return `proj-bt-${slug(name) || jobId}`.slice(0, 110)
}

function projectLookupWhere(job) {
  return [
    `buildertrend_project_id = ${sqlString(job.jobId)}`,
    job.projectNumber ? `project_number = ${sqlString(job.projectNumber)}` : null,
    `name = ${sqlString(job.name)}`,
  ]
    .filter(Boolean)
    .join(" OR ")
}

function projectIdSubquery(job) {
  return `(SELECT id FROM projects WHERE ${projectLookupWhere(job)} LIMIT 1)`
}

function organizationIdSubquery(job) {
  return `(SELECT organization_id FROM projects WHERE ${projectLookupWhere(job)} LIMIT 1)`
}

function projectShellSql({ job, now, insertedStatus }) {
  return `UPDATE projects
SET buildertrend_project_id = ${sqlString(job.jobId)},
    updated_at = ${sqlString(now)}
WHERE buildertrend_project_id IS NULL
  AND (
    ${job.projectNumber ? `project_number = ${sqlString(job.projectNumber)} OR` : ""}
    name = ${sqlString(job.name)}
  );

INSERT INTO projects (
  id, project_number, name, status, client_name, organization_id,
  buildertrend_project_id, owner_updates_enabled, owner_update_channel,
  owner_update_cadence, created_at, updated_at
)
SELECT
  ${sqlString(job.projectId)}, ${sqlString(job.projectNumber)}, ${sqlString(job.name)},
  ${sqlString(insertedStatus)}, ${sqlString(job.clientName || null)}, 'org-1',
  ${sqlString(job.jobId)}, 1, 'compass', 'weekly',
  ${sqlString(now)}, ${sqlString(now)}
WHERE NOT EXISTS (
  SELECT 1 FROM projects
  WHERE buildertrend_project_id = ${sqlString(job.jobId)}
     OR (${job.projectNumber ? `project_number = ${sqlString(job.projectNumber)}` : "0"})
     OR name = ${sqlString(job.name)}
);`
}

function projectExternalLinkSql({ job, now }) {
  const id = `project-external-buildertrend-${job.jobId}`
  return `INSERT INTO project_external_links (
  id, project_id, system, label, external_id, external_number, external_url,
  sync_direction, sync_status, metadata, last_synced_at, created_at, updated_at
) VALUES (
  ${sqlString(id)},
  ${projectIdSubquery(job)},
  'buildertrend', 'Buildertrend Job', ${sqlString(job.jobId)}, ${sqlString(job.jobId)},
  ${sqlString(job.sourceUrl)}, 'read', 'imported',
  ${sqlString(JSON.stringify({ source: "buildertrend_jobs_list", projectNumber: job.projectNumber, sourceContext: job.sourceContext }))},
  ${sqlString(now)}, ${sqlString(now)}, ${sqlString(now)}
)
ON CONFLICT(id) DO UPDATE SET
  project_id = excluded.project_id,
  external_url = excluded.external_url,
  sync_status = excluded.sync_status,
  metadata = excluded.metadata,
  last_synced_at = excluded.last_synced_at,
  updated_at = excluded.updated_at;`
}

function sourceRecordSql({ importRunId, job, now }) {
  const recordId = `bt-source-job-${job.jobId}`
  const rawPayload = JSON.stringify(job)
  return `INSERT INTO buildertrend_source_records (
  id, import_run_id, organization_id, project_id, source_scope,
  source_record_type, buildertrend_job_id, buildertrend_url, title,
  source_status, department_code, client_name, searchable_text,
  normalized_summary, raw_payload_json, review_status, promotion_status,
  sage_reconciliation_status, notes, created_at, updated_at
) VALUES (
  ${sqlString(recordId)}, ${sqlString(importRunId)},
  ${organizationIdSubquery(job)},
  ${projectIdSubquery(job)},
  'job', 'job', ${sqlString(job.jobId)}, ${sqlString(job.sourceUrl)},
  ${sqlString(job.name)}, ${sqlString(job.sourceStatus || job.sourceContext || null)}, ${sqlString(job.departmentCode)},
  ${sqlString(job.clientName)}, ${sqlString(job.rowText)},
  ${sqlString(`Buildertrend job inventory row for ${job.name}.`)},
  ${sqlString(rawPayload)}, 'needs_review', 'archive_only', 'not_reviewed',
  'Imported to Buildertrend staging. Review before promoting to Compass workflows.',
  ${sqlString(now)}, ${sqlString(now)}
)
ON CONFLICT(id) DO UPDATE SET
  import_run_id = excluded.import_run_id,
  organization_id = excluded.organization_id,
  project_id = excluded.project_id,
  buildertrend_url = excluded.buildertrend_url,
  title = excluded.title,
  department_code = excluded.department_code,
  client_name = excluded.client_name,
  searchable_text = excluded.searchable_text,
  normalized_summary = excluded.normalized_summary,
  raw_payload_json = excluded.raw_payload_json,
  updated_at = excluded.updated_at;`
}

function accessCandidateSql({ importRunId, job, contact, now }) {
  const contactId = contact.buildertrendContactId || slug(contact.name)
  const candidateId = `bt-access-job-${job.jobId}-${contactId}`
  const sourceRecordId = `bt-source-job-${job.jobId}`
  const needsOwnerSplit = hasCombinedOwnerName(contact.name)
  const notes = needsOwnerSplit
    ? "Buildertrend client name appears combined. Review before creating portal users; prefer individual owner contacts when available."
    : "Buildertrend job-list client contact. Portal access is not granted by import."
  return `INSERT INTO buildertrend_access_candidates (
  id, import_run_id, source_record_id, organization_id, project_id,
  buildertrend_job_id, buildertrend_contact_id, buildertrend_access_role,
  contact_name, proposed_contact_type, match_status, match_confidence,
  portal_access_status, review_status, notes, created_at, updated_at
) VALUES (
  ${sqlString(candidateId)}, ${sqlString(importRunId)}, ${sqlString(sourceRecordId)},
  ${organizationIdSubquery(job)},
  ${projectIdSubquery(job)},
  ${sqlString(job.jobId)}, ${sqlString(contact.buildertrendContactId)}, 'client',
  ${sqlString(contact.name)}, 'customer', 'unmatched', 0,
  'not_granted', 'needs_review', ${sqlString(notes)},
  ${sqlString(now)}, ${sqlString(now)}
)
ON CONFLICT(id) DO UPDATE SET
  import_run_id = excluded.import_run_id,
  source_record_id = excluded.source_record_id,
  organization_id = excluded.organization_id,
  project_id = excluded.project_id,
  buildertrend_job_id = excluded.buildertrend_job_id,
  buildertrend_contact_id = excluded.buildertrend_contact_id,
  contact_name = excluded.contact_name,
  notes = excluded.notes,
  updated_at = excluded.updated_at;`
}

async function main() {
  const input = process.argv[2] || DEFAULT_INPUT
  const output = process.argv[3] || DEFAULT_OUTPUT
  const raw = await fs.readFile(input, "utf8")
  const snapshot = JSON.parse(raw)
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : []
  const jobs = rows.map(normalizeJobRow).filter((job) => job.jobId && job.name)
  const isAllStatusArchive = text(snapshot.summary)
    .toLowerCase()
    .includes("all buildertrend job statuses")
  const insertedStatus = isAllStatusArchive ? "OTHER" : "OPEN"
  const now = new Date().toISOString()
  const importRunId = `bt-import-${slug(path.basename(input, path.extname(input)))}`
  const statements = [
    "-- Buildertrend job inventory staging import.",
    "-- Generated from a Buildertrend inventory snapshot.",
    "-- This imports archive/staging records only; it does not grant portal access.",
    `INSERT INTO buildertrend_import_runs (
  id, source_method, source_label, status, started_at, completed_at,
  notes, summary_json, created_at, updated_at
) VALUES (
  ${sqlString(importRunId)}, 'browser_inventory_snapshot',
  ${sqlString(path.basename(input))}, 'completed', ${sqlString(now)},
  ${sqlString(now)},
  'Visible Buildertrend Jobs List inventory imported into staging.',
  ${sqlString(JSON.stringify({ jobs: jobs.length, source: input, insertedStatus }))},
  ${sqlString(now)}, ${sqlString(now)}
)
ON CONFLICT(id) DO UPDATE SET
  status = excluded.status,
  completed_at = excluded.completed_at,
  notes = excluded.notes,
  summary_json = excluded.summary_json,
  updated_at = excluded.updated_at;`,
    ...jobs.map((job) => projectShellSql({ job, now, insertedStatus })),
    ...jobs.map((job) => projectExternalLinkSql({ job, now })),
    ...jobs.map((job) => sourceRecordSql({ importRunId, job, now })),
    ...jobs.flatMap((job) =>
      job.contacts.map((contact) =>
        accessCandidateSql({ importRunId, job, contact, now })
      )
    ),
    "",
  ]

  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, statements.join("\n"))
  console.log(
    JSON.stringify(
      {
        input,
        output,
        jobs: jobs.length,
        insertedStatus,
        accessCandidates: jobs.reduce(
          (total, job) => total + job.contacts.length,
          0
        ),
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
