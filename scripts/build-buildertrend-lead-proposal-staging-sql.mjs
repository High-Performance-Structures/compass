import fs from "node:fs/promises"
import path from "node:path"

const DEFAULT_INPUT =
  ".codex-snapshots/buildertrend-visible-lead-proposals-2026-07-06.json"
const DEFAULT_OUTPUT =
  ".codex-snapshots/buildertrend-visible-lead-proposals-staging-import.sql"

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

function moneyFromRow(rowText) {
  const match = text(rowText).match(/\$([\d,]+(?:\.\d{2})?)/)
  if (!match) return null
  return Number(match[1].replaceAll(",", ""))
}

function proposalStatusFromRow(rowText) {
  const value = text(rowText)
  if (value.includes("Not sent")) return "not_sent"
  if (value.includes("Approved")) return "approved"
  if (value.includes("Expired")) return "expired"
  if (value.includes("Sent")) return "sent"
  return null
}

function paymentStatusFromRow(rowText) {
  const value = text(rowText)
  if (value.includes("Paid")) return "paid"
  if (value.includes("Pending")) return "pending"
  return null
}

function normalizeProposalRow(row) {
  const proposalId = text(row.buildertrendProposalId)
  const leadId = text(row.buildertrendLeadId)
  const title = text(row.title)
  const leadTitle =
    Array.isArray(row.leadLinks) && row.leadLinks[0]
      ? text(row.leadLinks[0].text)
      : null
  const contact =
    Array.isArray(row.contacts) && row.contacts[0] ? row.contacts[0] : null
  const rowText = text(row.rowText)
  const projectNumber = projectNumberFromTitle(leadTitle || title)
  return {
    proposalId,
    leadId,
    title,
    leadTitle,
    projectNumber,
    departmentCode: departmentCodeFromTitle(leadTitle || title),
    href:
      text(row.href) ||
      `/app/leads/proposals/Lead/${leadId}/LeadProposal/${proposalId}/${leadId}/false`,
    sourceUrl: `https://buildertrend.net${
      text(row.href) ||
      `/app/leads/proposals/Lead/${leadId}/LeadProposal/${proposalId}/${leadId}/false`
    }`,
    contactName: contact ? text(contact.text) : null,
    rowText,
    amount: moneyFromRow(rowText),
    proposalStatus: proposalStatusFromRow(rowText),
    paymentStatus: paymentStatusFromRow(rowText),
  }
}

function projectSubquery(proposal) {
  if (!proposal.projectNumber) return "NULL"
  return `(SELECT id FROM projects WHERE project_number = ${sqlString(proposal.projectNumber)} LIMIT 1)`
}

function organizationSubquery(proposal) {
  if (!proposal.projectNumber) return "'org-1'"
  return `COALESCE((SELECT organization_id FROM projects WHERE project_number = ${sqlString(proposal.projectNumber)} LIMIT 1), 'org-1')`
}

function sourceRecordSql({ importRunId, proposal, now }) {
  const recordId = `bt-source-lead-proposal-${proposal.proposalId}`
  const rawPayload = JSON.stringify(proposal)
  const statusDetails = {
    proposalStatus: proposal.proposalStatus,
    paymentStatus: proposal.paymentStatus,
  }
  return `INSERT INTO buildertrend_source_records (
  id, import_run_id, organization_id, project_id, source_scope,
  source_record_type, buildertrend_lead_id, buildertrend_record_id,
  buildertrend_record_number, buildertrend_url, title, record_status,
  source_status, department_code, client_name, contact_name, amount,
  searchable_text, normalized_summary, raw_payload_json, review_status,
  promotion_status, sage_reconciliation_status, notes, created_at, updated_at
) VALUES (
  ${sqlString(recordId)}, ${sqlString(importRunId)}, ${organizationSubquery(proposal)},
  ${projectSubquery(proposal)}, 'lead', 'lead_proposal',
  ${sqlString(proposal.leadId)}, ${sqlString(proposal.proposalId)},
  ${sqlString(proposal.proposalId)}, ${sqlString(proposal.sourceUrl)},
  ${sqlString(proposal.title)}, ${sqlString(proposal.proposalStatus)},
  ${sqlString(JSON.stringify(statusDetails))}, ${sqlString(proposal.departmentCode)},
  ${sqlString(proposal.leadTitle)}, ${sqlString(proposal.contactName)},
  ${proposal.amount === null ? "NULL" : String(proposal.amount)},
  ${sqlString(proposal.rowText)},
  ${sqlString(`Buildertrend lead proposal ${proposal.title}.`)},
  ${sqlString(rawPayload)}, 'needs_review', 'archive_only', 'not_reviewed',
  'Buildertrend lead proposal captured for estimate/payment history review.',
  ${sqlString(now)}, ${sqlString(now)}
)
ON CONFLICT(id) DO UPDATE SET
  import_run_id = excluded.import_run_id,
  organization_id = excluded.organization_id,
  project_id = excluded.project_id,
  buildertrend_url = excluded.buildertrend_url,
  title = excluded.title,
  record_status = excluded.record_status,
  source_status = excluded.source_status,
  department_code = excluded.department_code,
  client_name = excluded.client_name,
  contact_name = excluded.contact_name,
  amount = excluded.amount,
  searchable_text = excluded.searchable_text,
  normalized_summary = excluded.normalized_summary,
  raw_payload_json = excluded.raw_payload_json,
  updated_at = excluded.updated_at;`
}

async function main() {
  const input = process.argv[2] || DEFAULT_INPUT
  const output = process.argv[3] || DEFAULT_OUTPUT
  const raw = await fs.readFile(input, "utf8")
  const snapshot = JSON.parse(raw)
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : []
  const proposals = rows
    .map(normalizeProposalRow)
    .filter((proposal) => proposal.proposalId && proposal.leadId)
  const now = new Date().toISOString()
  const importRunId = `bt-import-${slug(path.basename(input, path.extname(input)))}`
  const statements = [
    "-- Buildertrend lead proposal staging import.",
    "-- This imports archive/staging records only; it does not make Buildertrend financials authoritative.",
    `INSERT INTO buildertrend_import_runs (
  id, source_method, source_label, status, started_at, completed_at,
  notes, summary_json, created_at, updated_at
) VALUES (
  ${sqlString(importRunId)}, 'browser_lead_proposal_snapshot',
  ${sqlString(path.basename(input))}, 'completed', ${sqlString(now)},
  ${sqlString(now)},
  'Visible Buildertrend Lead Proposals imported into staging.',
  ${sqlString(JSON.stringify({ proposals: proposals.length, source: input }))},
  ${sqlString(now)}, ${sqlString(now)}
)
ON CONFLICT(id) DO UPDATE SET
  status = excluded.status,
  completed_at = excluded.completed_at,
  notes = excluded.notes,
  summary_json = excluded.summary_json,
  updated_at = excluded.updated_at;`,
    ...proposals.map((proposal) =>
      sourceRecordSql({ importRunId, proposal, now })
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
        proposals: proposals.length,
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

