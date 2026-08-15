import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { projectMembers } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { assertProjectAccess } from "@/lib/project-access"
import {
  canUseActiveProjectAudience,
  type ProjectAudience,
} from "@/lib/project-audience-access"
import { requirePermission } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"

export async function requireProjectAudienceFileAccess(input: {
  readonly projectId: string
  readonly audience: ProjectAudience
}): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly user: Awaited<ReturnType<typeof requireAuth>>
  readonly viewerIsInternal: boolean
}> {
  const user = await requireAuth()
  requirePermission(user, "project", "read")

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const project = await assertProjectAccess(db, user, input.projectId)
  if (!project.organizationId) throw new Error("Project organization is missing")

  const viewerIsInternal = isInternalStaffRole(user.role)
  if (!viewerIsInternal) {
    const membership = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, input.projectId),
          eq(projectMembers.userId, user.id)
        )
      )
      .get()
    if (
      !canUseActiveProjectAudience(
        membership?.role ?? null,
        input.audience,
        user.isActive
      )
    ) {
      throw new Error("Project not found")
    }
  }

  return { db, organizationId: project.organizationId, user, viewerIsInternal }
}
