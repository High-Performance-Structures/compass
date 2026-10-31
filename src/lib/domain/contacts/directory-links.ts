/**
 * Read side of the relational directory links added in migration 0280
 * (projects.client_customer_id, project_operations.vendor_id,
 * project_budget_lines.vendor_id, project_rfis.assigned_project_contact_id).
 *
 * Writers call `resolveVendorLink` to turn a picker choice into a vendor id
 * that is checked to belong to the company; readers use the name lookups to
 * prefer the linked directory record over the stored text. A link whose
 * record was merged away or deleted reads the stored text instead, so nothing
 * visible disappears.
 */
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm"

import { customers, projectContacts, projects, vendors } from "@/db/schema"
import { chunkD1Values } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

import type { DirectoryVendorPick } from "./rules"
import { resolvedProjectContacts } from "./store"

type ProjectScope = { readonly organizationId: string; readonly projectId: string }

/**
 * The project's client name: the linked directory client's name when that
 * client is live in the project's company, otherwise the stored text.
 */
export const linkedProjectClientName: SQL<string | null> = sql<string | null>`coalesce((
  select nullif(trim(${customers.name}), '') from ${customers}
  where ${customers.id} = ${projects.clientCustomerId}
    and ${customers.organizationId} = ${projects.organizationId}
    and ${customers.mergedIntoCustomerId} is null
), ${projects.clientName})`

async function liveVendorId(db: Db, organizationId: string, vendorId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, organizationId), isNull(vendors.mergedIntoVendorId)))
    .limit(1)
  return row?.id ?? null
}

/**
 * The directory vendor a picker choice names, or null when it names none or
 * the vendor is not a live vendor of this company. Never throws for a bad
 * pick: the record then simply stays unlinked, as typed text always was.
 */
export async function resolveVendorLink(
  db: Db,
  scope: ProjectScope,
  pick: DirectoryVendorPick | null | undefined
): Promise<string | null> {
  if (pick?.vendorId) return liveVendorId(db, scope.organizationId, pick.vendorId)
  if (!pick?.projectContactId) return null
  const [contact] = await db
    .select({
      vendorId: projectContacts.vendorId,
      sourceEntityType: projectContacts.sourceEntityType,
      sourceEntityId: projectContacts.sourceEntityId,
    })
    .from(projectContacts)
    .where(and(eq(projectContacts.id, pick.projectContactId), eq(projectContacts.projectId, scope.projectId)))
    .limit(1)
  const vendorId = contact?.vendorId ?? (contact?.sourceEntityType === "vendor" ? contact.sourceEntityId : null)
  return vendorId ? liveVendorId(db, scope.organizationId, vendorId) : null
}

/** Live vendor names by id, for reads that prefer the linked vendor. */
export async function linkedVendorNames(
  db: Db,
  organizationId: string,
  vendorIds: readonly (string | null)[]
): Promise<ReadonlyMap<string, string>> {
  const ids = [...new Set(vendorIds.filter((id): id is string => id !== null))]
  const chunks = await Promise.all(
    chunkD1Values(ids).map((chunk) =>
      db
        .select({ id: vendors.id, name: vendors.name })
        .from(vendors)
        .where(and(inArray(vendors.id, chunk), eq(vendors.organizationId, organizationId), isNull(vendors.mergedIntoVendorId)))
    )
  )
  return new Map(chunks.flat().map((row) => [row.id, row.name]))
}

/**
 * Resolved display names of project contacts by id (the contact's directory
 * record when it has one), for reads that prefer the linked contact.
 */
export async function linkedProjectContactNames(
  db: Db,
  projectId: string,
  contactIds: readonly (string | null)[]
): Promise<ReadonlyMap<string, string>> {
  const ids = [...new Set(contactIds.filter((id): id is string => id !== null))]
  if (ids.length === 0) return new Map()
  // The directory is the project's company's, whoever is reading.
  const [project] = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  if (!project?.organizationId) return new Map()
  const scope = { organizationId: project.organizationId, projectId }
  const chunks = await Promise.all(
    chunkD1Values(ids).map((chunk) =>
      resolvedProjectContacts(db, { ...scope, where: inArray(projectContacts.id, chunk), order: "name" })
    )
  )
  return new Map(chunks.flat().map((row) => [row.id, row.displayName]))
}

/** A project contact on this project, or null; RFI assignments link only to these. */
export async function projectContactOnProject(db: Db, projectId: string, contactId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: projectContacts.id })
    .from(projectContacts)
    .where(and(eq(projectContacts.id, contactId), eq(projectContacts.projectId, projectId)))
    .limit(1)
  return row?.id ?? null
}
