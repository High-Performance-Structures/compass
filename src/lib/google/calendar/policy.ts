import { isDemoUser } from "@/lib/demo"
import { canManageUserAccessRole, isDeveloperRole, seesStaffViews } from "@/lib/user-roles"

export function canConnectGoogleCalendar(input: {
  readonly userId: string
  readonly role: string
}): boolean {
  return (
    !isDemoUser(input.userId) &&
    seesStaffViews(input.role)
  )
}

export function canManageOrganizationCalendars(role: string): boolean {
  return canManageUserAccessRole(role) || isDeveloperRole(role)
}

export function canWriteGoogleCalendar(accessRole: string): boolean {
  return accessRole === "owner" || accessRole === "writer"
}
