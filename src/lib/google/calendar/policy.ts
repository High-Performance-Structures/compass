import { isDemoUser } from "@/lib/demo"
import { isInternalStaffRole } from "@/lib/user-roles"

export function canConnectGoogleCalendar(input: {
  readonly userId: string
  readonly role: string
}): boolean {
  return (
    !isDemoUser(input.userId) &&
    (isInternalStaffRole(input.role) || input.role === "developer")
  )
}

export function canManageOrganizationCalendars(role: string): boolean {
  return (
    role === "admin" ||
    role === "secondary_admin" ||
    role === "developer"
  )
}

export function canWriteGoogleCalendar(accessRole: string): boolean {
  return accessRole === "owner" || accessRole === "writer"
}
