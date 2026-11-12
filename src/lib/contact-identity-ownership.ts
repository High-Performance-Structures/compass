import { and, eq, isNull, or } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  projectContacts,
  projects,
} from "@/db/schema"
import { invitationsView, peopleView } from "@/lib/domain/identity/views"

const invitations = invitationsView()
const accounts = peopleView()

export type ContactIdentityFields = {
  readonly email: string | null
  readonly phone: string | null
  readonly address: string | null
}

type DirectoryEntityType = "customer" | "customer_contact" | "vendor" | "vendor_contact"

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

// Accepted Compass users: staff edit everything except the sign-in email.
export { contactEmailChanged, SIGN_IN_EMAIL_LOCK } from "@/lib/contact-sign-in-email"

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
    input.entityType === "customer_contact"
      ? eq(projectContacts.customerContactId, input.entityId)
      : input.entityType === "vendor_contact"
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
    .select({ userId: accounts.id })
    .from(projectContacts)
    .innerJoin(projects, eq(projects.id, projectContacts.projectId))
    .innerJoin(
      invitations,
      and(
        eq(invitations.projectId, projectContacts.projectId),
        eq(invitations.projectContactId, projectContacts.id),
        eq(invitations.status, "accepted")
      )
    )
    .innerJoin(accounts, eq(accounts.id, invitations.acceptedBy))
    .where(
      and(
        eq(projects.organizationId, input.organizationId),
        directoryMatch,
        eq(accounts.isActive, true)
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
      customerContactId: projectContacts.customerContactId,
      vendorContactId: projectContacts.vendorContactId,
    })
    .from(projectContacts)
    .innerJoin(projects, eq(projects.id, projectContacts.projectId))
    .innerJoin(
      invitations,
      and(
        eq(invitations.projectId, projectContacts.projectId),
        eq(invitations.projectContactId, projectContacts.id),
        eq(invitations.status, "accepted")
      )
    )
    .innerJoin(accounts, eq(accounts.id, invitations.acceptedBy))
    .where(
      and(
        eq(projects.organizationId, input.organizationId),
        eq(accounts.isActive, true),
        or(
          eq(projectContacts.sourceEntityType, "customer"),
          eq(projectContacts.sourceEntityType, "customer_contact"),
          eq(projectContacts.sourceEntityType, "vendor"),
          eq(projectContacts.sourceEntityType, "vendor_contact")
        )
      )
    )

  const identityRows: DirectoryIdentityRow[] = rows.flatMap((row) => {
    const directoryRows: DirectoryIdentityRow[] = [row]
    if (row.customerContactId) {
      directoryRows.push({
        entityType: "customer_contact",
        entityId: row.customerContactId,
      })
    }
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
