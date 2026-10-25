import { isInternalStaffRole } from "@/lib/user-roles"

export function canViewOwnerUpdateDrafts(
  role: string,
  organizationType: string | null = "internal"
): boolean {
  return organizationType === "internal" && isInternalStaffRole(role)
}

export function isOwnerUpdateVisibleToRole(
  status: string,
  role: string,
  organizationType: string | null = "internal"
): boolean {
  if (canViewOwnerUpdateDrafts(role, organizationType)) return true

  return status === "published" || status === "sent"
}

export function ownerUpdateVisibleStatuses(
  role: string,
  organizationType: string | null = "internal"
): readonly ["published", "sent"] | null {
  return canViewOwnerUpdateDrafts(role, organizationType)
    ? null
    : ["published", "sent"]
}
