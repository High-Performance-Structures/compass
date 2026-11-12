import { isOwnerRole, isVendorRole } from "@/lib/user-roles"

export type ProjectAudience = "owner" | "sub_vendor"

export function canUseProjectAudience(
  projectRole: string | null,
  audience: ProjectAudience
): boolean {
  return audience === "owner" ? isOwnerRole(projectRole) : isVendorRole(projectRole)
}
