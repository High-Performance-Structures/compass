import type { AuthUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"

/**
 * Whether this person can open a project's Plans & Documents page. It matches
 * the page's own check (internal staff with document read access); the page
 * still checks access to each project when it opens.
 */
export function canOpenProjectFiles(user: AuthUser | null): boolean {
  return user !== null && isInternalStaffRole(user.role) && can(user, "document", "read")
}
