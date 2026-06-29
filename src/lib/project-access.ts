import { and, eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { projectMembers, projects } from "@/db/schema"
import type { AuthUser } from "@/lib/auth"

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
    user.organizationId === projectOrganizationId
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
