export const USER_ROLES = [
  "admin",
  "secondary_admin",
  "executive",
  "project_manager",
  "project_administrator",
  "assistant_project_manager",
  "accounting",
  "office_manager",
  "office",
  "field_superintendent",
  "field_crew",
  "architectural_designer",
  "drafter",
  "lead_estimator",
  "assistant_estimator",
  "subcontractor",
  "supplier",
  "client",
  "guest",
  // Legacy roles kept so existing accounts and old invite links keep working.
  "coordinator",
  "field",
] as const

export type UserRole = (typeof USER_ROLES)[number]

export type UserRoleOption = {
  readonly value: UserRole
  readonly label: string
  readonly group: "Administration" | "Internal Staff" | "External"
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
