"use server"

import { and, eq, inArray, ne, sql, type SQL } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { projectOperations, projectPurchaseOrderLines } from "@/db/schema"
import { errorMessage } from "@/lib/action-result"
import { chunkD1Values } from "@/lib/d1-query"
import { operationsContext } from "@/lib/domain/operations/access"
import { loadProjectOperation, loadSageSyncQueue } from "@/lib/domain/operations/queries"
import { operationCanQueueForSage } from "@/lib/domain/operations/rules"
import { operationUpdateQuery, purchaseOrderLinesUpdateQuery } from "@/lib/domain/operations/store"
import type { ProjectSageSyncQueue, ProjectSyncActionResult } from "@/lib/domain/operations/types"

/**
 * Still queueable when the write lands (operationCanQueueForSage, as SQL): a
 * row the Sage bridge marked synced or syncing since the page loaded keeps
 * its status instead of going back to "queued".
 */
function stillQueueable(): SQL | undefined {
  return and(
    eq(projectOperations.syncDirection, "write"),
    ne(projectOperations.sageWriteStatus, "not_ready"),
    inArray(projectOperations.syncStatus, ["pending_sage", "needs_review", "failed", "compass_only"]),
  )
}

/** Lines of operations this queue write just moved (same `updated_at` stamp). */
function linesOfQueued(now: string): SQL {
  return sql`EXISTS (SELECT 1 FROM project_operations op WHERE op.id = ${projectPurchaseOrderLines.operationId}
    AND op.sync_status = 'queued_sage' AND op.updated_at = ${now})`
}

/** How many of the project's operations this queue write (stamped `now`) actually moved. */
async function queuedCount(db: Parameters<typeof loadSageSyncQueue>[0], projectId: string, now: string): Promise<number> {
  const rows = await db.select({ id: projectOperations.id }).from(projectOperations).where(and(
    eq(projectOperations.projectId, projectId),
    eq(projectOperations.syncStatus, "queued_sage"),
    eq(projectOperations.updatedAt, now),
  ))
  return rows.length
}

/*
 * The project's Sage queue: staff of the project's organization with the
 * "sage-sync" permission (operations access, "organization" scope). Queuing
 * only marks rows for the Sage bridge; its own approval rules are unchanged.
 */

export async function getProjectSageSyncQueue(projectId: string): Promise<ProjectSageSyncQueue> {
  const { db } = await operationsContext(projectId, "sage-sync", false)
  return loadSageSyncQueue(db, projectId)
}

export async function queueProjectOperationForSageSync(
  projectId: string,
  operationId: string,
): Promise<ProjectSyncActionResult> {
  try {
    const { db } = await operationsContext(projectId, "sage-sync", true)
    const operation = await loadProjectOperation(db, projectId, operationId)
    if (!operation) return { success: false, error: "Sync item not found" }
    if (!operationCanQueueForSage(operation)) {
      return { success: false, error: "This item is not ready for Sage sync yet." }
    }

    const now = new Date().toISOString()
    await db.batch([
      operationUpdateQuery(db, and(eq(projectOperations.id, operationId), stillQueueable()), {
        syncStatus: "queued_sage",
        sageWriteStatus: "queued",
        updatedAt: now,
      }),
      purchaseOrderLinesUpdateQuery(db, and(eq(projectPurchaseOrderLines.operationId, operationId), linesOfQueued(now)), {
        syncStatus: "queued_sage",
        updatedAt: now,
      }),
    ])

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
    revalidatePath(`/dashboard/projects/${projectId}/daily-logs`)
    revalidatePath(`/dashboard/projects/${projectId}/schedule`)
    revalidatePath("/dashboard")
    // The item changed (the bridge synced it, say) since it was read: nothing was queued.
    if ((await queuedCount(db, projectId, now)) === 0) {
      return { success: false, error: "This item changed while you were queuing it. Refresh and try again." }
    }
    return { success: true, updatedCount: 1 }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to queue Sage sync") }
  }
}

export async function queueProjectOperationsForSageSync(projectId: string): Promise<ProjectSyncActionResult> {
  try {
    const { db } = await operationsContext(projectId, "sage-sync", true)
    const operations = await db
      .select({
        id: projectOperations.id,
        syncDirection: projectOperations.syncDirection,
        syncStatus: projectOperations.syncStatus,
        sageWriteStatus: projectOperations.sageWriteStatus,
      })
      .from(projectOperations)
      .where(eq(projectOperations.projectId, projectId))
    const readyIds = operations.filter(operationCanQueueForSage).map((operation) => operation.id)
    if (readyIds.length === 0) {
      return { success: false, error: "No Sage-ready items to queue." }
    }

    const now = new Date().toISOString()
    // Large jobs can have hundreds of ready items: chunks stay under D1's
    // bound-parameter limit, and one batch writes them all atomically.
    const [first, ...rest] = chunkD1Values(readyIds).flatMap((ids) => [
      operationUpdateQuery(db, and(inArray(projectOperations.id, ids), stillQueueable()), {
        syncStatus: "queued_sage",
        sageWriteStatus: "queued",
        updatedAt: now,
      }),
      purchaseOrderLinesUpdateQuery(db, and(inArray(projectPurchaseOrderLines.operationId, ids), linesOfQueued(now)), {
        syncStatus: "queued_sage",
        updatedAt: now,
      }),
    ])
    if (first) await db.batch([first, ...rest])

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
    revalidatePath("/dashboard")
    // Items synced or changed since they were read are left as they are and not counted.
    const updatedCount = await queuedCount(db, projectId, now)
    if (updatedCount === 0) return { success: false, error: "No Sage-ready items to queue." }
    return { success: true, updatedCount }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to queue Sage sync") }
  }
}
