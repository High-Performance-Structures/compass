"use server"

import type { workdayExceptions } from "@/db/schema"
import { revalidatePath } from "next/cache"
import { recordActivityEvent } from "@/lib/activity-log"
import { scheduleWriteContext } from "@/lib/domain/schedule/access"
import {
  findException,
  isOrganizationProject,
  loadProjectExceptionRows,
  loadProjectScheduleRows,
  loadProjectTasksUnordered,
} from "@/lib/domain/schedule/queries"
import { dependencyData, recalculateAll, schedulePaths, taskWithStatus, type DateUpdates } from "@/lib/domain/schedule/rules"
import {
  exceptionDeleteStatement,
  exceptionInsertStatement,
  exceptionUpdateStatement,
  runWithDateUpdates,
} from "@/lib/domain/schedule/store"
import type { Db } from "@/lib/server/action-context"
import { isScheduleShiftReasonRequired } from "@/lib/schedule/publication-history"
import { recordScheduleShift } from "@/lib/schedule/record-shift"
import {
  summarizeScheduleShift,
  resolveScheduleShiftReason,
} from "@/lib/schedule/shift-tracking"
import type {
  WorkdayExceptionData,
  ExceptionCategory,
  ExceptionRecurrence,
  WorkdayExceptionType,
} from "@/lib/schedule/types"

async function recalculateProjectDates(
  db: Db,
  projectId: string,
  exceptions: readonly WorkdayExceptionData[]
): Promise<DateUpdates> {
  const { tasks, dependencies } = await loadProjectScheduleRows(db, projectId)
  return recalculateAll(tasks.map(taskWithStatus), dependencies.map(dependencyData), exceptions)
}

function exceptionType(value: string): WorkdayExceptionType {
  return value === "working" ? "working" : "non_working"
}

function exceptionCategory(value: string): ExceptionCategory {
  switch (value) {
    case "national_holiday":
    case "state_holiday":
    case "vacation_day":
    case "company_holiday":
    case "weather_day":
    case "extra_workday":
      return value
    default:
      return "company_holiday"
  }
}

function exceptionRecurrence(value: string): ExceptionRecurrence {
  return value === "yearly" ? "yearly" : "one_time"
}

function exceptionData(
  row: typeof workdayExceptions.$inferSelect
): WorkdayExceptionData {
  return {
    ...row,
    type: exceptionType(row.type),
    category: exceptionCategory(row.category),
    recurrence: exceptionRecurrence(row.recurrence),
  }
}

function revalidateExceptionPaths(projectId: string): void {
  for (const path of schedulePaths(projectId)) revalidatePath(path)
}

export async function createWorkdayException(
  projectId: string,
  data: {
    title: string
    startDate: string
    endDate: string
    type: WorkdayExceptionType
    category: ExceptionCategory
    recurrence: ExceptionRecurrence
    notes?: string
    shiftReason: string
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const context = await scheduleWriteContext()
    if (!context.success) return context
    const { db, env, organizationId: orgId, user } = context.data

    if (!(await isOrganizationProject(db, orgId, projectId))) {
      return { success: false, error: "Project not found or access denied" }
    }
    const shiftReasonResult = resolveScheduleShiftReason(
      await isScheduleShiftReasonRequired(db, projectId),
      data.shiftReason
    )
    if (shiftReasonResult !== null && !shiftReasonResult.success) {
      return { success: false, error: shiftReasonResult.error }
    }

    const now = new Date().toISOString()
    const exceptionId = crypto.randomUUID()
    const existingExceptions = await loadProjectExceptionRows(db, projectId)
      .then((rows) => rows.map(exceptionData))
    const tasksBefore = await loadProjectTasksUnordered(db, projectId)
    const newException: WorkdayExceptionData = {
      id: exceptionId,
      projectId,
      title: data.title,
      startDate: data.startDate,
      endDate: data.endDate,
      type: data.type,
      category: data.category,
      recurrence: data.recurrence,
      notes: data.notes ?? null,
      createdAt: now,
      updatedAt: now,
    }
    const updatedTasks = await recalculateProjectDates(db, projectId, [
      ...existingExceptions,
      newException,
    ])
    const shiftSummary = summarizeScheduleShift(tasksBefore, updatedTasks)
    await runWithDateUpdates(
      env.DB,
      exceptionInsertStatement(env.DB, newException),
      projectId,
      updatedTasks,
      now,
      "Workday exception schedule batch failed"
    )
    if (shiftReasonResult?.success) {
      await recordScheduleShift({
        db,
        organizationId: orgId,
        projectId,
        actor: user,
        sourceType: "workday_exception",
        sourceId: exceptionId,
        sourceLabel: `workday exception “${data.title}”`,
        reason: shiftReasonResult.reason,
        summary: shiftSummary,
      })
    }
    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId,
      actor: user,
      category: "schedule",
      action: "schedule.workday_exception_created",
      entityType: "workday_exception",
      entityId: exceptionId,
      summary: `Added workday exception “${data.title}”.`,
      metadata: { affectedItemCount: updatedTasks.size },
    })
    revalidateExceptionPaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to create workday exception:", error)
    return { success: false, error: "Failed to create exception" }
  }
}

