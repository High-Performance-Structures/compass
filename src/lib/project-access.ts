import { and, eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { organizations, projectMembers, projects } from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
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

export async function getProjectAccessRecord(
  db: Db,
  user: AuthUser,
  projectId: string
): Promise<ProjectAccessRecord | null> {
  if (!user.isActive || !user.organizationId) return null
  const organization = await db
    .select({ id: organizations.id })
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

  if (isInternalStaffRole(user.role)) {
    const project = await db
      .select({
        id: projects.id,
        organizationId: projects.organizationId,
        projectNumber: projects.projectNumber,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
      .get()
    if (!project) return null
    if (
      project.organizationId &&
      usesOrganizationProjectScope(user, project.organizationId)
    ) {
      return project
    }

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

    if (!project.organizationId) return null
    const targetOrganization = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(
        and(
          eq(organizations.id, project.organizationId),
          eq(organizations.isActive, true)
        )
      )
      .limit(1)
      .get()
    return targetOrganization ? project : null
  }

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
  return project
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
