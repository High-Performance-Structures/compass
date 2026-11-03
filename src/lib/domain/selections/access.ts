/**
 * Who may read or change finish selections. Two rules, kept as they were:
 *
 * - `staffSelectionContext`: the staff selections workspace (create, edit,
 *   status, delete, finish-schedule import, picker options). The project must
 *   belong to the user's active organization and the user needs the
 *   `finish-selections` feature permission. Built on the shared action context
 *   ("organization" scope).
 * - `selectionAccess`: the owner/staff decision workflow (publish, approve,
 *   requests, procurement links). Project members and invited audiences reach
 *   it through `assertProjectAccess` plus the audience rules, so it does not
 *   fit either shared scope and keeps its own checks.
 */
import { getDb } from "@/db"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { assertProjectAccess } from "@/lib/project-access"
import { canUseProjectAudience, type ProjectAudience } from "@/lib/project-audience-access"
import {
  assertAudiencePreviewWriteAllowed,
  requireProjectAudienceReadUser,
} from "@/lib/project-audience-request-server"
import { projectMemberRole } from "@/lib/project-member-role"
import { projectContext, type ProjectContext } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

/**
 * Staff selections access. Failures throw with the shared context messages
 * ("Unauthorized", "No active organization", "Permission denied: ...",
 * "Project not found"), which the actions surface as their error text.
 * `mutation` is left off so the demo read-only rule is not added here.
 */
export async function staffSelectionContext(
  projectId: string,
  permission: "read" | "update"
): Promise<ProjectContext & { readonly organizationId: string }> {
  const context = await projectContext(projectId, {
    scope: "organization",
    feature: "finish-selections",
    action: permission,
  })
  if (!context.success) throw new Error(context.error)
  const { organizationId } = context.data
  // "organization" scope always resolves an organization; this narrows the type.
  if (!organizationId) throw new Error("No active organization")
  return { ...context.data, organizationId }
}

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
