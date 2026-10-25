import "server-only"
import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { organizationMembers, organizations } from "@/db/schema"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { assertProjectAccess } from "@/lib/project-access"
import { requirePermission, type Action } from "@/lib/permissions"
import { requireProjectRouteId } from "@/lib/project-route-id"
import { isInternalStaffRole, isStaffOrganizationType } from "@/lib/user-roles"

export async function requireArchiveStaff(requestedProjectId: string, action: Action = "read"): Promise<{
  readonly db: ReturnType<typeof getDb>; readonly env: CloudflareEnv; readonly user: AuthUser
  readonly projectId: string; readonly organizationId: string
}> {
  const projectId = await requireProjectRouteId(requestedProjectId)
  const actor = await requireAuth()
  if (!actor.isActive) throw new Error("Project not found.")
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const project = await assertProjectAccess(db, actor, projectId)
  if (!project.organizationId) throw new Error("Project not found.")
  const membership = await db.select({ role: organizationMembers.role, active: organizations.isActive, type: organizations.type, name: organizations.name }).from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(organizationMembers.userId, actor.id), eq(organizationMembers.organizationId, project.organizationId))).get()
  if (!membership?.active || !isStaffOrganizationType(membership.type) || !isInternalStaffRole(membership.role)) throw new Error("Internal document access is required.")
  const user: AuthUser = { ...actor, role: membership.role, organizationId: project.organizationId, organizationType: membership.type, organizationName: membership.name }
  requirePermission(user, "document", action)
  return { db, env, user, projectId, organizationId: project.organizationId }
}
