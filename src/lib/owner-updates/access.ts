import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { organizations, projects } from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import type { ProjectAccessRecord } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"

type OwnerUpdateRouteAccessOptions = {
  readonly allowDeveloperRead?: boolean
  readonly allowDemoRead?: boolean
}

export async function assertOwnerUpdateRouteAccess(
  user: AuthUser,
  options: OwnerUpdateRouteAccessOptions = {}
): Promise<ReturnType<typeof getDb>> {
  const isAllowedDemoRead =
    options.allowDemoRead === true && isDemoUser(user.id)
  if (isDemoUser(user.id) && !isAllowedDemoRead) {
    throw new Error("DEMO_READ_ONLY")
  }
  const isAllowedDeveloperRead =
    options.allowDeveloperRead === true && user.role === "developer"
  const isAllowedDemoOrganization =
    isAllowedDemoRead && user.organizationType === "demo"
  if (
    !user.isActive ||
    (!isInternalStaffRole(user.role) &&
      !isAllowedDeveloperRead &&
      !isAllowedDemoOrganization) ||
    (!isAllowedDemoOrganization && user.organizationType !== "internal") ||
    !user.organizationId
  ) {
    throw new Error("Permission denied: internal staff access is required")
  }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const [organization] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      and(
        eq(organizations.id, user.organizationId),
        eq(
          organizations.type,
          isAllowedDemoOrganization ? "demo" : "internal"
        ),
        eq(organizations.isActive, true)
      )
    )
    .limit(1)

  if (!organization) {
    throw new Error("Permission denied: active internal organization is required")
  }

  return db
}

export async function assertOwnerUpdateProjectAccess(
  db: ReturnType<typeof getDb>,
  user: AuthUser,
  projectId: string
): Promise<ProjectAccessRecord> {
  if (!user.organizationId) {
    throw new Error("Project not found")
  }

  const [project] = await db
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

  if (!project) {
    throw new Error("Project not found")
  }

  return project
}
