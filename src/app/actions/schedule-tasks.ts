"use server"

import { revalidatePath } from "next/cache"

import { recordActivityEvent } from "@/lib/activity-log"
import { scheduleWriteContext } from "@/lib/domain/schedule/access"
import { isOrganizationProject, loadMatchingProjectTasks } from "@/lib/domain/schedule/queries"
import { bulkTaskIds, itemsLabel, schedulePaths } from "@/lib/domain/schedule/rules"
import {
  assignProjectTasks,
  completeProjectTasks,
  deleteProjectTasks,
  recalcCriticalPath,
} from "@/lib/domain/schedule/store"
import type { OrgContext } from "@/lib/server/action-context"

/* Bulk complete, assign, and delete from the schedule list. */

type BulkResult = { readonly success: true } | { readonly success: false; readonly error: string }

function revalidateSchedulePaths(projectId: string): void {
  for (const path of schedulePaths(projectId)) revalidatePath(path)
}

type BulkSelection =
  | {
      readonly success: true
      readonly context: OrgContext
      readonly tasks: readonly { readonly id: string; readonly confirmationRequired: boolean }[]
    }
  | { readonly success: false; readonly error: string }

/** Resolves a bulk selection to the project's matching tasks, or the message to show. */
async function bulkSelection(
  projectId: string,
  taskIds: readonly string[],
  verb: "Update" | "Delete"
): Promise<BulkSelection> {
  const context = await scheduleWriteContext()
  if (!context.success) return context
  const selection = bulkTaskIds(taskIds, verb)
  if ("error" in selection) return { success: false, error: selection.error }
  const { db, organizationId } = context.data
  if (!(await isOrganizationProject(db, organizationId, projectId))) {
    return { success: false, error: "Project not found or access denied" }
  }
  const tasks = await loadMatchingProjectTasks(db, projectId, selection.ids)
  if (tasks.length !== selection.ids.length) {
    return { success: false, error: "One or more schedule items could not be found" }
  }
  return { success: true, context: context.data, tasks }
}

export async function completeScheduleTasks(
  projectId: string,
  taskIds: readonly string[]
): Promise<BulkResult> {
  try {
    const selection = await bulkSelection(projectId, taskIds, "Update")
    if (!selection.success) return selection
    const { context, tasks } = selection
    const { db, organizationId: orgId, user } = context
    const ids = tasks.map((task) => task.id)


    await completeProjectTasks(db, projectId, ids, new Date().toISOString())
    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId,
      actor: user,
      category: "schedule",
      action: "schedule.items_completed",
      entityType: "schedule_item_batch",
      summary: `Marked ${ids.length} schedule ${itemsLabel(ids.length)} complete.`,
      metadata: { itemCount: ids.length }
    })
    await recalcCriticalPath(db, projectId)
    revalidateSchedulePaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to complete schedule items:", error)
    return { success: false, error: "Failed to complete schedule items" }
  }
}

export async function assignScheduleTasks(
  projectId: string,
  taskIds: readonly string[],
  assignedTo: string | null
): Promise<BulkResult> {
  try {
    const selection = await bulkSelection(projectId, taskIds, "Update")
    if (!selection.success) return selection
    const { context, tasks } = selection
    const { db, organizationId: orgId, user } = context
    const ids = tasks.map((task) => task.id)


    await assignProjectTasks(
      db,
      projectId,
      tasks,
      assignedTo?.trim() || null,
      new Date().toISOString()
    )
    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId,
      actor: user,
      category: "schedule",
      action: "schedule.items_assigned",
      entityType: "schedule_item_batch",
      summary: assignedTo?.trim()
        ? `Assigned ${ids.length} schedule ${itemsLabel(ids.length)} to ${assignedTo.trim()}.`
        : `Cleared the assignee from ${ids.length} schedule ${itemsLabel(ids.length)}.`,
      metadata: { itemCount: ids.length }
    })
    revalidateSchedulePaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to assign schedule items:", error)
    return { success: false, error: "Failed to assign schedule items" }
  }
}

export async function deleteScheduleTasks(
  projectId: string,
  taskIds: readonly string[]
): Promise<BulkResult> {
  try {
    const selection = await bulkSelection(projectId, taskIds, "Delete")
    if (!selection.success) return selection
    const { context, tasks } = selection
    const { db, organizationId: orgId, user } = context
    const ids = tasks.map((task) => task.id)


    await deleteProjectTasks(db, projectId, ids)
    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId,
      actor: user,
      category: "schedule",
      action: "schedule.items_deleted",
      entityType: "schedule_item_batch",
      summary: `Deleted ${ids.length} schedule ${itemsLabel(ids.length)}.`,
      metadata: { itemCount: ids.length }
    })
    await recalcCriticalPath(db, projectId)
    revalidateSchedulePaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to delete schedule items:", error)
    return { success: false, error: "Failed to delete schedule items" }
  }
}
