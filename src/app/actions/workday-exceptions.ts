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
  projectId: string
): Promise<void> {
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
  const exceptions = await db
    .select()
    .from(workdayExceptions)
    .where(eq(workdayExceptions.projectId, projectId))

  const { updatedTasks } = recalculateScheduleDates(
    tasks.map((task) => ({
      ...task,
      status: task.status as TaskStatus,
    })),
    dependencies.map((dependency) => ({
      ...dependency,
      type: dependency.type as DependencyType,
    })),
    exceptions.map((exception) => ({
      ...exception,
      type: exception.type as WorkdayExceptionType,
      category: exception.category as ExceptionCategory,
      recurrence: exception.recurrence as ExceptionRecurrence,
    }))
  )

  const updatedAt = new Date().toISOString()
  for (const [taskId, dates] of updatedTasks) {
    await db
      .update(scheduleTasks)
      .set({ ...dates, updatedAt })
      .where(eq(scheduleTasks.id, taskId))
  }
}

export async function getWorkdayExceptions(
  projectId: string
): Promise<WorkdayExceptionData[]> {
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

    await db.insert(workdayExceptions).values({
      id: crypto.randomUUID(),
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
    })

    await recalculateProjectDates(db, projectId)
    revalidatePath(`/dashboard/projects/${projectId}/schedule`)
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

    await db
      .update(workdayExceptions)
      .set({
        ...(data.title && { title: data.title }),
        ...(data.startDate && { startDate: data.startDate }),
        ...(data.endDate && { endDate: data.endDate }),
        ...(data.type && { type: data.type }),
        ...(data.category && { category: data.category }),
        ...(data.recurrence && { recurrence: data.recurrence }),
        ...(data.notes !== undefined && { notes: data.notes }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(workdayExceptions.id, exceptionId))

    await recalculateProjectDates(db, existing.projectId)
    revalidatePath(
      `/dashboard/projects/${existing.projectId}/schedule`
    )
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

    await db
      .delete(workdayExceptions)
      .where(eq(workdayExceptions.id, exceptionId))

    await recalculateProjectDates(db, existing.projectId)
    revalidatePath(
      `/dashboard/projects/${existing.projectId}/schedule`
    )
    return { success: true }
  } catch (error) {
    console.error("Failed to delete workday exception:", error)
    return { success: false, error: "Failed to delete exception" }
  }
}
