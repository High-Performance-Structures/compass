import type { AuthUser } from "./auth"

export function requireOrg(user: AuthUser): string {
  if (!user.organizationId) {
    throw new Error("No active organization")
  }
  return user.organizationId
}
