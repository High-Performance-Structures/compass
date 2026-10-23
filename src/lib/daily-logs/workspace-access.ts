import { isInternalStaffRole } from "@/lib/user-roles"

export function canUseProjectDailyLogWorkspace(input: {
  readonly role: string
  readonly isActive: boolean
  readonly organizationType: string | null
}): boolean {
  return (
    input.isActive &&
    input.organizationType === "internal" &&
    isInternalStaffRole(input.role)
  )
}
