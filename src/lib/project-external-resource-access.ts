import { and, eq, inArray, isNull } from "drizzle-orm"

import { getDb } from "@/db"
import {
  projectExternalResourceGrants,
  projects,
} from "@/db/schema"
import { companiesView, peopleView } from "@/lib/domain/identity/views"
import { projectMembersView } from "@/lib/domain/project/views"

const companies = companiesView()
const projectMemberships = projectMembersView()
const people = peopleView()

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
      companies,
      and(
        eq(companies.id, projects.organizationId),
        eq(companies.id, input.organizationId),
        eq(companies.type, "client"),
        eq(companies.isActive, true)
      )
    )
    .innerJoin(
      projectMemberships,
      and(
        eq(projectMemberships.projectId, projects.id),
        eq(projectMemberships.userId, input.recipientUserId),
        inArray(projectMemberships.role, recipientRoles)
      )
    )
    .innerJoin(people, and(eq(people.id, input.recipientUserId), eq(people.isActive, true)))
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
