"use server"

import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import {
  workdayExceptions,
  projects,
  scheduleTasks,
  taskDependencies,
} from "@/db/schema"
import { eq, and } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireAuth } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"
import { requirePermission } from "@/lib/permissions"
import { recordActivityEvent } from "@/lib/activity-log"
import { recalculateScheduleDates } from "@/lib/schedule/propagate-dates"
import type {
  DependencyType,
  TaskStatus,
  WorkdayExceptionData,
  ExceptionCategory,
  ExceptionRecurrence,
  WorkdayExceptionType,
} from "@/lib/schedule/types"

async function recalculateProjectDates(
  db: ReturnType<typeof getDb>,
  projectId: string,
  exceptions: readonly WorkdayExceptionData[]
): Promise<ReadonlyMap<string, {
  readonly startDate: string
  readonly endDateCalculated: string
}>> {
  const tasks = await db
    .select()
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))
  const taskIds = new Set(tasks.map((task) => task.id))
  const dependencies = (await db.select().from(taskDependencies)).filter(
    (dependency) =>
      taskIds.has(dependency.predecessorId) &&
      taskIds.has(dependency.successorId)
  )
  const { updatedTasks } = recalculateScheduleDates(
    tasks.map((task) => ({
      ...task,
      status: task.status as TaskStatus,
    })),
    dependencies.map((dependency) => ({
      ...dependency,
      type: dependency.type as DependencyType,
    })),
    exceptions
  )

  return updatedTasks
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

async function runExceptionScheduleBatch(
  database: D1Database,
  mutation: D1PreparedStatement,
  projectId: string,
  updatedAt: string,
  updatedTasks: ReadonlyMap<string, {
    readonly startDate: string
    readonly endDateCalculated: string
  }>
): Promise<void> {
  const statements: D1PreparedStatement[] = [mutation]
  for (const [taskId, dates] of updatedTasks) {
    statements.push(
      database
        .prepare(
          `UPDATE schedule_tasks
           SET start_date = ?, end_date_calculated = ?, updated_at = ?
           WHERE id = ? AND project_id = ?`
        )
        .bind(
          dates.startDate,
          dates.endDateCalculated,
          updatedAt,
          taskId,
          projectId
        )
    )
  }

  const results = await database.batch(statements)
  if (results.some((result) => !result.success)) {
    throw new Error("Workday exception schedule batch failed")
  }
}

export async function getWorkdayExceptions(
  projectId: string
): Promise<WorkdayExceptionData[]> {
  const user = await requireAuth()
  requirePermission(user, "schedule", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  // verify project belongs to user's org
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)

  if (!project) {
    throw new Error("Project not found or access denied")
  }

  const rows = await db
    .select()
    .from(workdayExceptions)
    .where(eq(workdayExceptions.projectId, projectId))

  return rows.map(exceptionData)
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
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Project not found or access denied" }
    }

    const now = new Date().toISOString()
    const exceptionId = crypto.randomUUID()
    const existingExceptions = await db
      .select()
      .from(workdayExceptions)
      .where(eq(workdayExceptions.projectId, projectId))
      .then((rows) => rows.map(exceptionData))
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
    await runExceptionScheduleBatch(
      env.DB,
      env.DB
        .prepare(
          `INSERT INTO workday_exceptions (
             id, project_id, title, start_date, end_date, type, category,
             recurrence, notes, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          newException.id,
          newException.projectId,
          newException.title,
          newException.startDate,
          newException.endDate,
          newException.type,
          newException.category,
          newException.recurrence,
          newException.notes,
          newException.createdAt,
          newException.updatedAt
        ),
      projectId,
      now,
      updatedTasks
    )
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
    revalidatePath(`/dashboard/projects/${projectId}/schedule`)
    revalidatePath("/dashboard/schedule")
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
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const [existing] = await db
      .select()
      .from(workdayExceptions)
      .where(eq(workdayExceptions.id, exceptionId))
      .limit(1)

    if (!existing) return { success: false, error: "Exception not found" }

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, existing.projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Access denied" }
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
    const currentExceptions = await db
      .select()
      .from(workdayExceptions)
      .where(eq(workdayExceptions.projectId, existing.projectId))
      .then((rows) => rows.map(exceptionData))
    const updatedTasks = await recalculateProjectDates(
      db,
      existing.projectId,
      currentExceptions.map((exception) =>
        exception.id === exceptionId ? updatedException : exception
      )
    )
    await runExceptionScheduleBatch(
      env.DB,
      env.DB
        .prepare(
          `UPDATE workday_exceptions
           SET title = ?, start_date = ?, end_date = ?, type = ?, category = ?,
               recurrence = ?, notes = ?, updated_at = ?
           WHERE id = ? AND project_id = ?`
        )
        .bind(
          updatedException.title,
          updatedException.startDate,
          updatedException.endDate,
          updatedException.type,
          updatedException.category,
          updatedException.recurrence,
          updatedException.notes,
          updatedAt,
          exceptionId,
          existing.projectId
        ),
      existing.projectId,
      updatedAt,
      updatedTasks
    )
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
    revalidatePath(
      `/dashboard/projects/${existing.projectId}/schedule`
    )
    revalidatePath("/dashboard/schedule")
    return { success: true }
  } catch (error) {
    console.error("Failed to update workday exception:", error)
    return { success: false, error: "Failed to update exception" }
  }
}

export async function deleteWorkdayException(
  exceptionId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const [existing] = await db
      .select()
      .from(workdayExceptions)
      .where(eq(workdayExceptions.id, exceptionId))
      .limit(1)

    if (!existing) return { success: false, error: "Exception not found" }

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, existing.projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Access denied" }
    }

    const updatedAt = new Date().toISOString()
    const remainingExceptions = await db
      .select()
      .from(workdayExceptions)
      .where(eq(workdayExceptions.projectId, existing.projectId))
      .then((rows) =>
        rows
          .filter((exception) => exception.id !== exceptionId)
          .map(exceptionData)
      )
    const updatedTasks = await recalculateProjectDates(
      db,
      existing.projectId,
      remainingExceptions
    )
    await runExceptionScheduleBatch(
      env.DB,
      env.DB
        .prepare(
          "DELETE FROM workday_exceptions WHERE id = ? AND project_id = ?"
        )
        .bind(exceptionId, existing.projectId),
      existing.projectId,
      updatedAt,
      updatedTasks
    )
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
    revalidatePath(
      `/dashboard/projects/${existing.projectId}/schedule`
    )
    revalidatePath("/dashboard/schedule")
    return { success: true }
  } catch (error) {
    console.error("Failed to delete workday exception:", error)
    return { success: false, error: "Failed to delete exception" }
  }
}
