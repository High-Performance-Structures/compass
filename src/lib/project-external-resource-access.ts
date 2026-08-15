import { and, eq, inArray, isNull } from "drizzle-orm"

import { getDb } from "@/db"
import {
  projectExternalResourceGrants,
  projectMembers,
  users,
} from "@/db/schema"

export const EXTERNAL_PROJECT_RESOURCE_TYPES = [
  "audience_file",
  "photo",
  "video",
] as const

export type ExternalProjectResourceType =
  (typeof EXTERNAL_PROJECT_RESOURCE_TYPES)[number]

export const EXTERNAL_PROJECT_RECIPIENT_ROLES = [
  "client",
  "owner",
  "subcontractor",
  "supplier",
] as const

export function isExternalProjectResourceType(
  value: string
): value is ExternalProjectResourceType {
  return EXTERNAL_PROJECT_RESOURCE_TYPES.includes(
    value as ExternalProjectResourceType
  )
}

export function isExternalProjectRecipientRole(value: string | null): boolean {
  return EXTERNAL_PROJECT_RECIPIENT_ROLES.includes(
    value as (typeof EXTERNAL_PROJECT_RECIPIENT_ROLES)[number]
  )
}

export async function hasActiveExternalProjectResourceGrant(input: {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly projectId: string
  readonly recipientUserId: string
  readonly resourceId: string
  readonly resourceType: ExternalProjectResourceType
}): Promise<boolean> {
  const grant = await input.db
    .select({ id: projectExternalResourceGrants.id })
    .from(projectExternalResourceGrants)
    .innerJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, projectExternalResourceGrants.projectId),
        eq(projectMembers.userId, projectExternalResourceGrants.recipientUserId)
      )
    )
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(
      and(
        eq(projectExternalResourceGrants.organizationId, input.organizationId),
        eq(projectExternalResourceGrants.projectId, input.projectId),
        eq(projectExternalResourceGrants.resourceType, input.resourceType),
        eq(projectExternalResourceGrants.resourceId, input.resourceId),
        eq(projectExternalResourceGrants.recipientUserId, input.recipientUserId),
        isNull(projectExternalResourceGrants.revokedAt),
        inArray(projectMembers.role, EXTERNAL_PROJECT_RECIPIENT_ROLES),
        eq(users.isActive, true)
      )
    )
    .limit(1)

  return grant.length === 1
}
