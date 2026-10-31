"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { scheduleBaselines } from "@/db/schema"
import { recordActivityEvent } from "@/lib/activity-log"
import {
  canViewWorkingSchedule,
  scheduleReadContext,
  scheduleWriteContext,
} from "@/lib/domain/schedule/access"
import {
  isOrganizationProject,
  loadDependenciesForTasks,
  loadProjectTasks,
} from "@/lib/domain/schedule/queries"
import { deleteBaseline as deleteBaselineRow, insertBaseline } from "@/lib/domain/schedule/store"
import type { ScheduleBaselineData } from "@/lib/schedule/types"

export async function getBaselines(
  projectId: string
): Promise<ScheduleBaselineData[]> {
  const { db, organizationId, user } = await scheduleReadContext()
  if (!canViewWorkingSchedule(user.role)) return []

  if (!(await isOrganizationProject(db, organizationId, projectId))) {
    throw new Error("Project not found or access denied")
  }

  return await db
    .select()
    .from(scheduleBaselines)
    .where(eq(scheduleBaselines.projectId, projectId))
}

export async function createBaseline(
  projectId: string,
  name: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const context = await scheduleWriteContext()
    if (!context.success) return context
    const { db, organizationId: orgId, user } = context.data

    if (!(await isOrganizationProject(db, orgId, projectId))) {
      return { success: false, error: "Project not found or access denied" }
    }

    const tasks = await loadProjectTasks(db, projectId)
    const projectDeps = await loadDependenciesForTasks(
      db,
      tasks.map((task) => task.id)
    )
    const snapshot = JSON.stringify({ tasks, dependencies: projectDeps })

    const baselineId = crypto.randomUUID()
    await insertBaseline(db, {
      id: baselineId,
      projectId,
      name,
      snapshotData: snapshot,
      createdAt: new Date().toISOString(),
    })

    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId,
      actor: user,
      category: "schedule",
      action: "schedule.baseline_created",
      entityType: "schedule_baseline",
      entityId: baselineId,
      summary: `Saved schedule baseline “${name}”.`,
      metadata: { itemCount: tasks.length },
    })
    revalidatePath(`/dashboard/projects/${projectId}/schedule`)
    return { success: true }
  } catch (error) {
    console.error("Failed to create baseline:", error)
    return { success: false, error: "Failed to create baseline" }
  }
}

export async function deleteBaseline(
  baselineId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const context = await scheduleWriteContext()
    if (!context.success) return context
    const { db, organizationId: orgId, user } = context.data

    const existing = await db
      .select()
      .from(scheduleBaselines)
      .where(eq(scheduleBaselines.id, baselineId))
      .limit(1)
      .get()

    if (!existing) return { success: false, error: "Baseline not found" }

    if (!(await isOrganizationProject(db, orgId, existing.projectId))) {
      return { success: false, error: "Access denied" }
    }

    await deleteBaselineRow(db, baselineId)

    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId: existing.projectId,
      actor: user,
      category: "schedule",
      action: "schedule.baseline_deleted",
      entityType: "schedule_baseline",
      entityId: baselineId,
      summary: "Deleted a schedule baseline.",
    })
    revalidatePath(
      `/dashboard/projects/${existing.projectId}/schedule`
    )
    return { success: true }
  } catch (error) {
    console.error("Failed to delete baseline:", error)
    return { success: false, error: "Failed to delete baseline" }
  }
}
