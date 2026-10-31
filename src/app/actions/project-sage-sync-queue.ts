"use server"

import { eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { projectOperations, projectPurchaseOrderLines } from "@/db/schema"
import { errorMessage } from "@/lib/action-result"
import { chunkD1Values } from "@/lib/d1-query"
import { operationsContext } from "@/lib/domain/operations/access"
import { loadProjectOperation, loadSageSyncQueue } from "@/lib/domain/operations/queries"
import { operationCanQueueForSage } from "@/lib/domain/operations/rules"
import { operationUpdateQuery, purchaseOrderLinesUpdateQuery } from "@/lib/domain/operations/store"
import type { ProjectSageSyncQueue, ProjectSyncActionResult } from "@/lib/domain/operations/types"

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
      operationUpdateQuery(db, eq(projectOperations.id, operationId), {
        syncStatus: "queued_sage",
        sageWriteStatus: "queued",
        updatedAt: now,
      }),
      purchaseOrderLinesUpdateQuery(db, eq(projectPurchaseOrderLines.operationId, operationId), {
        syncStatus: "queued_sage",
        updatedAt: now,
      }),
    ])

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
    revalidatePath(`/dashboard/projects/${projectId}/daily-logs`)
    revalidatePath(`/dashboard/projects/${projectId}/schedule`)
    revalidatePath("/dashboard")
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
      operationUpdateQuery(db, inArray(projectOperations.id, ids), {
        syncStatus: "queued_sage",
        sageWriteStatus: "queued",
        updatedAt: now,
      }),
      purchaseOrderLinesUpdateQuery(db, inArray(projectPurchaseOrderLines.operationId, ids), {
        syncStatus: "queued_sage",
        updatedAt: now,
      }),
    ])
    if (first) await db.batch([first, ...rest])

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
    revalidatePath("/dashboard")
    return { success: true, updatedCount: readyIds.length }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to queue Sage sync") }
  }
}
