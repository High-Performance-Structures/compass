import type { AuthUser } from "@/lib/auth"
import { isInternalStaffRole } from "@/lib/user-roles"

export function requireInternalNuTechStaff(user: AuthUser): void {
  if (
    !user.isActive ||
    user.organizationId === null ||
    user.organizationType !== "internal" ||
    !isInternalStaffRole(user.role)
  ) {
    throw new Error("NU_TECH_INTERNAL_STAFF_ONLY")
  }
}
