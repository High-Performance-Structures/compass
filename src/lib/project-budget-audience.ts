import { isInternalStaffRole } from "@/lib/user-roles"

export type ProjectBudgetAudience = "internal" | "owner"

export function effectiveProjectBudgetAudience(
  requestedAudience: ProjectBudgetAudience,
  viewerRole: string
): ProjectBudgetAudience {
  return isInternalStaffRole(viewerRole) ? requestedAudience : "owner"
}
