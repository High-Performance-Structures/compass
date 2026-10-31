import { isInternalStaffRole } from "@/lib/user-roles"
export type TeamAccessSection =
  | "internal"
  | "vendors"
  | "clients"
  | "other"

export function teamAccessSectionForRole(role: string): TeamAccessSection {
  if (isInternalStaffRole(role)) return "internal"
  if (role === "subcontractor" || role === "supplier" || role === "vendor") return "vendors"
  if (role === "client" || role === "owner") return "clients"
  // Guest and developer accounts have no reliable company relationship here.
  return "other"
}

export function parseTeamAccessSection(value: string | null): TeamAccessSection {
  if (value === "vendors" || value === "clients" || value === "other") return value
  return "internal"
}
