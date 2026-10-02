import { isInternalStaffRole } from "@/lib/user-roles"

export const TEAM_ACCESS_SECTIONS = ["internal", "vendors", "clients", "other"] as const
export type TeamAccessSection = (typeof TEAM_ACCESS_SECTIONS)[number]

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
