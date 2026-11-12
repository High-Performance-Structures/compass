import type { UserRole } from "@/lib/domain/identity/statuses"

export type { UserRole }

export type UserRoleOption = {
  readonly value: UserRole
  readonly label: string
  readonly group: "Administration" | "Internal Staff" | "Development" | "External"
  readonly description: string
}

export const USER_ROLE_OPTIONS: readonly UserRoleOption[] = [
  {
    value: "admin",
    label: "Admin",
    group: "Administration",
    description: "Full Compass administration, including users and security.",
  },
  {
    value: "secondary_admin",
    label: "Secondary Admin",
    group: "Administration",
    description: "Trusted backup administrator with user-management access.",
  },
  {
    value: "executive",
    label: "Executive",
    group: "Internal Staff",
    description: "Leadership visibility across projects and financials.",
  },
  {
    value: "project_manager",
    label: "Project Manager",
    group: "Internal Staff",
    description: "Project operations, schedules, RFIs, POs, and client updates.",
  },
  {
    value: "project_administrator",
    label: "Project Administrator",
    group: "Internal Staff",
    description: "Owner communication, bills, project records, and draws.",
  },
  {
    value: "assistant_project_manager",
    label: "Assistant Project Manager",
    group: "Internal Staff",
    description: "RFIs, RFQs, POs, takeoffs, schedules, and project support.",
  },
  {
    value: "accounting",
    label: "Accounting",
    group: "Internal Staff",
    description: "Financial workflows, bills, pay applications, and reporting.",
  },
  {
    value: "office_manager",
    label: "Office Manager",
    group: "Internal Staff",
    description: "Office coordination and administrative support.",
  },
  {
    value: "office",
    label: "Office Staff",
    group: "Internal Staff",
    description: "General staff access without user-management permissions.",
  },
  {
    value: "field_superintendent",
    label: "Field Superintendent",
    group: "Internal Staff",
    description: "Field schedule, daily logs, photos, and site coordination.",
  },
  {
    value: "field_crew",
    label: "Field Crew",
    group: "Internal Staff",
    description: "Daily field work, photos, logs, and assigned tasks.",
  },
  {
    value: "architectural_designer",
    label: "Architectural Designer",
    group: "Internal Staff",
    description: "Design project access, selections, and plan coordination.",
  },
  {
    value: "drafter",
    label: "Drafter",
    group: "Internal Staff",
    description: "Plan drafting and design documentation support.",
  },
  {
    value: "lead_estimator",
    label: "Lead Estimator",
    group: "Internal Staff",
    description: "Estimate leadership, RFQs, cost codes, and proposal prep.",
  },
  {
    value: "assistant_estimator",
    label: "Assistant Estimator",
    group: "Internal Staff",
    description: "Takeoffs, estimate support, RFQs, and vendor pricing.",
  },
  {
    value: "developer",
    label: "Developer",
    group: "Development",
    description:
      "Assigned-project testing access without broad company project visibility.",
  },
  {
    value: "subcontractor",
    label: "Subcontractor",
    group: "External",
    description: "Assigned-project access for RFIs, schedules, and messages.",
  },
  {
    value: "supplier",
    label: "Supplier",
    group: "External",
    description: "Assigned-project access for RFQs, POs, and messages.",
  },
  {
    value: "client",
    label: "Owner / Client",
    group: "External",
    description: "Owner-facing project updates, selections, photos, and messages.",
  },
  {
    value: "guest",
    label: "Guest",
    group: "External",
    description: "Limited assigned-project access.",
  },
  {
    value: "coordinator",
    label: "Coordinator",
    group: "Internal Staff",
    description: "Legacy coordinator role; prefer Assistant Project Manager.",
  },
  {
    value: "field",
    label: "Field",
    group: "Internal Staff",
    description: "Legacy field role; prefer Field Superintendent or Field Crew.",
  },
]

export function userRoleLabel(role: string): string {
  return (
    USER_ROLE_OPTIONS.find((option) => option.value === role)?.label ??
    role
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  )
}

export function userRoleDescription(role: string): string {
  return (
    USER_ROLE_OPTIONS.find((option) => option.value === role)?.description ??
    "Custom or legacy role."
  )
}

export function canManageUserAccessRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "secondary_admin"
}

export function canUseOrganizationProjectScopeRole(
  role: string | null | undefined
): boolean {
  return role !== null && role !== undefined && isInternalStaffRole(role)
}

export function isExternalProjectRole(role: string): boolean {
  return [
    "client",
    "owner",
    "subcontractor",
    "supplier",
    "guest",
  ].includes(role)
}

/** An owner-side role: the client or owner of a job (the owner portal). */
export function isOwnerRole(role: string | null | undefined): boolean {
  return role === "client" || role === "owner"
}

/** The client role exactly (an owner-side company membership); see isOwnerRole for either owner-side role. */
export function isClientRole(role: string | null | undefined): boolean {
  return role === "client"
}

/** Office and project leadership: admins, executives, office staff and project managers (not field or design roles). */
export function isOfficeLeadershipRole(role: string): boolean {
  switch (role) {
    case "admin":
    case "secondary_admin":
    case "executive":
    case "office":
    case "office_manager":
    case "project_manager":
    case "project_administrator":
    case "assistant_project_manager":
    case "coordinator":
      return true
    default:
      return false
  }
}

/** A vendor role: subcontractor or supplier (the sub/vendor portal). */
export function isVendorRole(role: string | null | undefined): boolean {
  return role === "subcontractor" || role === "supplier"
}

/** Someone outside the company who signed up but has no project role yet. */
export function isGuestRole(role: string | null | undefined): boolean {
  return role === "guest"
}

/** The developer account: sees staff working views without being company staff. */
export function isDeveloperRole(role: string | null | undefined): boolean {
  return role === "developer"
}

/** Company staff, or the developer, who sees what staff see. */
export function seesStaffViews(role: string): boolean {
  return isInternalStaffRole(role) || isDeveloperRole(role)
}

/** The outside portal a project role opens: owner, sub/vendor, or none (staff, guest). */
export function projectAudienceForRole(role: string | null | undefined): "owner" | "sub_vendor" | null {
  if (isOwnerRole(role)) return "owner"
  if (isVendorRole(role)) return "sub_vendor"
  return null
}

/** A company whose staff run jobs. A demo company stands in for a real one. */
export function isStaffOrganizationType(type: string | null | undefined): boolean {
  return type === "internal" || type === "demo"
}

export function isInternalStaffRole(role: string): boolean {
  switch (role) {
    case "admin":
    case "secondary_admin":
    case "executive":
    case "project_manager":
    case "project_administrator":
    case "assistant_project_manager":
    case "accounting":
    case "office_manager":
    case "office":
    case "field_superintendent":
    case "field_crew":
    case "architectural_designer":
    case "drafter":
    case "lead_estimator":
    case "assistant_estimator":
    case "coordinator":
    case "field":
      return true
    default:
      return false
  }
}

/** The full administrator only; secondary admins are excluded. */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin"
}

/** The stored owner account role ("client") alone; isOwnerRole also accepts "owner". */
export function isClientRole(role: string | null | undefined): boolean {
  return role === "client"
}

/** Runs a job day to day: project manager or project administrator. */
export function isProjectLeadRole(role: string | null | undefined): boolean {
  return role === "project_manager" || role === "project_administrator"
}

/** A conversation channel member role that may moderate: the channel's owner or a moderator. */
export function isChannelModeratorRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "moderator"
}

/** A subcontractor (trade doing work), not a supplier. */
export function isSubcontractorRole(role: string | null | undefined): boolean {
  return role === "subcontractor"
}
