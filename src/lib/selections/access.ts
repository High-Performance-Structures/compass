import { requireProjectAudienceReadUser, assertAudiencePreviewWriteAllowed } from "@/lib/project-audience-request-server"
import { getDb } from "@/db"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { assertProjectAccess } from "@/lib/project-access"
import { projectMemberRole } from "@/lib/project-member-role"
import {
  canUseProjectAudience,
  type ProjectAudience,
} from "@/lib/project-audience-access"
import { isInternalStaffRole } from "@/lib/user-roles"
import { requireFeaturePermission } from "@/lib/permission-enforcement"

export async function selectionAccess(
  projectId: string,
  audience: "staff" | ProjectAudience,
  write = false
): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly user: Awaited<ReturnType<typeof requireAuth>>
  readonly staff: boolean
  readonly actorName: string
}> {
  if (write) await assertAudiencePreviewWriteAllowed()
  const user = write ? await requireAuth() : await requireProjectAudienceReadUser(projectId)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  await assertProjectAccess(db, user, projectId)
  const staff =
    user.organizationType === "internal" && isInternalStaffRole(user.role)
  if (audience === "staff") {
    if (!staff) throw new Error("Project not found")
    await requireFeaturePermission(
      user,
      "finish-selections",
      write ? "update" : "read"
    )
  } else if (staff) {
    if (write)
      throw new Error("Preview mode cannot record an owner's decision.")
  } else {
    const role = await projectMemberRole(db, user.id, projectId)
    if (!canUseProjectAudience(role, audience))
      throw new Error("Project not found")
    if (write && audience !== "owner")
      throw new Error("Only project owners can record selection decisions.")
  }
  return { db, user, staff, actorName: user.displayName ?? user.email }
}
