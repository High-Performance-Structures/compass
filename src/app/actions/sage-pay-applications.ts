"use server"

import { and, desc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projects } from "@/db/schema"
import {
  sageBridgeStatus,
  sagePayApplicationSyncRuns,
} from "@/db/schema-sage"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { isInternalStaffRole } from "@/lib/user-roles"

const ACTIVE_SYNC_STATUSES = ["queued", "running", "processing"] as const
const BRIDGE_HEARTBEAT_MAX_AGE_MILLISECONDS = 5 * 60 * 1000

export type SagePayApplicationSyncStatus =
  | "queued"
  | "running"
  | "processing"
  | "needs_review"
  | "completed"
  | "failed"

export type SagePayApplicationSyncItem = {
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

function bridgeConfigured(env: CloudflareEnv): boolean {
  const secret: unknown = Reflect.get(env, "SAGE_BRIDGE_SECRET")
  return typeof secret === "string" && secret.trim().length >= 32
}

async function bridgeOnline(env: CloudflareEnv): Promise<boolean> {
  const db = getDb(env.DB)
  const bridge = await db
    .select({ lastSeenAt: sageBridgeStatus.lastSeenAt })
    .from(sageBridgeStatus)
    .where(eq(sageBridgeStatus.id, "pay-application-poller"))
    .limit(1)
    .get()
  const lastSeenAt = bridge ? Date.parse(bridge.lastSeenAt) : Number.NaN
  return (
    Number.isFinite(lastSeenAt) &&
    Date.now() - lastSeenAt <= BRIDGE_HEARTBEAT_MAX_AGE_MILLISECONDS
  )
}

export async function getSagePayApplicationSyncState(
  projectId: string
): Promise<SagePayApplicationSyncState> {
  const user = await requireAuth()
  if (!isInternalStaffRole(user.role)) {
    throw new Error("Project not found")
  }
  await requireFeaturePermission(user, "budget", "read")
  await requireFeaturePermission(user, "sage-sync", "read")
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

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
  const online = await bridgeOnline(env)

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
    configured: bridgeConfigured(env),
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
    if (!bridgeConfigured(env)) {
      return {
        success: false,
        error: "The read-only Sage bridge is not configured.",
      }
    }

    const db = getDb(env.DB)
    if (!(await bridgeOnline(env))) {
      return {
        success: false,
        error: "The private Sage poller is offline.",
      }
    }
    const project = await db
      .select({
        id: projects.id,
        organizationId: projects.organizationId,
        sageJobId: projects.sageJobId,
        sageJobNumber: projects.sageJobNumber,
      })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, user.organizationId)
        )
      )
      .limit(1)
      .get()

    if (!project) return { success: false, error: "Project not found." }
    if (!project.sageJobId && !project.sageJobNumber) {
      return {
        success: false,
        error: "Map this Compass project to a Sage job before syncing.",
      }
    }

    const active = await db
      .select({ id: sagePayApplicationSyncRuns.id })
      .from(sagePayApplicationSyncRuns)
      .where(
        and(
          eq(sagePayApplicationSyncRuns.projectId, projectId),
          inArray(sagePayApplicationSyncRuns.status, ACTIVE_SYNC_STATUSES)
        )
      )
      .orderBy(desc(sagePayApplicationSyncRuns.requestedAt))
      .limit(1)
      .get()

    if (active) {
      return { success: true, runId: active.id, reused: true }
    }

    const now = new Date().toISOString()
    const runId = crypto.randomUUID()
    try {
      await db.insert(sagePayApplicationSyncRuns).values({
        id: runId,
        projectId,
        requestedByUserId: user.id,
        idempotencyKey: `sage-pay-application-read:${projectId}:${runId}`,
        sageJobId: project.sageJobId,
        sageJobNumber: project.sageJobNumber,
        status: "queued",
        requestedAt: now,
        updatedAt: now,
      })
    } catch (error) {
      // The partial unique index closes the race between the active-run lookup
      // and insert. A simultaneous request should reuse the winner.
      const concurrent = await db
        .select({ id: sagePayApplicationSyncRuns.id })
        .from(sagePayApplicationSyncRuns)
        .where(
          and(
            eq(sagePayApplicationSyncRuns.projectId, projectId),
            inArray(sagePayApplicationSyncRuns.status, ACTIVE_SYNC_STATUSES)
          )
        )
        .orderBy(desc(sagePayApplicationSyncRuns.requestedAt))
        .limit(1)
        .get()
      if (concurrent) {
        return { success: true, runId: concurrent.id, reused: true }
      }
      throw error
    }

    revalidatePath(`/dashboard/projects/${projectId}/budget`)
    return { success: true, runId, reused: false }
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
