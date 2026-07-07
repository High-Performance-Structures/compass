#!/usr/bin/env node
import fs from "node:fs"

const DEFAULT_SNAPSHOT_PATH =
  ".codex-snapshots/buildertrend-project-access-2026-07-06.json"
const DEFAULT_OUTPUT_PATH =
  ".codex-snapshots/buildertrend-client-access-import.sql"

const SNAPSHOT_PATH =
  process.env.BUILDERTREND_PROJECT_ACCESS_JSON || DEFAULT_SNAPSHOT_PATH
const OUTPUT_PATH =
  process.env.BUILDERTREND_CLIENT_ACCESS_SQL || DEFAULT_OUTPUT_PATH
const ORGANIZATION_ID = process.env.COMPASS_ORG_ID || "org-1"

function text(value) {
  return value == null ? "" : String(value).trim()
}

function slug(value) {
  return text(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
}

function sqlString(value) {
  if (value == null || value === "") return "NULL"
  return `'${String(value).replace(/'/g, "''")}'`
}

function contactIdFromHref(href) {
  const match = text(href).match(/\/Contact\/([^/]+)\//)
  return match?.[1] ?? ""
}

function clientRowsFromProject(project) {
  const links = Array.isArray(project.tabs?.clients?.contactLinks)
    ? project.tabs.clients.contactLinks
    : []

  return links
    .map((link) => {
      const buildertrendContactId = contactIdFromHref(link.href)
      return {
        projectId: text(project.projectId),
        projectTitle: text(project.title),
        buildertrendJobId: text(project.buildertrendJobId),
        buildertrendContactId,
        name: text(link.name),
        email: text(link.email).toLowerCase(),
        phone: text(link.phone),
        accessStatus: text(link.status),
        sourceHref: text(link.href),
      }
    })
    .filter(
      (row) =>
        row.projectId &&
        row.buildertrendContactId &&
        row.name &&
        row.email &&
        row.accessStatus !== "inactive"
    )
}

function customerInsertSql(client, now, capturedAt) {
  const customerId = `customer-buildertrend-${client.buildertrendContactId}`
  const metadata = JSON.stringify({
    buildertrend: {
      jobId: client.buildertrendJobId,
      contactId: client.buildertrendContactId,
      projectTitle: client.projectTitle,
      accessStatus: client.accessStatus,
      href: client.sourceHref,
      capturedAt,
    },
  })

  return `
INSERT INTO customers (
  id, name, company, email, phone, address, notes, netsuite_id,
  source_system, source_record_id, source_record_number, source_metadata,
  directory_status, sync_status, last_synced_at, organization_id,
  created_at, updated_at
)
VALUES (
  ${sqlString(customerId)}, ${sqlString(client.name)}, NULL,
  ${sqlString(client.email)}, ${sqlString(client.phone)}, NULL,
  'Imported from Buildertrend project client access.', NULL,
  'buildertrend_project_access', ${sqlString(client.buildertrendContactId)},
  ${sqlString(client.buildertrendContactId)}, ${sqlString(metadata)},
  'active', 'buildertrend_project_access', ${sqlString(now)},
  ${sqlString(ORGANIZATION_ID)}, ${sqlString(now)}, ${sqlString(now)}
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  email = COALESCE(excluded.email, customers.email),
  phone = COALESCE(excluded.phone, customers.phone),
  notes = excluded.notes,
  source_system = excluded.source_system,
  source_record_id = excluded.source_record_id,
  source_record_number = excluded.source_record_number,
  source_metadata = excluded.source_metadata,
  directory_status = excluded.directory_status,
  sync_status = excluded.sync_status,
  last_synced_at = excluded.last_synced_at,
  organization_id = excluded.organization_id,
  updated_at = excluded.updated_at;`
}

function projectContactInsertSql(client, index, now) {
  const customerId = `customer-buildertrend-${client.buildertrendContactId}`
  const projectContactId = `project-contact-${slug(client.projectId)}-owner-bt-${client.buildertrendContactId}`

  return `
INSERT INTO project_contacts (
  id, project_id, contact_type, source_system, source_record_id,
  source_entity_type, source_entity_id, display_name, company_name,
  role, trade, csi_division, csi_division_name, primary_cost_code,
  email, phone, notes, owner_portal_visible, sub_vendor_portal_visible,
  internal_visible, primary_contact, active, sort_order, sync_status,
  last_synced_at, created_at, updated_at
)
VALUES (
  ${sqlString(projectContactId)}, ${sqlString(client.projectId)}, 'owner',
  'buildertrend_project_access', ${sqlString(client.buildertrendContactId)},
  'customer', ${sqlString(customerId)}, ${sqlString(client.name)}, NULL,
  'Owner / Client', NULL, NULL, NULL, NULL,
  ${sqlString(client.email)}, ${sqlString(client.phone)},
  'Owner access imported from Buildertrend project Clients tab.',
  1, 0, 1, ${index === 0 ? 1 : 0}, 1, ${10 + index},
  'buildertrend_project_access', ${sqlString(now)}, ${sqlString(now)},
  ${sqlString(now)}
)
ON CONFLICT(id) DO UPDATE SET
  display_name = excluded.display_name,
  email = COALESCE(excluded.email, project_contacts.email),
  phone = COALESCE(excluded.phone, project_contacts.phone),
  notes = excluded.notes,
  owner_portal_visible = excluded.owner_portal_visible,
  internal_visible = excluded.internal_visible,
  primary_contact = excluded.primary_contact,
  active = excluded.active,
  sync_status = excluded.sync_status,
  last_synced_at = excluded.last_synced_at,
  updated_at = excluded.updated_at;`
}

const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"))
const clients = snapshot.projects.flatMap(clientRowsFromProject)
const now = new Date().toISOString()
const clientsByProject = new Map()

for (const client of clients) {
  const projectClients = clientsByProject.get(client.projectId) ?? []
  projectClients.push(client)
  clientsByProject.set(client.projectId, projectClients)
}

const lines = [
  "-- Buildertrend client project access import for Compass D1.",
  `-- Source snapshot: ${SNAPSHOT_PATH}`,
  `-- Captured at: ${snapshot.capturedAt ?? "unknown"}`,
  `-- Generated at: ${now}`,
]

for (const projectId of clientsByProject.keys()) {
  lines.push(`
UPDATE project_contacts
SET active = 0,
    notes = CASE
      WHEN notes IS NULL OR notes = '' THEN 'Superseded by Buildertrend client access import.'
      ELSE notes
    END,
    updated_at = ${sqlString(now)}
WHERE project_id = ${sqlString(projectId)}
  AND contact_type = 'owner'
  AND source_system != 'buildertrend_project_access';`)
}

for (const projectClients of clientsByProject.values()) {
  for (const [index, client] of projectClients.entries()) {
    lines.push(customerInsertSql(client, now, text(snapshot.capturedAt)))
    lines.push(projectContactInsertSql(client, index, now))
  }
}

fs.writeFileSync(OUTPUT_PATH, `${lines.join("\n")}\n`)
console.log(
  JSON.stringify(
    {
      source: SNAPSHOT_PATH,
      output: OUTPUT_PATH,
      organizationId: ORGANIZATION_ID,
      clientCount: clients.length,
      projectCount: clientsByProject.size,
    },
    null,
    2
  )
)
