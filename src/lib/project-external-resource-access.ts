import { and, eq, inArray, isNull } from "drizzle-orm"

import { getDb } from "@/db"
import {
  organizations,
  projectExternalResourceGrants,
  projectMembers,
  projects,
  users,
} from "@/db/schema"
export type ExternalProjectResourceType =
  | "photo"
  | "owner_update_document"

export type ExternalProjectResourceAudience = "owner" | "sub_vendor"

const OWNER_ROLES = ["client", "owner"] as const
const SUB_VENDOR_ROLES = ["subcontractor", "supplier"] as const

export async function hasActiveExternalProjectResourceGrant(input: {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly projectId: string
  readonly recipientUserId: string
  readonly resourceId: string
  readonly resourceType: ExternalProjectResourceType
  readonly audience: ExternalProjectResourceAudience
}): Promise<boolean> {
  const recipientRoles =
    input.audience === "owner" ? OWNER_ROLES : SUB_VENDOR_ROLES
  const rows = await input.db
    .select({ id: projectExternalResourceGrants.id })
    .from(projectExternalResourceGrants)
    .innerJoin(
      projects,
      and(
        eq(projects.id, projectExternalResourceGrants.projectId),
        eq(projects.organizationId, projectExternalResourceGrants.organizationId),
        eq(projects.id, input.projectId)
      )
    )
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, projects.organizationId),
        eq(organizations.id, input.organizationId),
        eq(organizations.type, "client"),
        eq(organizations.isActive, true)
      )
    )
    .innerJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, projects.id),
        eq(projectMembers.userId, input.recipientUserId),
        inArray(projectMembers.role, recipientRoles)
      )
    )
    .innerJoin(users, and(eq(users.id, input.recipientUserId), eq(users.isActive, true)))
    .where(
      and(
        eq(projectExternalResourceGrants.organizationId, input.organizationId),
        eq(projectExternalResourceGrants.projectId, input.projectId),
        eq(projectExternalResourceGrants.resourceType, input.resourceType),
        eq(projectExternalResourceGrants.resourceId, input.resourceId),
        eq(projectExternalResourceGrants.audience, input.audience),
        eq(projectExternalResourceGrants.recipientUserId, input.recipientUserId),
        isNull(projectExternalResourceGrants.revokedAt)
      )
    )
    .limit(1)

  return rows.length === 1
}
