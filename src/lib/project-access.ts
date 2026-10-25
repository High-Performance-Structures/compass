import { and, eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { projectAccessInvitations, projectMembers, projects } from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import { invitedPreviewInvitationId } from "@/lib/invited-preview"
import { canUseOrganizationProjectScopeRole } from "@/lib/user-roles"

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

  // Staff previewing someone invited who hasn't accepted: the invitation stands
  // in for the membership they'll get when they accept.
  const invitationId = invitedPreviewInvitationId(user.id)
  if (invitationId) {
    const invitation = await db
      .select({ id: projectAccessInvitations.id })
      .from(projectAccessInvitations)
      .where(
        and(
          eq(projectAccessInvitations.id, invitationId),
          eq(projectAccessInvitations.projectId, projectId),
          eq(projectAccessInvitations.status, "sent")
        )
      )
      .limit(1)
      .get()
    return invitation ? project : null
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

  return membership ? project : null
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
