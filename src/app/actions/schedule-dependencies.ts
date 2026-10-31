"use server"

import { revalidatePath } from "next/cache"

import { recordActivityEvent } from "@/lib/activity-log"
import { readWorkingSchedule, scheduleWriteContext } from "@/lib/domain/schedule/access"
import {
  findDependency,
  isOrganizationProject,
  loadDependenciesForTasks,
  loadProjectTaskIds,
} from "@/lib/domain/schedule/queries"
import {
  dependencyData,
  dependencySelfError,
  propagateFrom,
  schedulePaths,
  validateDependency,
} from "@/lib/domain/schedule/rules"
import {
  deleteDependency as deleteDependencyRow,
  dependencyUpdateStatement,
  insertDependency,
  persistScheduleDateUpdates,
  recalcCriticalPath,
  runWithDateUpdates,
} from "@/lib/domain/schedule/store"
import { isScheduleShiftReasonRequired } from "@/lib/schedule/publication-history"
import { recordScheduleShift } from "@/lib/schedule/record-shift"
import { resolveScheduleShiftReason, summarizeScheduleShift } from "@/lib/schedule/shift-tracking"
import type { DependencyType } from "@/lib/schedule/types"

type DependencyResult = { readonly success: true } | { readonly success: false; readonly error: string }

function revalidateSchedulePaths(projectId: string): void {
  for (const path of schedulePaths(projectId)) revalidatePath(path)
}

export async function createDependency(data: {
  predecessorId: string
  successorId: string
  type: DependencyType
  lagDays: number
  projectId: string
  shiftReason: string
}): Promise<DependencyResult> {
  try {
    const context = await scheduleWriteContext()
    if (!context.success) return context
    const { db, env, organizationId: orgId, user } = context.data

    if (!(await isOrganizationProject(db, orgId, data.projectId))) {
      return { success: false, error: "Project not found or access denied" }
    }
    const shiftReasonResult = resolveScheduleShiftReason(
      await isScheduleShiftReasonRequired(db, data.projectId),
      data.shiftReason
    )
    if (shiftReasonResult !== null && !shiftReasonResult.success) {
      return { success: false, error: shiftReasonResult.error }
    }
    const selfError = dependencySelfError(data.predecessorId, data.successorId)
    if (selfError) return { success: false, error: selfError }

    const projectTaskIds = await loadProjectTaskIds(db, data.projectId)
    const projectDependencies = await loadDependenciesForTasks(db, [...projectTaskIds])
    const invalid = validateDependency({
      predecessorId: data.predecessorId,
      successorId: data.successorId,
      projectTaskIds,
      dependencies: projectDependencies.map(dependencyData),
    })
    if (invalid) return { success: false, error: invalid }

    // The working schedule read also confirms the viewer can open the project.
    const schedule = await readWorkingSchedule(context.data, data.projectId)

    const dependencyId = crypto.randomUUID()
    await insertDependency(db, {
      id: dependencyId,
      predecessorId: data.predecessorId,
      successorId: data.successorId,
      type: data.type,
      lagDays: data.lagDays
    })

    // propagate dates from predecessor
    const updatedSchedule = await readWorkingSchedule(context.data, data.projectId)
    const updatedTasks = propagateFrom(
      data.predecessorId,
      updatedSchedule.tasks,
      updatedSchedule.dependencies,
      updatedSchedule.exceptions
    )
    const shiftSummary = summarizeScheduleShift(schedule.tasks, updatedTasks)
    await persistScheduleDateUpdates(env.DB, data.projectId, updatedTasks, new Date().toISOString())
    if (shiftReasonResult?.success) {
      await recordScheduleShift({
        db,
        organizationId: orgId,
        projectId: data.projectId,
        actor: user,
        sourceType: "schedule_dependency",
        sourceId: dependencyId,
        sourceLabel: "a new dependency",
        reason: shiftReasonResult.reason,
        summary: shiftSummary,
      })
    }

    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId: data.projectId,
      actor: user,
      category: "schedule",
      action: "schedule.dependency_created",
      entityType: "schedule_dependency",
      summary: "Added a schedule dependency.",
      metadata: {
        affectedItemCount: updatedTasks.size,
        relationship: data.type,
        lagDays: data.lagDays
      }
    })
    await recalcCriticalPath(db, data.projectId)
    revalidateSchedulePaths(data.projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to create dependency:", error)
    return { success: false, error: "Failed to create dependency" }
  }
}

