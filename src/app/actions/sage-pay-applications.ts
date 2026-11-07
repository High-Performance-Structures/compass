"use server"

import { desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { projects } from "@/db/schema"
import { sagePayApplicationSyncRuns } from "@/db/schema-sage"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { queueSagePayApplicationRead, sageBridgeConfigured, sageBridgeOnline } from "@/lib/sage/pay-application-read-queue"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { isInternalStaffRole } from "@/lib/user-roles"
import { requireUserContext } from "@/lib/server/action-context"

type SagePayApplicationSyncStatus =
  | "queued"
  | "running"
  | "processing"
  | "needs_review"
  | "completed"
  | "failed"

type SagePayApplicationSyncItem = {
  readonly id: string
  readonly status: SagePayApplicationSyncStatus
  readonly sageJobId: string | null
  readonly sageJobNumber: string | null
  readonly sourceApplicationId: string | null
  readonly sourceRevision: string | null
  readonly requestedAt: string
  readonly capturedAt: string | null
  readonly completedAt: string | null
  readonly errorMessage: string | null
}

export type SagePayApplicationSyncState = {
  readonly configured: boolean
  readonly online: boolean
  readonly canRequest: boolean
  readonly projectMapped: boolean
  readonly latest: SagePayApplicationSyncItem | null
  readonly recent: readonly SagePayApplicationSyncItem[]
}

type QueueResult =
  | { readonly success: true; readonly runId: string; readonly reused: boolean }
  | { readonly success: false; readonly error: string }

function syncStatus(value: string): SagePayApplicationSyncStatus {
  if (value === "queued") return "queued"
  if (value === "running") return "running"
  if (value === "processing") return "processing"
  if (value === "needs_review") return "needs_review"
  if (value === "completed") return "completed"
  return "failed"
}

function syncItem(
  row: typeof sagePayApplicationSyncRuns.$inferSelect
): SagePayApplicationSyncItem {
  return {
    id: row.id,
    status: syncStatus(row.status),
    sageJobId: row.sageJobId,
    sageJobNumber: row.sageJobNumber,
    sourceApplicationId: row.sourceApplicationId,
    sourceRevision: row.sourceRevision,
    requestedAt: row.requestedAt,
    capturedAt: row.capturedAt,
    completedAt: row.completedAt,
    errorMessage: row.errorMessage,
  }
}

export async function getSagePayApplicationSyncState(
  projectId: string
): Promise<SagePayApplicationSyncState> {
  const { user, db, env } = await requireUserContext()
  if (!isInternalStaffRole(user.role)) {
    throw new Error("Project not found")
  }
  await requireFeaturePermission(user, "budget", "read")
  await requireFeaturePermission(user, "sage-sync", "read")

  const project = await db
    .select({
      id: projects.id,
      organizationId: projects.organizationId,
      sageJobId: projects.sageJobId,
      sageJobNumber: projects.sageJobNumber,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
    .get()

  if (
    !project ||
    !user.organizationId ||
    project.organizationId !== user.organizationId
  ) {
    throw new Error("Project not found")
  }

  const rows = await db
    .select()
    .from(sagePayApplicationSyncRuns)
    .where(eq(sagePayApplicationSyncRuns.projectId, projectId))
    .orderBy(desc(sagePayApplicationSyncRuns.requestedAt))
    .limit(10)
  const online = await sageBridgeOnline(env)

  let canRequest = false
  if (
    isInternalStaffRole(user.role) &&
    !isDemoUser(user.id) &&
    !isDemoOrg(user.organizationId)
  ) {
    try {
      await requireFeaturePermission(user, "budget", "update")
      await requireFeaturePermission(user, "sage-sync", "update")
      canRequest = true
    } catch {
      canRequest = false
    }
  }

  const recent = rows.map(syncItem)
  return {
    configured: sageBridgeConfigured(env),
    online,
    canRequest,
    projectMapped: Boolean(project.sageJobId || project.sageJobNumber),
    latest: recent[0] ?? null,
    recent,
  }
}

export async function queueSagePayApplicationSync(
  projectId: string
): Promise<QueueResult> {
  try {
    const user = await requireAuth()
    if (
      !isInternalStaffRole(user.role) ||
      isDemoUser(user.id) ||
      !user.organizationId ||
      isDemoOrg(user.organizationId)
    ) {
      return { success: false, error: "Sage sync is unavailable." }
    }

    await requireFeaturePermission(user, "budget", "update")
    await requireFeaturePermission(user, "sage-sync", "update")

    const { env } = await getCloudflareContext()
    const result = await queueSagePayApplicationRead(env, { organizationId: user.organizationId, projectId, userId: user.id })
    if (!result.success) return result
    revalidatePath(`/dashboard/projects/${projectId}/budget`)
    return result
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to queue the Sage read sync.",
    }
  }
}
