import type { AuthUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"

/** Office staff of the company with finance access: who may send records to Sage. */
export function canSendToSage(user: AuthUser): boolean {
  return user.organizationType === "internal" && isInternalStaffRole(user.role) && can(user, "finance", "update")
}