export async function updateDependency(data: {
  dependencyId: string
  predecessorId: string
  successorId: string
  type: DependencyType
  lagDays: number
  projectId: string
  shiftReason: string
}): Promise<DependencyResult> {
  try {
    const context = await scheduleWriteContext()
    if (!context.success) return context
    const { db, env, organizationId: orgId, user } = context.data

    if (!(await isOrganizationProject(db, orgId, data.projectId))) {
      return { success: false, error: "Project not found or access denied" }
    }
    const shiftReasonResult = resolveScheduleShiftReason(
      await isScheduleShiftReasonRequired(db, data.projectId),
      data.shiftReason
    )
    if (shiftReasonResult !== null && !shiftReasonResult.success) {
      return { success: false, error: shiftReasonResult.error }
    }
    const selfError = dependencySelfError(data.predecessorId, data.successorId)
    if (selfError) return { success: false, error: selfError }

    const schedule = await readWorkingSchedule(context.data, data.projectId)
    if (!schedule.dependencies.some((dependency) => dependency.id === data.dependencyId)) {
      return { success: false, error: "Dependency not found" }
    }
    const invalid = validateDependency({
      predecessorId: data.predecessorId,
      successorId: data.successorId,
      projectTaskIds: new Set(schedule.tasks.map((task) => task.id)),
      dependencies: schedule.dependencies,
      replacingId: data.dependencyId,
    })
    if (invalid) return { success: false, error: invalid }

    const updatedDependency = {
      id: data.dependencyId,
      predecessorId: data.predecessorId,
      successorId: data.successorId,
      type: data.type,
      lagDays: data.lagDays
    }
    const recalculated = propagateFrom(
      data.predecessorId,
      schedule.tasks,
      [
        ...schedule.dependencies.filter((dependency) => dependency.id !== data.dependencyId),
        updatedDependency,
      ],
      schedule.exceptions
    )
    const shiftSummary = summarizeScheduleShift(schedule.tasks, recalculated)
    await runWithDateUpdates(
      env.DB,
      dependencyUpdateStatement(env.DB, updatedDependency),
      data.projectId,
      recalculated,
      new Date().toISOString(),
      "Dependency update batch failed"
    )
    if (shiftReasonResult?.success) {
      await recordScheduleShift({
        db,
        organizationId: orgId,
        projectId: data.projectId,
        actor: user,
        sourceType: "schedule_dependency",
        sourceId: data.dependencyId,
        sourceLabel: "an updated dependency",
        reason: shiftReasonResult.reason,
        summary: shiftSummary,
      })
    }

    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId: data.projectId,
      actor: user,
      category: "schedule",
      action: "schedule.dependency_updated",
      entityType: "schedule_dependency",
      entityId: data.dependencyId,
      summary: "Updated a schedule dependency.",
      metadata: {
        affectedItemCount: recalculated.size,
        relationship: data.type,
        lagDays: data.lagDays
      }
    })
    await recalcCriticalPath(db, data.projectId)
    revalidateSchedulePaths(data.projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to update dependency:", error)
    return { success: false, error: "Failed to update dependency" }
  }
}

export async function deleteDependency(
  depId: string,
  projectId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const context = await scheduleWriteContext()
    if (!context.success) return context
    const { db, organizationId: orgId, user } = context.data

    if (!(await isOrganizationProject(db, orgId, projectId))) {
      return { success: false, error: "Project not found or access denied" }
    }

    const dependency = await findDependency(db, depId)
    if (!dependency) {
      return { success: false, error: "Dependency not found" }
    }

    const taskIds = await loadProjectTaskIds(db, projectId)
    if (!taskIds.has(dependency.predecessorId) || !taskIds.has(dependency.successorId)) {
      return {
        success: false,
        error: "Dependency does not belong to this project"
      }
    }

    await deleteDependencyRow(db, depId)
    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId,
      actor: user,
      category: "schedule",
      action: "schedule.dependency_deleted",
      entityType: "schedule_dependency",
      entityId: depId,
      summary: "Removed a schedule dependency."
    })
    await recalcCriticalPath(db, projectId)
    revalidateSchedulePaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to delete dependency:", error)
    return { success: false, error: "Failed to delete dependency" }
  }
}
