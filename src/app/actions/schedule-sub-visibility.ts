"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { projects } from "@/db/schema"
import { recordActivityEvent } from "@/lib/activity-log"
import { scheduleReadContext, scheduleWriteContext, viewerProjects } from "@/lib/domain/schedule/access"
import { schedulePaths } from "@/lib/domain/schedule/rules"
import { updateProjects } from "@/lib/domain/project/store"
import { isSubScheduleView, type SubScheduleView } from "@/lib/project-audience-schedule-visibility"
import { isInternalStaffRole } from "@/lib/user-roles"

export async function getSubScheduleView(projectId: string): Promise<SubScheduleView> {
  const { db, organizationId } = await scheduleReadContext()
  if (!(await viewerProjects()).some((project) => project.id === projectId)) return "assigned"
  const project = await db
    .select({ subScheduleView: projects.subScheduleView })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .get()
  return project && isSubScheduleView(project.subScheduleView) ? project.subScheduleView : "assigned"
}

/**
 * Whether a job's subs and suppliers see its whole published schedule or only
 * the items marked "Subs can view" plus the items they're responsible for.
 */
export async function updateSubScheduleView(
  projectId: string,
  subScheduleView: string
): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  try {
    const context = await scheduleWriteContext()
    if (!context.success) return context
    const { db, organizationId, user } = context.data
    if (!isInternalStaffRole(user.role)) {
      return { success: false, error: "Only internal project staff can change what subs see of the schedule." }
    }
    if (!isSubScheduleView(subScheduleView)) {
      return { success: false, error: "Unsupported sub schedule view." }
    }
    const existing = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
      .get()
    if (!existing) return { success: false, error: "Project not found or access denied" }

    await updateProjects(db, eq(projects.id, projectId), { subScheduleView, updatedAt: new Date().toISOString() })
    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "schedule",
      action: "schedule.sub_visibility_changed",
      entityType: "project_schedule",
      entityId: projectId,
      summary:
        subScheduleView === "full"
          ? "Subs and suppliers now see the full published schedule."
          : "Subs and suppliers now see their own items and items marked for subs.",
    })
    for (const path of [...schedulePaths(projectId), `/preview/projects/${projectId}/sub-vendor`, `/preview/projects/${projectId}/sub-vendor/schedule`]) {
      revalidatePath(path)
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to update what subs see." }
  }
}
