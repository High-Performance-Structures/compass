import "server-only"
import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { companiesView, membershipsView } from "@/lib/domain/identity/views"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { assertProjectAccess } from "@/lib/domain/project/access"
import { requirePermission, type Action } from "@/lib/permissions"
import { requireProjectRouteId } from "@/lib/project-route-id"
import { isInternalStaffRole, isStaffOrganizationType } from "@/lib/user-roles"

const memberships = membershipsView()
const companies = companiesView()

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
  const membership = await db.select({ role: memberships.role, active: companies.isActive, type: companies.type, name: companies.name }).from(memberships)
    .innerJoin(companies, eq(companies.id, memberships.organizationId))
    .where(and(eq(memberships.userId, actor.id), eq(memberships.organizationId, project.organizationId))).get()
  if (!membership?.active || !isStaffOrganizationType(membership.type) || !isInternalStaffRole(membership.role)) throw new Error("Internal document access is required.")
  const user: AuthUser = { ...actor, role: membership.role, organizationId: project.organizationId, organizationType: membership.type, organizationName: membership.name }
  requirePermission(user, "document", action)
  return { db, env, user, projectId, organizationId: project.organizationId }
}
