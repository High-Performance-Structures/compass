import { and, desc, eq, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { sageBridgeStatus, sagePayApplicationSyncRuns } from "@/db/schema-sage"
import { insertSagePayApplicationSyncRun } from "@/lib/domain/sage-bridge/store"

/*
 * Queues a read of a project's latest Sage pay application for the private,
 * read-only Sage bridge (it polls for queued runs, reads Sage, and posts the
 * snapshot back). Shared by the Budget page and the pay request area; callers
 * check who may ask first.
 */

const ACTIVE_SAGE_READ_STATUSES = ["queued", "running", "processing"] as const
const BRIDGE_HEARTBEAT_MAX_AGE_MILLISECONDS = 5 * 60 * 1000

export function sageBridgeConfigured(env: CloudflareEnv): boolean {
  const secret: unknown = Reflect.get(env, "SAGE_BRIDGE_SECRET")
  return typeof secret === "string" && secret.trim().length >= 32
}

/** Whether the bridge has checked in within the last few minutes. */
export async function sageBridgeOnline(env: CloudflareEnv): Promise<boolean> {
  const db = getDb(env.DB)
  const bridge = await db
    .select({ lastSeenAt: sageBridgeStatus.lastSeenAt })
    .from(sageBridgeStatus)
    .where(eq(sageBridgeStatus.id, "pay-application-poller"))
    .limit(1)
    .get()
  const lastSeenAt = bridge ? Date.parse(bridge.lastSeenAt) : Number.NaN
  return Number.isFinite(lastSeenAt) && Date.now() - lastSeenAt <= BRIDGE_HEARTBEAT_MAX_AGE_MILLISECONDS
}

export type SageReadQueueResult =
  | { readonly success: true; readonly runId: string; readonly reused: boolean }
  | { readonly success: false; readonly error: string }

async function activeRun(db: ReturnType<typeof getDb>, projectId: string): Promise<{ readonly id: string } | undefined> {
  return db
    .select({ id: sagePayApplicationSyncRuns.id })
    .from(sagePayApplicationSyncRuns)
    .where(and(eq(sagePayApplicationSyncRuns.projectId, projectId), inArray(sagePayApplicationSyncRuns.status, ACTIVE_SAGE_READ_STATUSES)))
    .orderBy(desc(sagePayApplicationSyncRuns.requestedAt))
    .limit(1)
    .get()
}

/** Queues the read, or reuses the project's read already waiting or running. */
export async function queueSagePayApplicationRead(
  env: CloudflareEnv,
  input: { readonly organizationId: string; readonly projectId: string; readonly userId: string }
): Promise<SageReadQueueResult> {
  if (!sageBridgeConfigured(env)) return { success: false, error: "The read-only Sage bridge is not configured." }
  const db = getDb(env.DB)
  if (!(await sageBridgeOnline(env))) return { success: false, error: "The private Sage poller is offline." }
  const project = await db
    .select({ id: projects.id, sageJobId: projects.sageJobId, sageJobNumber: projects.sageJobNumber })
    .from(projects)
    .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, input.organizationId)))
    .limit(1)
    .get()
  if (!project) return { success: false, error: "Project not found." }
  if (!project.sageJobId && !project.sageJobNumber) {
    return { success: false, error: "Map this Compass project to a Sage job before syncing." }
  }
  const active = await activeRun(db, input.projectId)
  if (active) return { success: true, runId: active.id, reused: true }
  const now = new Date().toISOString()
  const runId = crypto.randomUUID()
  try {
    await insertSagePayApplicationSyncRun(db, {
      id: runId,
      projectId: input.projectId,
      requestedByUserId: input.userId,
      idempotencyKey: `sage-pay-application-read:${input.projectId}:${runId}`,
      sageJobId: project.sageJobId,
      sageJobNumber: project.sageJobNumber,
      status: "queued",
      requestedAt: now,
      updatedAt: now,
    })
  } catch (error) {
    // The partial unique index closes the race between the active-run lookup
    // and insert. A simultaneous request should reuse the winner.
    const concurrent = await activeRun(db, input.projectId)
    if (concurrent) return { success: true, runId: concurrent.id, reused: true }
    throw error
  }
  return { success: true, runId, reused: false }
}
