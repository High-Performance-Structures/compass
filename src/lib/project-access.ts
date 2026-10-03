import { and, eq, inArray } from "drizzle-orm"

import type { getDb } from "@/db"
import { organizations, projectMembers, projects } from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import type { ProjectAudience } from "@/lib/project-audience-access"
import {
  canUseOrganizationProjectScopeRole,
  isInternalStaffRole,
} from "@/lib/user-roles"

type Db = ReturnType<typeof getDb>

export type ProjectAccessRecord = {
  readonly id: string
  readonly organizationId: string | null
  readonly projectNumber: string | null
}

export function usesOrganizationProjectScope(
  user: AuthUser,
  projectOrganizationId: string
): boolean {
  return (
    user.organizationType === "internal" &&
    user.organizationId === projectOrganizationId &&
    canUseOrganizationProjectScopeRole(user.role)
  )
}

export type ActiveOrganizationRecord = {
  readonly id: string
  readonly type: string
}

export async function getActiveOrganization(
  db: Db,
  user: AuthUser
): Promise<ActiveOrganizationRecord | null> {
  if (!user.isActive || !user.organizationId) return null
  return (await db
    .select({ id: organizations.id, type: organizations.type })
    .from(organizations)
    .where(
      and(
        eq(organizations.id, user.organizationId),
        eq(organizations.isActive, true)
      )
    )
    .limit(1)
    .get()) ?? null
}

export async function assertActiveInternalOrganization(
  db: Db,
  user: AuthUser
): Promise<void> {
  if (!user.isActive || !user.organizationId) {
    throw new Error("Active internal organization is required")
  }
  const organization = await getActiveOrganization(db, user)
  if (
    !organization ||
    (organization.type !== "internal" && organization.type !== "demo")
  ) {
    throw new Error("Active internal organization is required")
  }
}

export async function assertActiveStaffOrganization(
  db: Db,
  user: AuthUser
): Promise<void> {
  if (!user.isActive || !user.organizationId) {
    throw new Error("Active internal organization is required")
  }
  const organization = await getActiveOrganization(db, user)
  if (!organization || organization.type !== "internal") {
    throw new Error("Active internal organization is required")
  }
}

export async function getProjectAccessRecord(
  db: Db,
  user: AuthUser,
  projectId: string
): Promise<ProjectAccessRecord | null> {
  if (!user.isActive || !user.organizationId) return null
  const organization = await db
    .select({ id: organizations.id, type: organizations.type })
    .from(organizations)
    .where(
      and(
        eq(organizations.id, user.organizationId),
        eq(organizations.isActive, true)
      )
    )
    .limit(1)
    .get()
  if (!organization) return null

  const internalOrganization =
    organization.type === "internal" || organization.type === "demo"
  const internalStaff = isInternalStaffRole(user.role)
  const scopedDeveloper = user.role === "developer"
  if ((internalStaff || scopedDeveloper) && !internalOrganization) return null

  const project = await db
    .select({
      id: projects.id,
      organizationId: projects.organizationId,
      projectNumber: projects.projectNumber,
    })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, user.organizationId)
      )
    )
    .limit(1)
    .get()
  if (!project) return null

  if (internalStaff) return project

  const membership = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, user.id)
      )
    )
    .limit(1)
    .get()
  if (!membership) return null

  return membership ? project : null
}

const PROJECT_AUDIENCE_ROLES: Readonly<Record<ProjectAudience, readonly string[]>> = {
  owner: ["client", "owner"],
  sub_vendor: ["subcontractor", "supplier"],
}

export function projectAudienceRoles(
  audience: ProjectAudience
): readonly string[] {
  return PROJECT_AUDIENCE_ROLES[audience]
}

/**
 * Resolve an external audience grant in the same query that binds the project
 * to the viewer's active organization. Callers must use this result
 * before selecting any audience resource or provider metadata.
 */
export async function getProjectAudienceAccessRecord(
  db: Db,
  user: AuthUser,
  projectId: string,
  audience: ProjectAudience
): Promise<ProjectAccessRecord | null> {
  if (!user.isActive || !user.organizationId) return null
  if (isInternalStaffRole(user.role) || user.role === "developer") return null

  const project = await db
    .select({
      id: projects.id,
      organizationId: projects.organizationId,
      projectNumber: projects.projectNumber,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(organizations, eq(organizations.id, projects.organizationId))
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, user.id),
        inArray(projectMembers.role, projectAudienceRoles(audience)),
        eq(projects.organizationId, user.organizationId),
        eq(organizations.isActive, true),
        eq(organizations.type, "client")
      )
    )
    .limit(1)
    .get()

  return project ?? null
}

export async function assertProjectAccess(
  db: Db,
  user: AuthUser,
  projectId: string
): Promise<ProjectAccessRecord> {
  const project = await getProjectAccessRecord(db, user, projectId)
  if (!project) throw new Error("Project not found")
  return project
}
