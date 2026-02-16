"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import { workdayExceptions, projects } from "@/db/schema"
import { eq, and } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireAuth } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"
import type {
  WorkdayExceptionData,
  ExceptionCategory,
  ExceptionRecurrence,
} from "@/lib/schedule/types"

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
    type: string
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
    type?: string
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

    revalidatePath(
      `/dashboard/projects/${existing.projectId}/schedule`
    )
    return { success: true }
  } catch (error) {
    console.error("Failed to delete workday exception:", error)
    return { success: false, error: "Failed to delete exception" }
  }
}
