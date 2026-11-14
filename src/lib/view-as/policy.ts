/*
 * Who may use View as. Pure: the caller supplies the signed-in person, the
 * company's "view-as" setting and the developer mode cookie. Rechecked on
 * every View as request (session.ts), not only when viewing starts.
 *
 * - Admins (the people who can turn on developer mode) by default.
 * - A company may switch it off for everyone, or list extra staff.
 * - A listed person must still be active company staff: owners, vendors,
 *   guests and demo accounts never qualify, whatever the list says.
 * - Developer mode must be on.
 */
import type { AuthUser } from "@/lib/auth"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import type { ViewAsSettings } from "@/lib/feature-settings/view-as-settings"
import { canManageProjectRegistry } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"

/** Listed by the company as allowed, and still active staff of an internal company. */
function isListedStaff(user: AuthUser, settings: ViewAsSettings): boolean {
  if (!settings.extraStaffUserIds.includes(user.id)) return false
  if (user.organizationType !== "internal" || !user.organizationId) return false
  if (isDemoUser(user.id) || isDemoOrg(user.organizationId)) return false
  return isInternalStaffRole(user.role)
}

/** May this person use View as once developer mode is on? */
export function isViewAsEligible(user: AuthUser | null, settings: ViewAsSettings): boolean {
  if (!user || !user.isActive || !settings.enabled) return false
  return canManageProjectRegistry(user) || isListedStaff(user, settings)
}

/**
 * Developer mode stays with admins; staff a company lists for View as get
 * the switch too, because View as only works with developer mode on.
 */
export function canUseDeveloperModeWith(user: AuthUser | null, settings: ViewAsSettings): boolean {
  return canManageProjectRegistry(user) || isViewAsEligible(user, settings)
}

export type ViewAsPermission =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string }

/** The full check for starting or continuing a View as session. */
export function viewAsPermission(input: {
  readonly user: AuthUser | null
  readonly settings: ViewAsSettings
  readonly developerModeEnabled: boolean
}): ViewAsPermission {
  if (!input.user) return { allowed: false, reason: "Sign in to use View as." }
  if (!input.settings.enabled) return { allowed: false, reason: "View as is turned off for this company." }
  if (!isViewAsEligible(input.user, input.settings)) return { allowed: false, reason: "View as is for admins." }
  if (!input.developerModeEnabled) return { allowed: false, reason: "Turn on developer mode to use View as." }
  return { allowed: true }
}
