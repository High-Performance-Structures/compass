import { and, eq, isNull, or } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  projectAccessInvitations,
  projectContacts,
  projects,
  users,
} from "@/db/schema"

export type ContactIdentityFields = {
  readonly email: string | null
  readonly phone: string | null
  readonly address: string | null
}

type DirectoryEntityType = "customer" | "vendor" | "vendor_contact"

type DirectoryIdentityRow = {
  readonly entityType: string
  readonly entityId: string | null
}

function normalizedIdentityValue(
  value: string | null | undefined,
  lowercase: boolean
): string {
  const normalized = value?.trim() ?? ""
  return lowercase ? normalized.toLowerCase() : normalized
}

export function contactIdentityChanged(
  current: ContactIdentityFields,
  next: ContactIdentityFields
): boolean {
  return (
    normalizedIdentityValue(current.email, true) !==
      normalizedIdentityValue(next.email, true) ||
    normalizedIdentityValue(current.phone, false) !==
      normalizedIdentityValue(next.phone, false) ||
    normalizedIdentityValue(current.address, false) !==
      normalizedIdentityValue(next.address, false)
  )
}

export function requestedDirectoryIdentityKeys(input: {
  readonly entityIds: readonly string[]
  readonly rows: readonly DirectoryIdentityRow[]
}): ReadonlySet<string> {
  const requestedIds = new Set(input.entityIds.filter(Boolean))

  return new Set(
    input.rows.flatMap((row) =>
      row.entityId && requestedIds.has(row.entityId)
        ? [`${row.entityType}:${row.entityId}`]
        : []
    )
  )
}

export async function directoryIdentityManagedByActiveUser(input: {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly entityType: DirectoryEntityType
  readonly entityId: string
}): Promise<boolean> {
  const directoryMatch =
    input.entityType === "vendor_contact"
      ? eq(projectContacts.vendorContactId, input.entityId)
      : input.entityType === "vendor"
        ? and(
            eq(projectContacts.sourceEntityType, "vendor"),
            eq(projectContacts.sourceEntityId, input.entityId),
            isNull(projectContacts.vendorContactId)
          )
        : and(
            eq(projectContacts.sourceEntityType, input.entityType),
            eq(projectContacts.sourceEntityId, input.entityId)
          )
  const row = await input.db
    .select({ userId: users.id })
    .from(projectContacts)
    .innerJoin(projects, eq(projects.id, projectContacts.projectId))
    .innerJoin(
      projectAccessInvitations,
      and(
        eq(projectAccessInvitations.projectId, projectContacts.projectId),
        eq(projectAccessInvitations.projectContactId, projectContacts.id),
        eq(projectAccessInvitations.status, "accepted")
      )
    )
    .innerJoin(users, eq(users.id, projectAccessInvitations.acceptedBy))
    .where(
      and(
        eq(projects.organizationId, input.organizationId),
        directoryMatch,
        eq(users.isActive, true)
      )
    )
    .limit(1)
    .get()

  return row !== undefined
}

export async function activeDirectoryIdentityKeys(input: {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly entityIds: readonly string[]
}): Promise<ReadonlySet<string>> {
  const entityIds = Array.from(new Set(input.entityIds.filter(Boolean)))
  if (entityIds.length === 0) return new Set<string>()

  // D1 allows at most 100 bound parameters per query. Organizations can have
  // hundreds of directory records, so query the small set of accepted active
  // identities for the organization and filter it in memory instead of using
  // one bound parameter for every customer and vendor ID.
  const rows = await input.db
    .select({
      entityType: projectContacts.sourceEntityType,
      entityId: projectContacts.sourceEntityId,
      vendorContactId: projectContacts.vendorContactId,
    })
    .from(projectContacts)
    .innerJoin(projects, eq(projects.id, projectContacts.projectId))
    .innerJoin(
      projectAccessInvitations,
      and(
        eq(projectAccessInvitations.projectId, projectContacts.projectId),
        eq(projectAccessInvitations.projectContactId, projectContacts.id),
        eq(projectAccessInvitations.status, "accepted")
      )
    )
    .innerJoin(users, eq(users.id, projectAccessInvitations.acceptedBy))
    .where(
      and(
        eq(projects.organizationId, input.organizationId),
        eq(users.isActive, true),
        or(
          eq(projectContacts.sourceEntityType, "customer"),
          eq(projectContacts.sourceEntityType, "vendor"),
          eq(projectContacts.sourceEntityType, "vendor_contact")
        )
      )
    )

  const identityRows: DirectoryIdentityRow[] = rows.flatMap((row) => {
    const directoryRows: DirectoryIdentityRow[] = [row]
    if (row.vendorContactId) {
      directoryRows.push({
        entityType: "vendor_contact",
        entityId: row.vendorContactId,
      })
    }
    return directoryRows
  })

  return requestedDirectoryIdentityKeys({ entityIds, rows: identityRows })
}
