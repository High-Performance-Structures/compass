"use server"

import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import {
  scheduleTasks,
  taskDependencies,
  workdayExceptions,
  projects,
} from "@/db/schema"
import { eq, asc, and, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { calculateEndDate } from "@/lib/schedule/business-days"
import { findCriticalPath } from "@/lib/schedule/critical-path"
import {
  wouldCreateCycle,
  wouldDependencyUpdateCreateCycle,
} from "@/lib/schedule/dependency-validation"
import { propagateDates } from "@/lib/schedule/propagate-dates"
import {
  effectivePercentComplete,
  normalizeScheduleProgress,
} from "@/lib/schedule/progress"
import { requireAuth } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"
import { notifyProjectAssignment } from "@/lib/notifications/events"
import type {
  TaskStatus,
  DependencyType,
  ExceptionCategory,
  ExceptionRecurrence,
  ScheduleData,
  WorkdayExceptionData,
  WorkdayExceptionType,
} from "@/lib/schedule/types"

function revalidateSchedulePaths(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/schedule`)
  revalidatePath("/dashboard/schedule")
}

async function fetchExceptions(
  db: ReturnType<typeof getDb>,
  projectId: string
): Promise<WorkdayExceptionData[]> {
  const rows = await db
    .select()
    .from(workdayExceptions)
    .where(eq(workdayExceptions.projectId, projectId))

  return rows.map((r) => ({
    ...r,
    type: r.type as WorkdayExceptionType,
    category: r.category as ExceptionCategory,
    recurrence: r.recurrence as ExceptionRecurrence,
  }))
}

export async function getSchedule(
  projectId: string
): Promise<ScheduleData> {
  const user = await requireAuth()
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

  const tasks = await db
    .select()
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))
    .orderBy(asc(scheduleTasks.sortOrder))

  const deps = await db.select().from(taskDependencies)
  const exceptions = await fetchExceptions(db, projectId)

  const taskIds = new Set(tasks.map((t) => t.id))
  const projectDeps = deps.filter(
    (d) => taskIds.has(d.predecessorId) && taskIds.has(d.successorId)
  )

  return {
    tasks: tasks.map((t) => {
      const status = t.status as TaskStatus
      return {
        ...t,
        status,
        phase: t.phase,
        percentComplete: effectivePercentComplete(status, t.percentComplete),
      }
    }),
    dependencies: projectDeps.map((d) => ({
      ...d,
      type: d.type as DependencyType,
    })),
    exceptions,
  }
}

export async function createTask(
  projectId: string,
  data: {
    title: string
    startDate: string
    workdays: number
    phase: string
    displayColor?: string
    status?: TaskStatus
    isMilestone?: boolean
    percentComplete?: number
    assignedTo?: string
  }
): Promise<
  | { readonly success: true; readonly taskId: string }
  | { readonly success: false; readonly error: string }
> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
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

    const exceptions = await fetchExceptions(db, projectId)
    const endDate = calculateEndDate(
      data.startDate, data.workdays, exceptions
    )
    const now = new Date().toISOString()

    const existing = await db
      .select({ sortOrder: scheduleTasks.sortOrder })
      .from(scheduleTasks)
      .where(eq(scheduleTasks.projectId, projectId))
      .orderBy(asc(scheduleTasks.sortOrder))

    const nextOrder = existing.length > 0
      ? existing[existing.length - 1].sortOrder + 1
      : 0

    const id = crypto.randomUUID()
    const progress = normalizeScheduleProgress(
      data.status ?? "PENDING",
      data.percentComplete ?? 0
    )
    await db.insert(scheduleTasks).values({
      id,
      projectId,
      title: data.title,
      startDate: data.startDate,
      workdays: data.workdays,
      endDateCalculated: endDate,
      phase: data.phase,
      displayColor: data.displayColor ?? "blue",
      status: progress.status,
      isCriticalPath: false,
      isMilestone: data.isMilestone ?? false,
      percentComplete: progress.percentComplete,
      assignedTo: data.assignedTo ?? null,
      sortOrder: nextOrder,
      createdAt: now,
      updatedAt: now,
    })

    try {
      await notifyProjectAssignment({
        organizationId: orgId,
        projectId,
        itemId: id,
        title: data.title,
        assignedToName: data.assignedTo ?? null,
        createdBy: user,
        kind: "schedule",
      })
    } catch (notificationError) {
      console.error(
        "Schedule assignment notification failed:",
        notificationError
      )
    }

    await recalcCriticalPath(db, projectId)
    revalidateSchedulePaths(projectId)
    return { success: true, taskId: id }
  } catch (error) {
    console.error("Failed to create task:", error)
    return { success: false, error: "Failed to create schedule item" }
  }
}

export async function updateTask(
  taskId: string,
  data: {
    title?: string
    startDate?: string
    workdays?: number
    phase?: string
    displayColor?: string
    status?: TaskStatus
    isMilestone?: boolean
    percentComplete?: number
    assignedTo?: string | null
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const [task] = await db
      .select()
      .from(scheduleTasks)
      .where(eq(scheduleTasks.id, taskId))
      .limit(1)

    if (!task) return { success: false, error: "Schedule item not found" }

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, task.projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Access denied" }
    }

    const exceptions = await fetchExceptions(db, task.projectId)
    const startDate = data.startDate ?? task.startDate
    const workdays = data.workdays ?? task.workdays
    const endDate = calculateEndDate(startDate, workdays, exceptions)
    const progress = normalizeScheduleProgress(
      (data.status ?? task.status) as TaskStatus,
      data.percentComplete ?? task.percentComplete
    )

    await db
      .update(scheduleTasks)
      .set({
        ...(data.title && { title: data.title }),
        startDate,
        workdays,
        endDateCalculated: endDate,
        ...(data.phase && { phase: data.phase }),
        ...(data.displayColor && { displayColor: data.displayColor }),
        status: progress.status,
        ...(data.isMilestone !== undefined && {
          isMilestone: data.isMilestone,
        }),
        percentComplete: progress.percentComplete,
        ...(data.assignedTo !== undefined && {
          assignedTo: data.assignedTo,
        }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(scheduleTasks.id, taskId))

    if (
      data.assignedTo !== undefined &&
      data.assignedTo !== null &&
      data.assignedTo !== task.assignedTo
    ) {
      try {
        await notifyProjectAssignment({
          organizationId: orgId,
          projectId: task.projectId,
          itemId: taskId,
          title: data.title ?? task.title,
          assignedToName: data.assignedTo,
          createdBy: user,
          kind: "schedule",
        })
      } catch (notificationError) {
        console.error(
          "Schedule reassignment notification failed:",
          notificationError
        )
      }
    }

    // propagate date changes to downstream tasks
    const schedule = await getSchedule(task.projectId)
    const updatedTask = {
      ...task,
      status: progress.status,
      percentComplete: progress.percentComplete,
      startDate,
      workdays,
      endDateCalculated: endDate,
    }
    const allTasks = schedule.tasks.map((t) =>
      t.id === taskId ? updatedTask : t
    )
    const { updatedTasks } = propagateDates(
      taskId, allTasks, schedule.dependencies, exceptions
    )

    for (const [id, dates] of updatedTasks) {
      await db
        .update(scheduleTasks)
        .set({
          startDate: dates.startDate,
          endDateCalculated: dates.endDateCalculated,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(scheduleTasks.id, id))
    }

    await recalcCriticalPath(db, task.projectId)
    revalidateSchedulePaths(task.projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to update task:", error)
    return { success: false, error: "Failed to update schedule item" }
  }
}

export async function deleteTask(
  taskId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const [task] = await db
      .select()
      .from(scheduleTasks)
      .where(eq(scheduleTasks.id, taskId))
      .limit(1)

    if (!task) return { success: false, error: "Schedule item not found" }

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, task.projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Access denied" }
    }

    await db.delete(scheduleTasks).where(eq(scheduleTasks.id, taskId))
    await recalcCriticalPath(db, task.projectId)
    revalidateSchedulePaths(task.projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to delete task:", error)
    return { success: false, error: "Failed to delete schedule item" }
  }
}

export async function completeScheduleTasks(
  projectId: string,
  taskIds: readonly string[]
): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    const orgId = requireOrg(user)
    const ids = [...new Set(taskIds.map((id) => id.trim()).filter(Boolean))]

    if (ids.length === 0) {
      return { success: false, error: "Select at least one schedule item" }
    }
    if (ids.length > 200) {
      return {
        success: false,
        error: "Update no more than 200 schedule items at a time",
      }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Project not found or access denied" }
    }

    const matchingTasks = await db
      .select({ id: scheduleTasks.id })
      .from(scheduleTasks)
      .where(
        and(
          eq(scheduleTasks.projectId, projectId),
          inArray(scheduleTasks.id, ids)
        )
      )

    if (matchingTasks.length !== ids.length) {
      return {
        success: false,
        error: "One or more schedule items could not be found",
      }
    }

    await db
      .update(scheduleTasks)
      .set({
        status: "COMPLETE",
        percentComplete: 100,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(scheduleTasks.projectId, projectId),
          inArray(scheduleTasks.id, ids)
        )
      )

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
): Promise<
  | { readonly success: true }
  | { readonly success: false; readonly error: string }
> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    const orgId = requireOrg(user)
    const ids = [...new Set(taskIds.map((id) => id.trim()).filter(Boolean))]

    if (ids.length === 0) {
      return { success: false, error: "Select at least one schedule item" }
    }
    if (ids.length > 200) {
      return {
        success: false,
        error: "Update no more than 200 schedule items at a time",
      }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Project not found or access denied" }
    }

    const matchingTasks = await db
      .select({ id: scheduleTasks.id })
      .from(scheduleTasks)
      .where(
        and(
          eq(scheduleTasks.projectId, projectId),
          inArray(scheduleTasks.id, ids)
        )
      )

    if (matchingTasks.length !== ids.length) {
      return {
        success: false,
        error: "One or more schedule items could not be found",
      }
    }

    await db
      .update(scheduleTasks)
      .set({
        assignedTo: assignedTo?.trim() || null,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(scheduleTasks.projectId, projectId),
          inArray(scheduleTasks.id, ids)
        )
      )

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
): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    const orgId = requireOrg(user)
    const ids = [...new Set(taskIds.map((id) => id.trim()).filter(Boolean))]

    if (ids.length === 0) {
      return { success: false, error: "Select at least one schedule item" }
    }
    if (ids.length > 200) {
      return {
        success: false,
        error: "Delete no more than 200 schedule items at a time",
      }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Project not found or access denied" }
    }

    const matchingTasks = await db
      .select({ id: scheduleTasks.id })
      .from(scheduleTasks)
      .where(
        and(
          eq(scheduleTasks.projectId, projectId),
          inArray(scheduleTasks.id, ids)
        )
      )

    if (matchingTasks.length !== ids.length) {
      return {
        success: false,
        error: "One or more schedule items could not be found",
      }
    }

    await db
      .delete(scheduleTasks)
      .where(
        and(
          eq(scheduleTasks.projectId, projectId),
          inArray(scheduleTasks.id, ids)
        )
      )

    await recalcCriticalPath(db, projectId)
    revalidateSchedulePaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to delete schedule items:", error)
    return { success: false, error: "Failed to delete schedule items" }
  }
}

export async function reorderTasks(
  projectId: string,
  items: { id: string; sortOrder: number }[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
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

    for (const item of items) {
      await db
        .update(scheduleTasks)
        .set({ sortOrder: item.sortOrder })
        .where(eq(scheduleTasks.id, item.id))
    }

    revalidateSchedulePaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to reorder tasks:", error)
    return { success: false, error: "Failed to reorder schedule items" }
  }
}

export async function createDependency(data: {
  predecessorId: string
  successorId: string
  type: DependencyType
  lagDays: number
  projectId: string
}): Promise<
  | { readonly success: true }
  | { readonly success: false; readonly error: string }
> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, data.projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Project not found or access denied" }
    }

    if (data.predecessorId === data.successorId) {
      return {
        success: false,
        error: "A schedule item cannot depend on itself",
      }
    }

    const [predecessor] = await db
      .select({ projectId: scheduleTasks.projectId })
      .from(scheduleTasks)
      .where(eq(scheduleTasks.id, data.predecessorId))
      .limit(1)
    const [successor] = await db
      .select({ projectId: scheduleTasks.projectId })
      .from(scheduleTasks)
      .where(eq(scheduleTasks.id, data.successorId))
      .limit(1)

    if (
      !predecessor ||
      !successor ||
      predecessor.projectId !== data.projectId ||
      successor.projectId !== data.projectId
    ) {
      return {
        success: false,
        error: "Both schedule items must belong to this project",
      }
    }

    const [duplicate] = await db
      .select({ id: taskDependencies.id })
      .from(taskDependencies)
      .where(
        and(
          eq(taskDependencies.predecessorId, data.predecessorId),
          eq(taskDependencies.successorId, data.successorId)
        )
      )
      .limit(1)

    if (duplicate) {
      return {
        success: false,
        error: "That dependency already exists",
      }
    }

    // get existing deps for cycle check
    const schedule = await getSchedule(data.projectId)

    if (wouldCreateCycle(schedule.dependencies, data.predecessorId, data.successorId)) {
      return { success: false, error: "This dependency would create a cycle" }
    }

    await db.insert(taskDependencies).values({
      id: crypto.randomUUID(),
      predecessorId: data.predecessorId,
      successorId: data.successorId,
      type: data.type,
      lagDays: data.lagDays,
    })

    // propagate dates from predecessor
    const updatedSchedule = await getSchedule(data.projectId)
    const { updatedTasks } = propagateDates(
      data.predecessorId,
      updatedSchedule.tasks,
      updatedSchedule.dependencies,
      updatedSchedule.exceptions
    )

    for (const [id, dates] of updatedTasks) {
      await db
        .update(scheduleTasks)
        .set({
          startDate: dates.startDate,
          endDateCalculated: dates.endDateCalculated,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(scheduleTasks.id, id))
    }

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
}): Promise<
  | { readonly success: true }
  | { readonly success: false; readonly error: string }
> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, data.projectId),
          eq(projects.organizationId, orgId)
        )
      )
      .limit(1)

    if (!project) {
      return { success: false, error: "Project not found or access denied" }
    }
    if (data.predecessorId === data.successorId) {
      return {
        success: false,
        error: "A schedule item cannot depend on itself",
      }
    }

    const schedule = await getSchedule(data.projectId)
    const taskIds = new Set(schedule.tasks.map((task) => task.id))
    const currentDependency = schedule.dependencies.find(
      (dependency) => dependency.id === data.dependencyId
    )

    if (!currentDependency) {
      return { success: false, error: "Dependency not found" }
    }
    if (
      !taskIds.has(data.predecessorId) ||
      !taskIds.has(data.successorId)
    ) {
      return {
        success: false,
        error: "Both schedule items must belong to this project",
      }
    }

    const otherDependencies = schedule.dependencies.filter(
      (dependency) => dependency.id !== data.dependencyId
    )
    if (
      otherDependencies.some(
        (dependency) =>
          dependency.predecessorId === data.predecessorId &&
          dependency.successorId === data.successorId
      )
    ) {
      return { success: false, error: "That dependency already exists" }
    }
    if (
      wouldDependencyUpdateCreateCycle(
        schedule.dependencies,
        data.dependencyId,
        data.predecessorId,
        data.successorId
      )
    ) {
      return { success: false, error: "This dependency would create a cycle" }
    }

    const updatedDependency = {
      id: data.dependencyId,
      predecessorId: data.predecessorId,
      successorId: data.successorId,
      type: data.type,
      lagDays: data.lagDays,
    }
    const recalculated = propagateDates(
      data.predecessorId,
      schedule.tasks,
      [...otherDependencies, updatedDependency],
      schedule.exceptions
    )
    const updatedAt = new Date().toISOString()
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        `UPDATE task_dependencies
         SET predecessor_id = ?, successor_id = ?, type = ?, lag_days = ?
         WHERE id = ?`
      ).bind(
        data.predecessorId,
        data.successorId,
        data.type,
        data.lagDays,
        data.dependencyId
      ),
    ]

    for (const [taskId, dates] of recalculated.updatedTasks) {
      statements.push(
        env.DB.prepare(
          `UPDATE schedule_tasks
           SET start_date = ?, end_date_calculated = ?, updated_at = ?
           WHERE id = ? AND project_id = ?`
        ).bind(
          dates.startDate,
          dates.endDateCalculated,
          updatedAt,
          taskId,
          data.projectId
        )
      )
    }

    const results = await env.DB.batch(statements)
    if (results.some((result) => !result.success)) {
      throw new Error("Dependency update batch failed")
    }

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
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
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

    const [dependency] = await db
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.id, depId))
      .limit(1)

    if (!dependency) {
      return { success: false, error: "Dependency not found" }
    }

    const taskIds = new Set(
      (
        await db
          .select({ id: scheduleTasks.id })
          .from(scheduleTasks)
          .where(eq(scheduleTasks.projectId, projectId))
      ).map((task) => task.id)
    )
    if (
      !taskIds.has(dependency.predecessorId) ||
      !taskIds.has(dependency.successorId)
    ) {
      return {
        success: false,
        error: "Dependency does not belong to this project",
      }
    }

    await db.delete(taskDependencies).where(eq(taskDependencies.id, depId))
    await recalcCriticalPath(db, projectId)
    revalidateSchedulePaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to delete dependency:", error)
    return { success: false, error: "Failed to delete dependency" }
  }
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const [task] = await db
      .select()
      .from(scheduleTasks)
      .where(eq(scheduleTasks.id, taskId))
      .limit(1)

    if (!task) return { success: false, error: "Schedule item not found" }

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, task.projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Access denied" }
    }

    await db
      .update(scheduleTasks)
      .set({
        status,
        percentComplete: effectivePercentComplete(status, task.percentComplete),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(scheduleTasks.id, taskId))

    revalidateSchedulePaths(task.projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to update task status:", error)
    return { success: false, error: "Failed to update status" }
  }
}

// recalculates critical path and updates all tasks
async function recalcCriticalPath(
  db: ReturnType<typeof getDb>,
  projectId: string
) {
  const tasks = await db
    .select()
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))

  const deps = await db.select().from(taskDependencies)
  const taskIds = new Set(tasks.map((t) => t.id))
  const projectDeps = deps.filter(
    (d) => taskIds.has(d.predecessorId) && taskIds.has(d.successorId)
  )

  const criticalSet = findCriticalPath(
    tasks.map((t) => ({ ...t, status: t.status as TaskStatus })),
    projectDeps.map((d) => ({ ...d, type: d.type as DependencyType }))
  )

  for (const task of tasks) {
    const isCritical = criticalSet.has(task.id)
    if (task.isCriticalPath !== isCritical) {
      await db
        .update(scheduleTasks)
        .set({ isCriticalPath: isCritical })
        .where(eq(scheduleTasks.id, task.id))
    }
  }
}
