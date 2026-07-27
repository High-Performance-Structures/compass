import { isInternalStaffRole } from "@/lib/user-roles"

export function canViewOwnerUpdateDrafts(role: string): boolean {
  return isInternalStaffRole(role)
}

export function isOwnerUpdateVisibleToRole(
  status: string,
  role: string
): boolean {
  if (canViewOwnerUpdateDrafts(role)) return true

  return status === "published" || status === "sent"
}
