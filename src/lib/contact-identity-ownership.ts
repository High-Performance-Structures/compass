import { and, eq, inArray, or } from "drizzle-orm"

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

type DirectoryEntityType = "customer" | "vendor"

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

export async function directoryIdentityManagedByActiveUser(input: {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly entityType: DirectoryEntityType
  readonly entityId: string
}): Promise<boolean> {
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
        eq(projectContacts.sourceEntityType, input.entityType),
        eq(projectContacts.sourceEntityId, input.entityId),
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

  const rows = await input.db
    .select({
      entityType: projectContacts.sourceEntityType,
      entityId: projectContacts.sourceEntityId,
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
        inArray(projectContacts.sourceEntityId, entityIds),
        or(
          eq(projectContacts.sourceEntityType, "customer"),
          eq(projectContacts.sourceEntityType, "vendor")
        )
      )
    )

  return new Set(
    rows.flatMap((row) =>
      row.entityId ? [`${row.entityType}:${row.entityId}`] : []
    )
  )
}
