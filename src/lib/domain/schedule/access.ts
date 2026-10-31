/**
 * Who may read or change a working schedule, built on the shared action
 * context. Schedule permissions are the role-based `schedule` resource
 * (requirePermission), not a feature override, so the context is asked only
 * for the user, organization, database, and the demo read-only rule.
 */
import type { ActionFailure } from "@/lib/action-result"
import { requireAuth } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { loadProjectListForRequest, type ProjectListItem } from "@/lib/projects/project-list"
import { scheduleProjectSwitcherProjects } from "@/lib/schedule/project-scope"
import type { ScheduleData } from "@/lib/schedule/types"
import { CONTEXT_ERRORS, orgContext, type OrgContext } from "@/lib/server/action-context"
import { canUseOrganizationProjectScopeRole, isInternalStaffRole } from "@/lib/user-roles"

import { isOrganizationProject, loadWorkingSchedule } from "./queries"

/** Staff and developers see working (unpublished) schedule rows. */
export function canViewWorkingSchedule(role: string): boolean {
  return isInternalStaffRole(role) || role === "developer"
}

/**
 * The context for a schedule read. Failures throw with the context's message
 * ("Unauthorized", "No active organization", …), as the reads always have.
 */
export async function scheduleReadContext(): Promise<OrgContext> {
  const context = await orgContext()
  if (!context.success) throw new Error(context.error)
  requirePermission(context.data.user, "schedule", "read")
  return context.data
}

/**
 * The context for a schedule change. The demo account gets DEMO_READ_ONLY
 * back as a result; any other failure (including a missing schedule.update
 * permission) throws, so each action's own catch block keeps reporting the
 * message it always has.
 */
export async function scheduleWriteContext(): Promise<
  { readonly success: true; readonly data: OrgContext } | ActionFailure
> {
  const context = await orgContext({ mutation: true })
  if (!context.success) {
    if (context.error === CONTEXT_ERRORS.demoReadOnly) return context
    throw new Error(context.error)
  }
  requirePermission(context.data.user, "schedule", "update")
  return context
}

/** The projects the viewer can open (the same list as the project switcher's `getProjects`). */
export async function viewerProjects(): Promise<ProjectListItem[]> {
  try {
    const user = await requireAuth()
    requirePermission(user, "project", "read")
    return await loadProjectListForRequest(
      user.id,
      user.organizationId ?? null,
      user.organizationType === "internal" && canUseOrganizationProjectScopeRole(user.role)
    )
  } catch {
    return []
  }
}

export async function scheduleSwitcherProjects(currentProjectId: string): Promise<ProjectListItem[]> {
  return scheduleProjectSwitcherProjects(await viewerProjects(), currentProjectId)
}

const NO_ACCESS = "Project not found or access denied"

/**
 * The editable working schedule of one project. External viewers get an
 * empty schedule (they use the published audience workspace); a project the
 * viewer cannot open throws.
 */
export async function readWorkingSchedule(context: OrgContext, projectId: string): Promise<ScheduleData> {
  requirePermission(context.user, "schedule", "read")
  if (!canViewWorkingSchedule(context.user.role)) {
    return { tasks: [], dependencies: [], exceptions: [] }
  }
  // Project routes may intentionally open completed or inactive historical
  // schedules. Portfolio status filtering is navigation policy, not access
  // control, so retain the current route when checking the accessible list.
  const accessible = await scheduleSwitcherProjects(projectId)
  if (!accessible.some((project) => project.id === projectId)) throw new Error(NO_ACCESS)
  if (!(await isOrganizationProject(context.db, context.organizationId, projectId))) {
    throw new Error(NO_ACCESS)
  }
  return loadWorkingSchedule(context.db, projectId)
}
