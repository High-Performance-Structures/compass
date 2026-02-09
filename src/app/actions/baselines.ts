"use server"

import { getDb } from "@/lib/db-universal"
import {
  scheduleBaselines,
  scheduleTasks,
  taskDependencies,
} from "@/db/schema"
import { eq, asc } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import type { ScheduleBaselineData } from "@/lib/schedule/types"

export async function getBaselines(
  projectId: string
): Promise<ScheduleBaselineData[]> {
  const db = await getDb()

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
    const db = await getDb()

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
    const db = await getDb()

    const [existing] = await db
      .select()
      .from(scheduleBaselines)
      .where(eq(scheduleBaselines.id, baselineId))
      .limit(1)

    if (!existing) return { success: false, error: "Baseline not found" }

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
