/**
 * Who may read and change field records. These rules are stricter than the
 * shared action context: owner updates are internal-staff only to change and
 * reach owners only through project membership, and daily logs are written
 * by active internal staff. The order of the checks, and so the message a
 * refused caller sees, matches what each action has always returned.
 */
import { and, eq, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import { organizations, projectMembers, projects } from "@/db/schema"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { canUseProjectDailyLogWorkspace } from "@/lib/daily-logs/workspace-access"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import {
  assertOwnerUpdateReadAccess,
  assertOwnerUpdateRouteAccess,
} from "@/lib/owner-updates/access"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { requireProjectAudienceReadUser } from "@/lib/project-audience-request-server"
import type { Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

type FieldAccess = {
  readonly db: Db
  readonly viewer: AuthUser
}

type FieldMutationAccess = {
  readonly db: Db
  readonly user: AuthUser
}

/** Internal staff whose company is the project's (the owner's view is separate). */
export function isInternalFieldViewer(viewer: AuthUser): boolean {
  return viewer.organizationType === "internal" && isInternalStaffRole(viewer.role)
}

async function assertProjectInOrganization(
  db: Db,
  projectId: string,
  organizationId: string
): Promise<void> {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1)
  if (!project) throw new Error("Project not found")
}

/** The daily log workspace: active internal staff on their company's project. */
export async function verifyProjectDailyLogWorkspaceAccess(projectId: string): Promise<FieldAccess> {
  const viewer = await requireAuth()
  if (!canUseProjectDailyLogWorkspace(viewer)) {
    throw new Error("Project not found")
  }
  const db = await assertOwnerUpdateRouteAccess(viewer)
  await requireFeaturePermission(viewer, "daily-logs", "read")
  const organizationId = requireOrg(viewer)
  await assertProjectInOrganization(db, projectId, organizationId)
  return { db, viewer }
}

/**
 * Owner update pages: internal staff on their company's project, or an
 * owner/client member of the project in an active organization.
 */
export async function verifyOwnerUpdateReadAccess(projectId: string): Promise<FieldAccess> {
  const viewer = await requireProjectAudienceReadUser(projectId)
  const db = await assertOwnerUpdateReadAccess(viewer)
  await requireFeaturePermission(viewer, "owner-updates", "read")

  if (isInternalFieldViewer(viewer) && viewer.organizationId) {
    const project = await db
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(
        organizations,
        and(
          eq(organizations.id, projects.organizationId),
          eq(organizations.id, viewer.organizationId),
          eq(organizations.type, "internal"),
          eq(organizations.isActive, true)
        )
      )
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, viewer.organizationId)
        )
      )
      .limit(1)
      .get()
    if (!project) throw new Error("Project not found")
  } else {
    const project = await db
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, projects.id),
          eq(projectMembers.userId, viewer.id),
          inArray(projectMembers.role, ["client", "owner"])
        )
      )
      .innerJoin(
        organizations,
        and(
          eq(organizations.id, projects.organizationId),
          eq(organizations.id, viewer.organizationId ?? ""),
          eq(organizations.type, viewer.organizationType ?? ""),
          eq(organizations.isActive, true)
        )
      )
      .where(eq(projects.id, projectId))
      .limit(1)
      .get()
    if (!project) throw new Error("Project not found")
  }
  return { db, viewer }
}

/** Daily log review: a non-demo user with the feature permission, on their company's project. */
export async function verifyProjectMutationAccess(projectId: string): Promise<FieldMutationAccess> {
  const user = await requireAuth()
  if (isDemoUser(user.id)) {
    throw new Error("DEMO_READ_ONLY")
  }
  await requireFeaturePermission(user, "daily-logs", "update")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  await assertProjectInOrganization(db, projectId, orgId)
  return { db, user }
}

/** Owner update changes: internal staff with the owner-updates permission. */
export async function verifyOwnerUpdateMutationAccess(projectId: string): Promise<FieldMutationAccess> {
  const user = await requireAuth()
  const db = await assertOwnerUpdateRouteAccess(user)

  await requireFeaturePermission(user, "owner-updates", "update")
  const orgId = requireOrg(user)
  await assertProjectInOrganization(db, projectId, orgId)
  return { db, user }
}

/** Writing daily logs: active internal staff with the daily-logs permission. */
export async function verifyDailyLogStaffMutationAccess(
  projectId: string
): Promise<FieldMutationAccess & { readonly orgId: string }> {
  const user = await requireAuth()
  if (isDemoUser(user.id)) {
    throw new Error("DEMO_READ_ONLY")
  }
  if (!user.isActive || !isInternalStaffRole(user.role)) {
    throw new Error("Permission denied: staff access is required for daily logs")
  }
  await requireFeaturePermission(user, "daily-logs", "update")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  await assertProjectInOrganization(db, projectId, orgId)
  return { db, orgId, user }
}
