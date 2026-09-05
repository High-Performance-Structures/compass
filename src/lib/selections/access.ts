import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { projectMembers } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { assertProjectAccess } from "@/lib/project-access"
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
  const user = await requireAuth()
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
    const member = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, user.id)
        )
      )
      .get()
    if (!canUseProjectAudience(member?.role ?? null, audience))
      throw new Error("Project not found")
    if (write && audience !== "owner")
      throw new Error("Only project owners can record selection decisions.")
  }
  return { db, user, staff, actorName: user.displayName ?? user.email }
}
