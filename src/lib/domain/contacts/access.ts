import { requireAuth } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"
import { projectContext, type ProjectContext } from "@/lib/server/action-context"

/**
 * The project rule contacts actions have always used: the role's "project"
 * permission (read or update), then a project in the user's own
 * organization. It is checked in that order so the first failure reports
 * the same message as before ("Permission denied: …", then
 * "No active organization", then "Project not found"). Failures throw, as
 * the contacts actions expect.
 */
export async function contactsProjectContext(
  projectId: string,
  action: "read" | "update" = "read"
): Promise<ProjectContext> {
  const user = await requireAuth()
  requirePermission(user, "project", action)
  requireOrg(user)
  const context = await projectContext(projectId, { scope: "organization" })
  if (!context.success) throw new Error(context.error)
  return context.data
}