export async function updateWorkdayException(
  exceptionId: string,
  data: {
    title?: string
    startDate?: string
    endDate?: string
    type?: WorkdayExceptionType
    category?: ExceptionCategory
    recurrence?: ExceptionRecurrence
    notes?: string | null
    shiftReason: string
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const context = await scheduleWriteContext()
    if (!context.success) return context
    const { db, env, organizationId: orgId, user } = context.data

    const existing = await findException(db, exceptionId)

    if (!existing) return { success: false, error: "Exception not found" }

    if (!(await isOrganizationProject(db, orgId, existing.projectId))) {
      return { success: false, error: "Access denied" }
    }
    const shiftReasonResult = resolveScheduleShiftReason(
      await isScheduleShiftReasonRequired(db, existing.projectId),
      data.shiftReason
    )
    if (shiftReasonResult !== null && !shiftReasonResult.success) {
      return { success: false, error: shiftReasonResult.error }
    }

    const updatedAt = new Date().toISOString()
    const updatedException: WorkdayExceptionData = {
      ...exceptionData(existing),
      title: data.title ?? existing.title,
      startDate: data.startDate ?? existing.startDate,
      endDate: data.endDate ?? existing.endDate,
      type: data.type ?? exceptionType(existing.type),
      category: data.category ?? exceptionCategory(existing.category),
      recurrence:
        data.recurrence ?? exceptionRecurrence(existing.recurrence),
      notes: data.notes === undefined ? existing.notes : data.notes,
      updatedAt,
    }
    const currentExceptions = await loadProjectExceptionRows(db, existing.projectId)
      .then((rows) => rows.map(exceptionData))
    const tasksBefore = await loadProjectTasksUnordered(db, existing.projectId)
    const updatedTasks = await recalculateProjectDates(
      db,
      existing.projectId,
      currentExceptions.map((exception) =>
        exception.id === exceptionId ? updatedException : exception
      )
    )
    const shiftSummary = summarizeScheduleShift(tasksBefore, updatedTasks)
    await runWithDateUpdates(
      env.DB,
      exceptionUpdateStatement(env.DB, updatedException),
      existing.projectId,
      updatedTasks,
      updatedAt,
      "Workday exception schedule batch failed"
    )
    if (shiftReasonResult?.success) {
      await recordScheduleShift({
        db,
        organizationId: orgId,
        projectId: existing.projectId,
        actor: user,
        sourceType: "workday_exception",
        sourceId: exceptionId,
        sourceLabel: `workday exception “${updatedException.title}”`,
        reason: shiftReasonResult.reason,
        summary: shiftSummary,
      })
    }
    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId: existing.projectId,
      actor: user,
      category: "schedule",
      action: "schedule.workday_exception_updated",
      entityType: "workday_exception",
      entityId: exceptionId,
      summary: `Updated workday exception “${updatedException.title}”.`,
      metadata: { affectedItemCount: updatedTasks.size },
    })
    revalidateExceptionPaths(existing.projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to update workday exception:", error)
    return { success: false, error: "Failed to update exception" }
  }
}

export async function deleteWorkdayException(
  exceptionId: string,
  shiftReason: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const context = await scheduleWriteContext()
    if (!context.success) return context
    const { db, env, organizationId: orgId, user } = context.data

    const existing = await findException(db, exceptionId)

    if (!existing) return { success: false, error: "Exception not found" }

    if (!(await isOrganizationProject(db, orgId, existing.projectId))) {
      return { success: false, error: "Access denied" }
    }
    const shiftReasonResult = resolveScheduleShiftReason(
      await isScheduleShiftReasonRequired(db, existing.projectId),
      shiftReason
    )
    if (shiftReasonResult !== null && !shiftReasonResult.success) {
      return { success: false, error: shiftReasonResult.error }
    }

    const updatedAt = new Date().toISOString()
    const remainingExceptions = await loadProjectExceptionRows(db, existing.projectId)
      .then((rows) =>
        rows
          .filter((exception) => exception.id !== exceptionId)
          .map(exceptionData)
      )
    const tasksBefore = await loadProjectTasksUnordered(db, existing.projectId)
    const updatedTasks = await recalculateProjectDates(
      db,
      existing.projectId,
      remainingExceptions
    )
    const shiftSummary = summarizeScheduleShift(tasksBefore, updatedTasks)
    await runWithDateUpdates(
      env.DB,
      exceptionDeleteStatement(env.DB, exceptionId, existing.projectId),
      existing.projectId,
      updatedTasks,
      updatedAt,
      "Workday exception schedule batch failed"
    )
    if (shiftReasonResult?.success) {
      await recordScheduleShift({
        db,
        organizationId: orgId,
        projectId: existing.projectId,
        actor: user,
        sourceType: "workday_exception",
        sourceId: exceptionId,
        sourceLabel: `deleted workday exception “${existing.title}”`,
        reason: shiftReasonResult.reason,
        summary: shiftSummary,
      })
    }
    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId: existing.projectId,
      actor: user,
      category: "schedule",
      action: "schedule.workday_exception_deleted",
      entityType: "workday_exception",
      entityId: exceptionId,
      summary: `Deleted workday exception “${existing.title}”.`,
      metadata: { affectedItemCount: updatedTasks.size },
    })
    revalidateExceptionPaths(existing.projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to delete workday exception:", error)
    return { success: false, error: "Failed to delete exception" }
  }
}
