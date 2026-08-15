import { isInternalStaffRole } from "@/lib/user-roles"

export function canUseProjectDailyLogWorkspace(role: string): boolean {
  return isInternalStaffRole(role)
}
