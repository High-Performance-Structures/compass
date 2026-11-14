/**
 * Who may reach a project (issue #1329, phase 1). The project module owns
 * project_members; every access decision that reads it lives here or in
 * `member-role.ts`. Actions reach it through `projectContext` in
 * @/lib/server/action-context.
 */
import { and, eq } from "drizzle-orm"

import { projectMembers, projects } from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import { openInvitationForProject } from "@/lib/domain/identity/reads"
import { invitedPreviewInvitationId } from "@/lib/invited-preview"
import type { Db } from "@/lib/server/action-context"
import { canUseOrganizationProjectScopeRole } from "@/lib/user-roles"

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
  // Developer View as stays inside the viewing admin's company.
  if (user.viewAsCompanyId && project.organizationId !== user.viewAsCompanyId) return null
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
    const invitation = await openInvitationForProject(db, invitationId, projectId)
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
