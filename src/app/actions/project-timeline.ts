"use server"

import { and, eq } from "drizzle-orm"

import { projects } from "@/db/schema"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import type { ProjectTimeline } from "@/lib/project-timeline/model"
import { loadProjectTimeline } from "@/lib/project-timeline/server"
import { isInternalStaffRole } from "@/lib/user-roles"
import { requireUserContext } from "@/lib/server/action-context"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

/**
 * A job's timeline for its Overview: staff only, since it includes office
 * time and to-dos that aren't shared with clients. `to` (YYYY-MM-DD) loads
 * an earlier stretch.
 */
export async function getProjectTimeline(projectId: string, to?: string): Promise<Result<ProjectTimeline>> {
  try {
    const { user, db } = await requireUserContext()
    if (!isInternalStaffRole(user.role) && user.role !== "developer") {
      return { success: false, error: "The project timeline is for staff." }
    }
    await requireFeaturePermission(user, "project-hub", "read")
    const organizationId = requireOrg(user)
    if (to !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(to)) return { success: false, error: "Choose a valid date." }
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
      .limit(1)
    if (!project) return { success: false, error: "Project not found." }
    return { success: true, data: await loadProjectTimeline(db, { organizationId, projectId, ...(to ? { to } : {}) }) }
  } catch (error) {
    console.error("Unable to load the project timeline", error)
    return { success: false, error: "Unable to load the project timeline." }
  }
}
