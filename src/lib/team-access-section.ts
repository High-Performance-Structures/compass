import { isInternalStaffRole, isOwnerRole, isVendorRole } from "@/lib/user-roles"
export type TeamAccessSection =
  | "internal"
  | "vendors"
  | "clients"
  | "development"
  | "other"

export function teamAccessSectionForRole(role: string): TeamAccessSection {
  if (isInternalStaffRole(role)) return "internal"
  if (isVendorRole(role) || role === "vendor") return "vendors"
  if (isOwnerRole(role)) return "clients"
  // Guest and developer accounts have no reliable company relationship here.
  return "other"
}

/**
 * The Settings → Team group an account is listed in. A development account
 * (someone who builds Compass, tagged by an admin) is grouped on its own
 * whatever its role, so it is not counted as staff, a vendor or a client.
 */
export function teamAccessSectionForUser(user: { readonly role: string; readonly developmentAccount: boolean }): TeamAccessSection {
  return user.developmentAccount ? "development" : teamAccessSectionForRole(user.role)
}

export function parseTeamAccessSection(value: string | null): TeamAccessSection {
  if (value === "vendors" || value === "clients" || value === "development" || value === "other") return value
  return "internal"
}
