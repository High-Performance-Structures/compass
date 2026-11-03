/**
 * Who may manage project families: staff with project update permission who
 * can also manage the project registry (admins). Built on the shared action
 * context for the user, organization and database.
 */
import type { AuthUser } from "@/lib/auth"
import { requireAuth } from "@/lib/auth"
import { canManageProjectRegistry, requirePermission } from "@/lib/permissions"
import { CONTEXT_ERRORS, orgContext, type Db } from "@/lib/server/action-context"

export type FamilyAdminContext = {
  readonly db: Db
  readonly user: AuthUser
  readonly organizationId: string
  readonly environment: CloudflareEnv
}

/**
 * Throws the same messages the family actions always returned: Unauthorized,
 * the role permission message, the admin-only message, then the organization
 * and database checks from the shared context.
 */
export async function requireFamilyAdminContext(): Promise<FamilyAdminContext> {
  const user = await requireAuth()
  requirePermission(user, "project", "update")
  if (!canManageProjectRegistry(user)) {
    throw new Error("Permission denied: project family management is admin-only")
  }
  const context = await orgContext()
  if (!context.success) {
    // The family actions have always said "D1 not available" for a missing binding.
    throw new Error(context.error === CONTEXT_ERRORS.noDatabase ? "D1 not available" : context.error)
  }
  const { db, organizationId, env } = context.data
  return { db, user, organizationId, environment: env }
}
