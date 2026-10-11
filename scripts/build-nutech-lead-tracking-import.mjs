#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises"
import XLSX from "xlsx"

import { planNutechImport } from "./lib/nutech-lead-tracking-import.mjs"

/**
 * Builds reviewable SQL for the one-time Nu-Tech import from the legacy
 * Project Lead Tracking workbook. Nothing is written to a database; apply the
 * SQL with `wrangler d1 execute --file` after reviewing the report.
 *
 * --existing is the JSON output of:
 *   SELECT p.id, p.project_number, p.job_status_id, p.address, p.client_name,
 *     p.project_manager, EXISTS (SELECT 1 FROM project_profile_audit_events e
 *       WHERE e.project_id = p.id AND e.event_type = 'project_job_status_updated')
 *       AS status_changed_in_compass, p.created_at
 *   FROM projects p WHERE p.department = 'N'
 */

function optionValue(args, option) {
  const index = args.indexOf(option)
  if (index < 0) return null
  const value = args[index + 1]
  return value && !value.startsWith("--") ? value : null
}

const args = process.argv.slice(2)
const workbookPath = optionValue(args, "--workbook")
const existingPath = optionValue(args, "--existing")
const sqlPath = optionValue(args, "--sql")
const reportPath = optionValue(args, "--report")
const organizationId = optionValue(args, "--organization")
const actorUserId = optionValue(args, "--actor")
const asOf = optionValue(args, "--as-of") ?? new Date().toISOString().slice(0, 10)
const staffPath = optionValue(args, "--staff")

if (!workbookPath || !existingPath || !sqlPath || !reportPath || !organizationId || !actorUserId) {
  throw new Error(
    "Usage: bun scripts/build-nutech-lead-tracking-import.mjs --workbook <xlsx> --existing <json> " +
      "--organization <id> --actor <user id> --sql <out.sql> --report <out.json> [--staff <json>] [--as-of YYYY-MM-DD]",
  )
}

const workbook = XLSX.read(await readFile(workbookPath))
const sheet = (name) => {
  const found = workbook.Sheets[name]
  if (!found) throw new Error(`The workbook has no "${name}" sheet.`)
  return XLSX.utils.sheet_to_json(found, { header: 1, defval: "", raw: false })
}

const masterRows = sheet("Master List").slice(3)
const activity = [
  ...sheet("Active Estimate Tracker").slice(1).map((row) => ({ text: row[2], date: row[0] })),
  ...sheet("PO Master List-Order Tracking").slice(2).map((row) => ({ text: row[3], date: row[1] })),
]

const existingJson = JSON.parse(await readFile(existingPath, "utf8"))
const existingRows = Array.isArray(existingJson) ? existingJson[0]?.results ?? [] : existingJson
const existing = existingRows.map((row) => ({
  id: row.id,
  projectNumber: row.project_number,
  jobStatusId: row.job_status_id,
  address: row.address,
  clientName: row.client_name,
  projectManager: row.project_manager,
  statusChangedInCompass: Boolean(row.status_changed_in_compass),
  // Projects from the Compass new-project form have "proj-n-" ids; bulk
  // imports' creation dates say nothing about lead activity.
  intakeDate: String(row.id).startsWith("proj-n-") ? String(row.created_at).slice(0, 10) : null,
}))
const staffNames = staffPath ? JSON.parse(await readFile(staffPath, "utf8")) : {}

const plan = planNutechImport({ masterRows, activity, existing, staffNames, asOf })

const sql = (value) =>
  value === null || value === undefined ? "NULL" : `'${String(value).replaceAll("'", "''")}'`
const now = new Date().toISOString()
const COLUMNS = {
  jobStatusId: "job_status_id",
  status: "status",
  address: "address",
  clientName: "client_name",
  projectManager: "project_manager",
}

function auditInsert(projectId, eventType, before, after) {
  return (
    "INSERT INTO project_profile_audit_events " +
    "(id, organization_id, project_id, actor_user_id, event_type, entity_type, entity_id, before_json, after_json, created_at) VALUES (" +
    [crypto.randomUUID(), organizationId, projectId, actorUserId, eventType, "project", projectId,
      before ? JSON.stringify(before) : null, JSON.stringify(after), now].map(sql).join(", ") +
    ");"
  )
}

const statements = ["-- Nu-Tech import from Project Lead Tracking. Review the report before applying."]
for (const project of plan.inserts) {
  statements.push(
    "INSERT INTO projects (id, organization_id, project_number, department, name, status, job_status_id, " +
      "client_status, client_name, project_manager, address, created_at, updated_at) " +
      `SELECT ${[project.id, organizationId, project.projectNumber, "N", project.name, project.status,
        project.jobStatusId, project.clientStatus, project.clientName, project.projectManager,
        project.address, project.createdAt, now].map(sql).join(", ")} ` +
      `WHERE NOT EXISTS (SELECT 1 FROM projects WHERE project_number = ${sql(project.projectNumber)});`,
    auditInsert(project.id, "project_imported_from_lead_tracking", null, project.note),
  )
}
for (const update of plan.updates) {
  const assignments = Object.entries(update.set).map(([field, value]) => `${COLUMNS[field]} = ${sql(value)}`)
  statements.push(
    `UPDATE projects SET ${assignments.join(", ")}, updated_at = ${sql(now)} ` +
      `WHERE id = ${sql(update.id)} AND organization_id = ${sql(organizationId)};`,
    auditInsert(
      update.id,
      "project_updated_from_lead_tracking",
      Object.fromEntries(Object.keys(update.set).map((field) => [field, update.before[field] ?? null])),
      { ...update.set, ...update.note },
    ),
  )
}

await writeFile(sqlPath, `${statements.join("\n")}\n`)
await writeFile(
  reportPath,
  JSON.stringify(
    {
      asOf,
      cutoffDate: plan.cutoffDate,
      counts: {
        newProjects: plan.inserts.length,
        updatedProjects: plan.updates.length,
        ...plan.report,
        keptCompassStatus: plan.report.keptCompassStatus.length,
        unknownStatus: plan.report.unknownStatus.length,
      },
      keptCompassStatus: plan.report.keptCompassStatus,
      unknownStatus: plan.report.unknownStatus,
      statusChanges: plan.updates
        .filter((update) => update.set.jobStatusId)
        .map((update) => `${update.projectNumber}: ${update.before.jobStatusId} → ${update.set.jobStatusId}`),
      newActive: plan.inserts
        .filter((project) => project.status === "OPEN")
        .map((project) => `${project.projectNumber} ${project.name} (${project.jobStatusId})`),
    },
    null,
    2,
  ),
)
console.log(`Planned ${plan.inserts.length} new and ${plan.updates.length} updated Nu-Tech projects. See ${reportPath}.`)
