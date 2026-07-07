import fs from "node:fs/promises"
import path from "node:path"

const DEFAULT_INPUTS = [
  ".codex-snapshots/buildertrend-client-contacts-visible-2026-07-07.json",
  ".codex-snapshots/buildertrend-client-contacts-visible-page-2-2026-07-07.json",
]
const DEFAULT_OUTPUT =
  ".codex-snapshots/buildertrend-client-contacts-staging-import.sql"

function sqlString(value) {
  if (value === null || value === undefined || value === "") return "NULL"
  return `'${String(value).replaceAll("'", "''")}'`
}

function text(value) {
  return String(value || "").trim()
}

function hasCombinedName(name) {
  const normalized = text(name).toLowerCase()
  return (
    normalized.includes(" & ") ||
    normalized.includes(" and ") ||
    normalized.includes("+")
  )
}

function activationStatus(rowText) {
  const normalized = text(rowText)
  if (normalized.includes("Active")) return "active"
  if (normalized.includes("Pending")) return "pending"
  if (normalized.includes("Inactive")) return "inactive"
  return "unknown"
}

function phoneFromRow(rowText) {
  const match = text(rowText).match(
    /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/
  )
  return match ? match[0] : null
}

function normalizeContact(row) {
  const name = text(row.name)
  const contactId = text(row.id)
  const rowText = text(row.rowText)
  return {
    contactId,
    name,
    href: text(row.href) || `/app/Contacts/Contact/${contactId}/false`,
    sourceUrl: `https://buildertrend.net${text(row.href) || `/app/Contacts/Contact/${contactId}/false`}`,
    activationStatus: activationStatus(rowText),
    phone: phoneFromRow(rowText),
    rowText,
  }
}

async function loadContacts(inputs) {
  const contacts = []
  for (const input of inputs) {
    const raw = await fs.readFile(input, "utf8")
    const snapshot = JSON.parse(raw)
    const rows = Array.isArray(snapshot.page?.contactLinks)
      ? snapshot.page.contactLinks
      : []
    for (const row of rows) {
      const contact = normalizeContact(row)
      if (contact.contactId && contact.name) contacts.push(contact)
    }
  }
  const byId = new Map()
  for (const contact of contacts) byId.set(contact.contactId, contact)
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function sourceRecordSql({ importRunId, contact, now }) {
  const recordId = `bt-source-client-contact-${contact.contactId}`
  const rawPayload = JSON.stringify(contact)
  return `INSERT INTO buildertrend_source_records (
  id, import_run_id, organization_id, source_scope, source_record_type,
  buildertrend_record_id, buildertrend_url, title, record_status,
  source_status, client_name, contact_name, searchable_text,
  normalized_summary, raw_payload_json, review_status, promotion_status,
  sage_reconciliation_status, notes, created_at, updated_at
) VALUES (
  ${sqlString(recordId)}, ${sqlString(importRunId)}, 'org-1', 'contact',
  'client_contact', ${sqlString(contact.contactId)}, ${sqlString(contact.sourceUrl)},
  ${sqlString(contact.name)}, ${sqlString(contact.activationStatus)},
  ${sqlString(JSON.stringify({ activationStatus: contact.activationStatus }))},
  ${sqlString(contact.name)}, ${sqlString(contact.name)}, ${sqlString(contact.rowText)},
  ${sqlString(`Buildertrend client contact ${contact.name} (${contact.activationStatus}).`)},
  ${sqlString(rawPayload)}, 'needs_review', 'archive_only', 'not_reviewed',
  'Buildertrend client contact captured for migration review. Import does not grant Compass access.',
  ${sqlString(now)}, ${sqlString(now)}
)
ON CONFLICT(id) DO UPDATE SET
  import_run_id = excluded.import_run_id,
  buildertrend_url = excluded.buildertrend_url,
  title = excluded.title,
  record_status = excluded.record_status,
  source_status = excluded.source_status,
  client_name = excluded.client_name,
  contact_name = excluded.contact_name,
  searchable_text = excluded.searchable_text,
  normalized_summary = excluded.normalized_summary,
  raw_payload_json = excluded.raw_payload_json,
  updated_at = excluded.updated_at;`
}

function accessCandidateSql({ importRunId, contact, now }) {
  const sourceRecordId = `bt-source-client-contact-${contact.contactId}`
  const notes = hasCombinedName(contact.name)
    ? "Buildertrend client contact appears combined. Review before creating portal users; prefer individual contacts when available."
    : "Buildertrend client contact. Portal access is not granted by import."
  return `INSERT INTO buildertrend_access_candidates (
  id, import_run_id, source_record_id, organization_id, buildertrend_contact_id,
  buildertrend_access_role, contact_name, phone, proposed_contact_type,
  match_status, match_confidence, portal_access_status, review_status,
  notes, created_at, updated_at
) VALUES (
  ${sqlString(`bt-access-client-contact-${contact.contactId}`)},
  ${sqlString(importRunId)}, ${sqlString(sourceRecordId)}, 'org-1',
  ${sqlString(contact.contactId)}, 'client_contact', ${sqlString(contact.name)},
  ${sqlString(contact.phone)}, 'customer', 'unmatched', 0, 'not_granted',
  'needs_review', ${sqlString(notes)}, ${sqlString(now)}, ${sqlString(now)}
)
ON CONFLICT(id) DO UPDATE SET
  import_run_id = excluded.import_run_id,
  source_record_id = excluded.source_record_id,
  buildertrend_contact_id = excluded.buildertrend_contact_id,
  contact_name = excluded.contact_name,
  phone = excluded.phone,
  notes = excluded.notes,
  updated_at = excluded.updated_at;`
}

async function main() {
  const args = process.argv.slice(2)
  const output = args.find((arg) => arg.endsWith(".sql")) || DEFAULT_OUTPUT
  const inputs = args.filter((arg) => arg.endsWith(".json"))
  const inputFiles = inputs.length > 0 ? inputs : DEFAULT_INPUTS
  const contacts = await loadContacts(inputFiles)
  const now = new Date().toISOString()
  const importRunId = "bt-import-client-contacts-visible-2026-07-07"
  const statements = [
    "-- Buildertrend client contact staging import.",
    "-- This imports archive/staging records only; it does not grant portal access.",
    `INSERT INTO buildertrend_import_runs (
  id, source_method, source_label, status, started_at, completed_at,
  notes, summary_json, created_at, updated_at
) VALUES (
  ${sqlString(importRunId)}, 'browser_client_contact_snapshot',
  'buildertrend-client-contacts-visible-2026-07-07', 'completed',
  ${sqlString(now)}, ${sqlString(now)},
  'Visible Buildertrend client contacts imported into staging.',
  ${sqlString(JSON.stringify({ contacts: contacts.length, sources: inputFiles }))},
  ${sqlString(now)}, ${sqlString(now)}
)
ON CONFLICT(id) DO UPDATE SET
  status = excluded.status,
  completed_at = excluded.completed_at,
  notes = excluded.notes,
  summary_json = excluded.summary_json,
  updated_at = excluded.updated_at;`,
    ...contacts.map((contact) =>
      sourceRecordSql({ importRunId, contact, now })
    ),
    ...contacts.map((contact) =>
      accessCandidateSql({ importRunId, contact, now })
    ),
    "",
  ]

  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, statements.join("\n"))
  console.log(
    JSON.stringify(
      {
        output,
        contacts: contacts.length,
        accessCandidates: contacts.length,
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
