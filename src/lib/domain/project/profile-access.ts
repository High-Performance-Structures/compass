/**
 * Who may read or change a project's Information page: internal staff with
 * the project-hub permission whose project access record
 * (`getProjectAccessRecord`) is in their own active organization. This rule
 * is narrower than either shared project scope ("member" admits outside
 * members, "organization" ignores staff project scope), so it keeps its own
 * check on top of the shared org context.
 */
import type { AuthUser } from "@/lib/auth"
import { getProjectAccessRecord } from "@/lib/project-access"
import { CONTEXT_ERRORS, orgContext, type Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

type ProjectProfileContext = {
  readonly db: Db
  readonly organizationId: string
  readonly user: AuthUser
  readonly env: CloudflareEnv
}

/** The org context or a thrown error, with the messages this page has always used. */
async function staffOrgContext(
  feature: { readonly feature: string; readonly action: "read" | "update" } | null,
): Promise<ProjectProfileContext> {
  const context = await orgContext(feature ?? {})
  if (!context.success) {
    throw new Error(context.error === CONTEXT_ERRORS.noDatabase ? "Database unavailable" : context.error)
  }
  return context.data
}

export async function projectProfileContext(
  projectId: string,
  action: "read" | "update",
): Promise<ProjectProfileContext> {
  const context = await staffOrgContext({ feature: "project-hub", action })
  if (!isInternalStaffRole(context.user.role)) {
    throw new Error("Project information is available to internal staff only.")
  }
  const access = await getProjectAccessRecord(context.db, context.user, projectId)
  if (!access || access.organizationId !== context.organizationId) {
    throw new Error("Project not found or access denied.")
  }
  return context
}

/** Signed-in user's organization, with no feature check (callers apply their own rule). */
export async function profileOrgContext(): Promise<ProjectProfileContext> {
  return staffOrgContext(null)
}
