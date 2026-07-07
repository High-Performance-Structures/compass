import fs from "node:fs/promises"
import path from "node:path"

const DEFAULT_INPUT =
  ".codex-snapshots/buildertrend-visible-leads-2026-07-06.json"
const DEFAULT_OUTPUT =
  ".codex-snapshots/buildertrend-visible-leads-staging-import.sql"

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

function departmentCodeFromTitle(title) {
  const match = text(title).match(/^([OHND])-/)
  return match ? match[1] : null
}

function projectNumberFromTitle(title) {
  const match = text(title).match(/^([OHND]-\d+(?:-\d+){0,2})\b/)
  return match ? match[1] : null
}

function buildertrendContactIdFromHref(href) {
  const match = text(href).match(/Contact\/(\d+)/)
  return match ? match[1] : null
}

function hasCombinedName(name) {
  const normalized = text(name).toLowerCase()
  return (
    normalized.includes(" & ") ||
    normalized.includes(" and ") ||
    normalized.includes("+")
  )
}

function normalizeLeadRow(row) {
  const leadId = text(row.buildertrendLeadId)
  const title = text(row.title)
  const contacts = Array.isArray(row.contacts) ? row.contacts : []
  const projectNumber = projectNumberFromTitle(title)
  return {
    leadId,
    title,
    projectNumber,
    departmentCode: departmentCodeFromTitle(title),
    href: text(row.href) || `/app/leads/opportunities/Lead/${leadId}`,
    sourceUrl: `https://buildertrend.net${text(row.href) || `/app/leads/opportunities/Lead/${leadId}`}`,
    buildertrendMailto: text(row.buildertrendMailto),
    rowText: text(row.rowText),
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

function projectSubquery(lead) {
  if (!lead.projectNumber) return "NULL"
  return `(SELECT id FROM projects WHERE project_number = ${sqlString(lead.projectNumber)} LIMIT 1)`
}

function organizationSubquery(lead) {
  if (!lead.projectNumber) return "'org-1'"
  return `COALESCE((SELECT organization_id FROM projects WHERE project_number = ${sqlString(lead.projectNumber)} LIMIT 1), 'org-1')`
}

function sourceRecordSql({ importRunId, lead, now }) {
  const recordId = `bt-source-lead-${lead.leadId}`
  const rawPayload = JSON.stringify(lead)
  return `INSERT INTO buildertrend_source_records (
  id, import_run_id, organization_id, project_id, source_scope,
  source_record_type, buildertrend_lead_id, buildertrend_url, title,
  record_status, source_status, department_code, client_name,
  contact_name, searchable_text, normalized_summary, raw_payload_json,
  review_status, promotion_status, sage_reconciliation_status, notes,
  created_at, updated_at
) VALUES (
  ${sqlString(recordId)}, ${sqlString(importRunId)}, ${organizationSubquery(lead)},
  ${projectSubquery(lead)}, 'lead', 'lead_opportunity',
  ${sqlString(lead.leadId)}, ${sqlString(lead.sourceUrl)}, ${sqlString(lead.title)},
  'open', NULL, ${sqlString(lead.departmentCode)}, ${sqlString(lead.clientName)},
  ${sqlString(lead.clientName)}, ${sqlString(lead.rowText)},
  ${sqlString(`Buildertrend lead opportunity for ${lead.title}.`)},
  ${sqlString(rawPayload)}, 'needs_review', 'archive_only', 'not_reviewed',
  'Buildertrend lead opportunity captured for compliance and preconstruction review.',
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
  contact_name = excluded.contact_name,
  searchable_text = excluded.searchable_text,
  normalized_summary = excluded.normalized_summary,
  raw_payload_json = excluded.raw_payload_json,
  updated_at = excluded.updated_at;`
}

function accessCandidateSql({ importRunId, lead, contact, now }) {
  const contactId = contact.buildertrendContactId || slug(contact.name)
  const candidateId = `bt-access-lead-${lead.leadId}-${contactId}`
  const sourceRecordId = `bt-source-lead-${lead.leadId}`
  const notes = hasCombinedName(contact.name)
    ? "Buildertrend lead contact appears combined. Review before creating portal users; prefer individual contacts when available."
    : "Buildertrend lead contact. Portal access is not granted by import."
  return `INSERT INTO buildertrend_access_candidates (
  id, import_run_id, source_record_id, organization_id, project_id,
  buildertrend_lead_id, buildertrend_contact_id, buildertrend_access_role,
  contact_name, proposed_contact_type, match_status, match_confidence,
  portal_access_status, review_status, notes, created_at, updated_at
) VALUES (
  ${sqlString(candidateId)}, ${sqlString(importRunId)}, ${sqlString(sourceRecordId)},
  ${organizationSubquery(lead)}, ${projectSubquery(lead)}, ${sqlString(lead.leadId)},
  ${sqlString(contact.buildertrendContactId)}, 'lead_contact', ${sqlString(contact.name)},
  'customer', 'unmatched', 0, 'not_granted', 'needs_review',
  ${sqlString(notes)}, ${sqlString(now)}, ${sqlString(now)}
)
ON CONFLICT(id) DO UPDATE SET
  import_run_id = excluded.import_run_id,
  source_record_id = excluded.source_record_id,
  organization_id = excluded.organization_id,
  project_id = excluded.project_id,
  buildertrend_lead_id = excluded.buildertrend_lead_id,
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
  const leads = rows
    .map(normalizeLeadRow)
    .filter((lead) => lead.leadId && lead.title)
  const now = new Date().toISOString()
  const importRunId = `bt-import-${slug(path.basename(input, path.extname(input)))}`
  const statements = [
    "-- Buildertrend lead opportunity staging import.",
    "-- This imports archive/staging records only; it does not grant portal access.",
    `INSERT INTO buildertrend_import_runs (
  id, source_method, source_label, status, started_at, completed_at,
  notes, summary_json, created_at, updated_at
) VALUES (
  ${sqlString(importRunId)}, 'browser_lead_opportunity_snapshot',
  ${sqlString(path.basename(input))}, 'completed', ${sqlString(now)},
  ${sqlString(now)},
  'Visible Buildertrend Lead Opportunities imported into staging.',
  ${sqlString(JSON.stringify({ leads: leads.length, source: input }))},
  ${sqlString(now)}, ${sqlString(now)}
)
ON CONFLICT(id) DO UPDATE SET
  status = excluded.status,
  completed_at = excluded.completed_at,
  notes = excluded.notes,
  summary_json = excluded.summary_json,
  updated_at = excluded.updated_at;`,
    ...leads.map((lead) => sourceRecordSql({ importRunId, lead, now })),
    ...leads.flatMap((lead) =>
      lead.contacts.map((contact) =>
        accessCandidateSql({ importRunId, lead, contact, now })
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
        leads: leads.length,
        accessCandidates: leads.reduce(
          (total, lead) => total + lead.contacts.length,
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

