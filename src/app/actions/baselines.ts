"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import {
  scheduleBaselines,
  scheduleTasks,
  taskDependencies,
  projects,
} from "@/db/schema"
import { eq, asc, and } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireAuth } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"
import type { ScheduleBaselineData } from "@/lib/schedule/types"

export async function getBaselines(
  projectId: string
): Promise<ScheduleBaselineData[]> {
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

    const tasks = await db
      .select()
      .from(scheduleTasks)
      .where(eq(scheduleTasks.projectId, projectId))
      .orderBy(asc(scheduleTasks.sortOrder))

    const deps = await db.select().from(taskDependencies)
    const taskIds = new Set(tasks.map((t) => t.id))
    const projectDeps = deps.filter(
      (d) => taskIds.has(d.predecessorId) && taskIds.has(d.successorId)
    )

    const snapshot = JSON.stringify({ tasks, dependencies: projectDeps })

    await db.insert(scheduleBaselines).values({
      id: crypto.randomUUID(),
      projectId,
      name,
      snapshotData: snapshot,
      createdAt: new Date().toISOString(),
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
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const [existing] = await db
      .select()
      .from(scheduleBaselines)
      .where(eq(scheduleBaselines.id, baselineId))
      .limit(1)

    if (!existing) return { success: false, error: "Baseline not found" }

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
      .delete(scheduleBaselines)
      .where(eq(scheduleBaselines.id, baselineId))

    revalidatePath(
      `/dashboard/projects/${existing.projectId}/schedule`
    )
    return { success: true }
  } catch (error) {
    console.error("Failed to delete baseline:", error)
    return { success: false, error: "Failed to delete baseline" }
  }
}
