"use server"

import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import {
  scheduleTasks,
  taskDependencies,
  workdayExceptions,
  projects,
} from "@/db/schema"
import { eq, asc, and } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { calculateEndDate } from "@/lib/schedule/business-days"
import { findCriticalPath } from "@/lib/schedule/critical-path"
import { wouldCreateCycle } from "@/lib/schedule/dependency-validation"
import { propagateDates } from "@/lib/schedule/propagate-dates"
import { requireAuth } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"
import type {
  TaskStatus,
  DependencyType,
  ExceptionCategory,
  ExceptionRecurrence,
  ScheduleData,
  WorkdayExceptionData,
} from "@/lib/schedule/types"

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
    tasks: tasks.map((t) => ({
      ...t,
      status: t.status as TaskStatus,
      phase: t.phase,
    })),
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
    await db.insert(scheduleTasks).values({
      id,
      projectId,
      title: data.title,
      startDate: data.startDate,
      workdays: data.workdays,
      endDateCalculated: endDate,
      phase: data.phase,
      displayColor: data.displayColor ?? "blue",
      status: data.status ?? "PENDING",
      isCriticalPath: false,
      isMilestone: data.isMilestone ?? false,
      percentComplete: data.percentComplete ?? 0,
      assignedTo: data.assignedTo ?? null,
      sortOrder: nextOrder,
      createdAt: now,
      updatedAt: now,
    })

    await recalcCriticalPath(db, projectId)
    revalidatePath(`/dashboard/projects/${projectId}/schedule`)
    return { success: true }
  } catch (error) {
    console.error("Failed to create task:", error)
    return { success: false, error: "Failed to create task" }
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

    if (!task) return { success: false, error: "Task not found" }

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

    await db
      .update(scheduleTasks)
      .set({
        ...(data.title && { title: data.title }),
        startDate,
        workdays,
        endDateCalculated: endDate,
        ...(data.phase && { phase: data.phase }),
        ...(data.displayColor && { displayColor: data.displayColor }),
        ...(data.status && { status: data.status }),
        ...(data.isMilestone !== undefined && {
          isMilestone: data.isMilestone,
        }),
        ...(data.percentComplete !== undefined && {
          percentComplete: data.percentComplete,
        }),
        ...(data.assignedTo !== undefined && {
          assignedTo: data.assignedTo,
        }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(scheduleTasks.id, taskId))

    // propagate date changes to downstream tasks
    const schedule = await getSchedule(task.projectId)
    const updatedTask = {
      ...task,
      status: task.status as TaskStatus,
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
    revalidatePath(`/dashboard/projects/${task.projectId}/schedule`)
    return { success: true }
  } catch (error) {
    console.error("Failed to update task:", error)
    return { success: false, error: "Failed to update task" }
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

    if (!task) return { success: false, error: "Task not found" }

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
    revalidatePath(`/dashboard/projects/${task.projectId}/schedule`)
    return { success: true }
  } catch (error) {
    console.error("Failed to delete task:", error)
    return { success: false, error: "Failed to delete task" }
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

    revalidatePath(`/dashboard/projects/${projectId}/schedule`)
    return { success: true }
  } catch (error) {
    console.error("Failed to reorder tasks:", error)
    return { success: false, error: "Failed to reorder tasks" }
  }
}

export async function createDependency(data: {
  predecessorId: string
  successorId: string
  type: DependencyType
  lagDays: number
  projectId: string
}): Promise<{ success: boolean; error?: string }> {
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
    revalidatePath(`/dashboard/projects/${data.projectId}/schedule`)
    return { success: true }
  } catch (error) {
    console.error("Failed to create dependency:", error)
    return { success: false, error: "Failed to create dependency" }
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

    await db.delete(taskDependencies).where(eq(taskDependencies.id, depId))
    await recalcCriticalPath(db, projectId)
    revalidatePath(`/dashboard/projects/${projectId}/schedule`)
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

    if (!task) return { success: false, error: "Task not found" }

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
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(scheduleTasks.id, taskId))

    revalidatePath(`/dashboard/projects/${task.projectId}/schedule`)
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
