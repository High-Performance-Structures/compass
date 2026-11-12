import type { GoogleCalendarAclRole } from "@/lib/google/calendar/client"
import { canManageUserAccessRole, isDeveloperRole, isInternalStaffRole } from "@/lib/user-roles"

const FIELD_ONLY_ROLES = new Set(["field", "field_superintendent", "field_crew"])

export function canEnableGoogleProjectCalendar(role: string): boolean {
  return isDeveloperRole(role) || (
    isInternalStaffRole(role) && !FIELD_ONLY_ROLES.has(role)
  )
}

export function canDeleteGoogleProjectCalendar(role: string): boolean {
  return canManageUserAccessRole(role) || isDeveloperRole(role)
}

export function googleProjectCalendarAclRole(role: string): GoogleCalendarAclRole {
  return canEnableGoogleProjectCalendar(role)
    ? "writerWithoutPrivateAccess"
    : "reader"
}
