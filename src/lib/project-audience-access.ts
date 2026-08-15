export type ProjectAudience = "owner" | "sub_vendor"

export function canUseProjectAudience(
  projectRole: string | null,
  audience: ProjectAudience
): boolean {
  if (audience === "owner") {
    return projectRole === "client" || projectRole === "owner"
  }
  return projectRole === "subcontractor" || projectRole === "supplier"
}

export function canUseActiveProjectAudience(
  projectRole: string | null,
  audience: ProjectAudience,
  userIsActive: boolean
): boolean {
  return userIsActive && canUseProjectAudience(projectRole, audience)
}
