"use server"

import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { projects, scheduleTasks } from "@/db/schema"
import { createProjectTask } from "@/app/actions/project-operations"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isInternalStaffRole } from "@/lib/user-roles"
import { projectSiteWeather, type ProjectSiteWeather } from "@/lib/weather/schedule-risk-server"

type SiteWeatherResult =
  | { readonly success: true; readonly data: ProjectSiteWeather }
  | { readonly success: false; readonly error: string }

/** The job overview's weather card: site forecast, scheduled work at risk, hazards nearby. */
export async function getProjectSiteWeather(projectId: string): Promise<SiteWeatherResult> {
  try {
    const user = await getCurrentUser()
    if (!user?.organizationId || !isInternalStaffRole(user.role)) return { success: false, error: "Weather is available to staff." }
    const { env, ctx } = await getCloudflareContext()
    if (!env?.DB) return { success: false, error: "Weather could not be loaded." }
    const db = getDb(env.DB)
    const { data, markInUse } = await projectSiteWeather(db, user.organizationId, projectId, Date.now())
    ctx.waitUntil(markInUse().catch(() => undefined))
    return { success: true, data }
  } catch (error) {
    console.error("Project site weather failed", error)
    return { success: false, error: "Weather could not be loaded." }
  }
}

/** Makes a to-do linked to the at-risk schedule item, due the day the weather turns. */
export async function createWeatherRiskTodo(
  projectId: string,
  input: { readonly taskId: string; readonly detail: string; readonly dueDate: string },
): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  try {
    const user = await getCurrentUser()
    if (!user?.organizationId || !isInternalStaffRole(user.role)) return { success: false, error: "Only staff can make to-dos here." }
    const { env } = await getCloudflareContext()
    if (!env?.DB) return { success: false, error: "The to-do could not be made." }
    const db = getDb(env.DB)
    const task = await db
      .select({ id: scheduleTasks.id, title: scheduleTasks.title })
      .from(scheduleTasks)
      .innerJoin(projects, eq(projects.id, scheduleTasks.projectId))
      .where(and(eq(scheduleTasks.id, input.taskId), eq(scheduleTasks.projectId, projectId), eq(projects.organizationId, user.organizationId)))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!task) return { success: false, error: "That schedule item was not found." }
    const result = await createProjectTask(projectId, {
      title: `Weather: ${task.title}`,
      description: input.detail.slice(0, 1000),
      sourceRecordType: "staff_task",
      sourceRecordId: task.id,
      sourceRecordNumber: null,
      assigneeName: null,
      companyName: null,
      startDate: null,
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ? input.dueDate : null,
      priority: "high",
      externalUrl: null,
    })
    return result.success ? { success: true } : { success: false, error: result.error }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "The to-do could not be made." }
  }
}
