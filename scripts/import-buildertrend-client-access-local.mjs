#!/usr/bin/env node
import Database from "better-sqlite3"
import fs from "node:fs"

const DB_PATH = process.env.LOCAL_DB_PATH || "local.db"
const DEFAULT_SNAPSHOT_PATH =
  ".codex-snapshots/buildertrend-project-access-2026-07-06.json"
const SNAPSHOT_PATH =
  process.env.BUILDERTREND_PROJECT_ACCESS_JSON || DEFAULT_SNAPSHOT_PATH

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

function ensureCustomerSourceColumns(db) {
  const existing = new Set(
    db.prepare("PRAGMA table_info(customers)").all().map((column) => column.name)
  )
  const columns = [
    ["source_system", "text DEFAULT 'manual' NOT NULL"],
    ["source_record_id", "text"],
    ["source_record_number", "text"],
    ["source_metadata", "text"],
    ["directory_status", "text DEFAULT 'active' NOT NULL"],
    ["sync_status", "text DEFAULT 'manual' NOT NULL"],
    ["last_synced_at", "text"],
  ]

  for (const [name, definition] of columns) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE customers ADD COLUMN ${name} ${definition}`)
    }
  }
}

function loadSnapshot() {
  const parsed = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"))
  if (!Array.isArray(parsed.projects)) {
    throw new Error(`Buildertrend access snapshot has no projects array: ${SNAPSHOT_PATH}`)
  }
  return parsed
}

function contactIdFromHref(href) {
  const match = text(href).match(/\/Contact\/([^/]+)\//)
  return match?.[1] ?? ""
}

function emailFromText(value) {
  const match = text(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return match?.[0].toLowerCase() ?? ""
}

function phoneFromText(value) {
  const match = text(value).match(/\+?1?\s?\d{3}\s?\d{3}\s?\d{4}/)
  return match?.[0].replace(/\s+/g, " ").trim() ?? ""
}

function clientNameFromText(value) {
  const raw = text(value)
  const email = emailFromText(raw)
  const phone = phoneFromText(raw)
  return raw
    .replace(email, "")
    .replace(phone, "")
    .replace("(---) --- - ----", "")
    .replace("Send invite", "")
    .replace(/^[A-Z0-9]{1,2}\s*/, "")
    .replace(/^(Active|Inactive)/, "")
    .replace(/\s+/g, " ")
    .trim()
}

function statusFromText(value) {
  const raw = text(value)
  if (raw.includes("Inactive")) return "inactive"
  if (raw.includes("Active")) return "active"
  return "unknown"
}

function clientRowsFromProject(project) {
  const links = Array.isArray(project.tabs?.clients?.contactLinks)
    ? project.tabs.clients.contactLinks
    : []

  return links
    .map((link) => {
      const buildertrendContactId = contactIdFromHref(link.href)
      const name = text(link.name) || clientNameFromText(link.text)
      return {
        projectId: text(project.projectId),
        projectTitle: text(project.title),
        buildertrendJobId: text(project.buildertrendJobId),
        buildertrendContactId,
        name,
        email: text(link.email).toLowerCase() || emailFromText(link.text),
        phone: text(link.phone) || phoneFromText(link.text),
        accessStatus: text(link.status) || statusFromText(link.text),
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

function loadOrganizationId(db) {
  const row = db.prepare("SELECT id FROM organizations ORDER BY created_at LIMIT 1").get()
  if (!row) throw new Error("No organization exists in local.db")
  return row.id
}

function upsertClients(db, organizationId, clients, capturedAt) {
  const now = new Date().toISOString()
  const upsertCustomer = db.prepare(`
    INSERT INTO customers (
      id, name, company, email, phone, address, notes, netsuite_id,
      source_system, source_record_id, source_record_number, source_metadata,
      directory_status, sync_status, last_synced_at, organization_id,
      created_at, updated_at
    )
    VALUES (
      @id, @name, NULL, @email, @phone, NULL, @notes, NULL,
      'buildertrend_project_access', @sourceRecordId, @sourceRecordNumber,
      @sourceMetadata, @directoryStatus, 'buildertrend_project_access',
      @lastSyncedAt, @organizationId, @createdAt, @updatedAt
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
      updated_at = excluded.updated_at
  `)
  const deactivateLegacyOwners = db.prepare(`
    UPDATE project_contacts
    SET active = 0,
        notes = CASE
          WHEN notes IS NULL OR notes = '' THEN 'Superseded by Buildertrend client access import.'
          ELSE notes
        END,
        updated_at = @updatedAt
    WHERE project_id = @projectId
      AND contact_type = 'owner'
      AND source_system != 'buildertrend_project_access'
  `)
  const upsertProjectContact = db.prepare(`
    INSERT INTO project_contacts (
      id, project_id, contact_type, source_system, source_record_id,
      source_entity_type, source_entity_id, display_name, company_name,
      role, trade, csi_division, csi_division_name, primary_cost_code,
      email, phone, notes, owner_portal_visible, sub_vendor_portal_visible,
      internal_visible, primary_contact, active, sort_order, sync_status,
      last_synced_at, created_at, updated_at
    )
    VALUES (
      @id, @projectId, 'owner', 'buildertrend_project_access',
      @sourceRecordId, 'customer', @sourceEntityId, @displayName, NULL,
      'Owner / Client', NULL, NULL, NULL, NULL, @email, @phone, @notes,
      @ownerPortalVisible, 0, 1, @primaryContact, @active, @sortOrder,
      'buildertrend_project_access', @lastSyncedAt, @createdAt, @updatedAt
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
      updated_at = excluded.updated_at
  `)

  const projectsWithClients = new Set(clients.map((client) => client.projectId))
  const projectExists = db.prepare("SELECT id FROM projects WHERE id = ?")
  const skippedProjects = []
  let importedClients = 0

  const tx = db.transaction(() => {
    for (const projectId of projectsWithClients) {
      if (!projectExists.get(projectId)) {
        skippedProjects.push(projectId)
        continue
      }
      deactivateLegacyOwners.run({ projectId, updatedAt: now })
    }

    for (const [index, client] of clients.entries()) {
      if (skippedProjects.includes(client.projectId)) continue

      const customerId = `customer-buildertrend-${client.buildertrendContactId}`
      const projectContactId = `project-contact-${slug(client.projectId)}-owner-bt-${client.buildertrendContactId}`
      const active = client.accessStatus === "inactive" ? 0 : 1
      const metadata = {
        buildertrend: {
          jobId: client.buildertrendJobId,
          contactId: client.buildertrendContactId,
          projectTitle: client.projectTitle,
          accessStatus: client.accessStatus,
          href: client.sourceHref,
          capturedAt,
        },
      }

      upsertCustomer.run({
        id: customerId,
        name: client.name,
        email: client.email || null,
        phone: client.phone || null,
        notes: "Imported from Buildertrend project client access.",
        sourceRecordId: client.buildertrendContactId,
        sourceRecordNumber: client.buildertrendContactId,
        sourceMetadata: JSON.stringify(metadata),
        directoryStatus: active ? "active" : "inactive",
        lastSyncedAt: now,
        organizationId,
        createdAt: now,
        updatedAt: now,
      })

      upsertProjectContact.run({
        id: projectContactId,
        projectId: client.projectId,
        sourceRecordId: client.buildertrendContactId,
        sourceEntityId: customerId,
        displayName: client.name,
        email: client.email || null,
        phone: client.phone || null,
        notes: "Owner access imported from Buildertrend project Clients tab.",
        ownerPortalVisible: active,
        primaryContact: index === 0 ? 1 : 0,
        active,
        sortOrder: 10 + index,
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      importedClients += 1
    }
  })

  tx()

  return {
    importedClients,
    skippedProjects: Array.from(new Set(skippedProjects)),
  }
}

const snapshot = loadSnapshot()
const clients = snapshot.projects.flatMap(clientRowsFromProject)
const db = new Database(DB_PATH)
db.pragma("foreign_keys = ON")
ensureCustomerSourceColumns(db)
const organizationId = loadOrganizationId(db)
const summary = upsertClients(db, organizationId, clients, text(snapshot.capturedAt))

console.log(
  JSON.stringify(
    {
      source: SNAPSHOT_PATH,
      capturedAt: snapshot.capturedAt,
      parsedClients: clients,
      ...summary,
    },
    null,
    2
  )
)
