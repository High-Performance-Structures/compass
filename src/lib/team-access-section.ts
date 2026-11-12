import { isInternalStaffRole, isOwnerRole, isVendorRole } from "@/lib/user-roles"
export type TeamAccessSection =
  | "internal"
  | "vendors"
  | "clients"
  | "other"

export function teamAccessSectionForRole(role: string): TeamAccessSection {
  if (isInternalStaffRole(role)) return "internal"
  if (isVendorRole(role) || role === "vendor") return "vendors"
  if (isOwnerRole(role)) return "clients"
  // Guest and developer accounts have no reliable company relationship here.
  return "other"
}

export function parseTeamAccessSection(value: string | null): TeamAccessSection {
  if (value === "vendors" || value === "clients" || value === "other") return value
  return "internal"
}
