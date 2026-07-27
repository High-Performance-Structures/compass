import type { AuthUser } from "./auth"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import {
  canManageUserAccessRole,
  isInternalStaffRole,
} from "@/lib/user-roles"

export type Resource =
  | "project"
  | "schedule"
  | "budget"
  | "changeorder"
  | "document"
  | "user"
  | "organization"
  | "team"
  | "group"
  | "customer"
  | "vendor"
  | "finance"
  | "bill_submission"
  | "agent"
  | "channels"
  | "help"

export type Action = "create" | "read" | "update" | "delete" | "approve" | "moderate"

export type PermissionAccessLevel =
  | "none"
  | "view"
  | "edit"
  | "delete"
  | "approve"

export type PermissionFeature = {
  readonly id: string
  readonly group: string
  readonly label: string
  readonly description: string
  readonly resource: Resource
}

export const PERMISSION_ACCESS_LEVELS: readonly {
  readonly value: PermissionAccessLevel
  readonly label: string
  readonly description: string
}[] = [
  {
    value: "none",
    label: "No access",
    description: "Hide the feature and block related actions.",
  },
  {
    value: "view",
    label: "View",
    description: "Read-only access.",
  },
  {
    value: "edit",
    label: "Create / Edit",
    description: "Create and update records.",
  },
  {
    value: "delete",
    label: "Delete",
    description: "Remove records.",
  },
  {
    value: "approve",
    label: "Approve / Moderate",
    description: "Approve, moderate, or perform elevated workflow actions.",
  },
]

export const PERMISSION_FEATURES: readonly PermissionFeature[] = [
  {
    id: "project-hub",
    group: "Projects",
    label: "Project Hub",
    description: "Department project lists, project dashboards, and project status.",
    resource: "project",
  },
  {
    id: "project-registry",
    group: "Projects",
    label: "Project Registry",
    description: "Developer/admin project mapping, IDs, Sage links, and Drive links.",
    resource: "organization",
  },
  {
    id: "project-contacts",
    group: "Projects",
    label: "Project Contacts",
    description: "Project owners, vendors, subs, suppliers, and internal assignments.",
    resource: "vendor",
  },
  {
    id: "daily-logs",
    group: "Field",
    label: "Daily Logs",
    description: "Daily log entries, weather records, notes, photos, and attachments.",
    resource: "project",
  },
  {
    id: "project-photos",
    group: "Field",
    label: "Project Photos",
    description: "Photo review, visibility, phase tagging, and approved galleries.",
    resource: "project",
  },
  {
    id: "schedule",
    group: "Operations",
    label: "Project Schedule",
    description: "Project schedule items, Gantt views, milestones, and calendar sync.",
    resource: "schedule",
  },
  {
    id: "work-calendar",
    group: "Operations",
    label: "Work Calendar",
    description: "User tasks, company calendar items, appointments, and reminders.",
    resource: "schedule",
  },
  {
    id: "tasks",
    group: "Operations",
    label: "Tasks / To-Dos",
    description: "Tasks created from schedules, RFIs, logs, POs, and messages.",
    resource: "project",
  },
  {
    id: "rfis",
    group: "Operations",
    label: "RFIs",
    description: "Requests for information, assignments, due dates, and responses.",
    resource: "project",
  },
  {
    id: "rfqs",
    group: "Operations",
    label: "RFQs / RFPs",
    description: "Quote requests, vendor recipients, plan/spec links, and selections.",
    resource: "project",
  },
  {
    id: "purchase-orders",
    group: "Operations",
    label: "Purchase Orders",
    description: "PO staging, line items, supplier emails, pickup copies, and Sage sync.",
    resource: "project",
  },
  {
    id: "finish-selections",
    group: "Client Experience",
    label: "Finish Selections",
    description: "Owner selections, room sheets, approval status, and RFQ handoff.",
    resource: "project",
  },
  {
    id: "owner-updates",
    group: "Client Experience",
    label: "Owner Updates",
    description: "Owner-facing project updates, HTML email, links, and PDF reports.",
    resource: "document",
  },
  {
    id: "owner-preview",
    group: "Client Experience",
    label: "Owner Preview",
    description: "Owner-facing view previews, cover photos, and visible project data.",
    resource: "project",
  },
  {
    id: "sub-vendor-preview",
    group: "Client Experience",
    label: "Sub / Vendor Preview",
    description: "Subcontractor and vendor-facing project previews.",
    resource: "project",
  },
  {
    id: "budget",
    group: "Financial",
    label: "Budget / G703 View",
    description: "Budget lines, owner cost visibility, actuals, and draw context.",
    resource: "budget",
  },
  {
    id: "financials",
    group: "Financial",
    label: "Financials",
    description: "Invoices, payments, vendor bills, credit memos, and billing workflows.",
    resource: "finance",
  },
  {
    id: "bill-submissions",
    group: "Financial",
    label: "Bill Submissions",
    description: "Sub/vendor bill intake, attachments, coding review, and admin approval.",
    resource: "bill_submission",
  },
  {
    id: "sage-sync",
    group: "Financial",
    label: "Sage Sync Queue",
    description: "Sage bridge status, pending sync review, approvals, and batches.",
    resource: "organization",
  },
  {
    id: "customers",
    group: "Directory",
    label: "Customers",
    description: "Customer directory, owner contacts, and customer records.",
    resource: "customer",
  },
  {
    id: "vendors",
    group: "Directory",
    label: "Vendors / Suppliers / Subs",
    description: "Vendor directory, categories, Sage matches, and contact records.",
    resource: "vendor",
  },
  {
    id: "internal-directory",
    group: "Directory",
    label: "Internal Directory",
    description: "Internal departments and active Compass users with Compass roles.",
    resource: "user",
  },
  {
    id: "files",
    group: "Documents",
    label: "Files / Google Drive",
    description: "Drive browsing, file links, uploads, downloads, and project files.",
    resource: "document",
  },
  {
    id: "conversations",
    group: "Communication",
    label: "Conversations",
    description: "Channels, project messages, threads, mentions, and announcements.",
    resource: "channels",
  },
  {
    id: "agent",
    group: "Communication",
    label: "Compass AI Agent",
    description: "AI search bar, chat panel, tools, navigation, and dashboard help.",
    resource: "agent",
  },
  {
    id: "help-resources",
    group: "Support",
    label: "Help & Resources",
    description: "Searchable staff guides, printable references, and support procedures.",
    resource: "help",
  },
  {
    id: "users",
    group: "Administration",
    label: "Users and Roles",
    description: "Invites, deactivation, user roles, project assignments, and access.",
    resource: "user",
  },
  {
    id: "teams",
    group: "Administration",
    label: "Teams",
    description: "Internal teams and future team-based permission overrides.",
    resource: "team",
  },
  {
    id: "groups",
    group: "Administration",
    label: "Groups",
    description: "Shared groups and future group-based access filters.",
    resource: "group",
  },
  {
    id: "integrations",
    group: "Administration",
    label: "Integrations",
    description: "Google Drive, Sage, messaging providers, and external connections.",
    resource: "organization",
  },
]

export function getPermissionFeature(
  featureId: string
): PermissionFeature | null {
  return PERMISSION_FEATURES.find((feature) => feature.id === featureId) ?? null
}

export function isPermissionAccessLevel(
  value: string
): value is PermissionAccessLevel {
  return PERMISSION_ACCESS_LEVELS.some((level) => level.value === value)
}

export function accessLevelToActions(
  level: PermissionAccessLevel
): readonly Action[] {
  switch (level) {
    case "approve":
      return ["create", "read", "update", "delete", "approve", "moderate"]
    case "delete":
      return ["create", "read", "update", "delete"]
    case "edit":
      return ["create", "read", "update"]
    case "view":
      return ["read"]
    case "none":
      return []
  }
}

type RolePermissions = {
  [key: string]: {
    [key in Resource]?: Action[]
  }
}

type RolePermissionSet = RolePermissions[string]

const ADMIN_PERMISSIONS: RolePermissionSet = {
  project: ["create", "read", "update", "delete", "approve"],
  schedule: ["create", "read", "update", "delete", "approve"],
  budget: ["create", "read", "update", "delete", "approve"],
  changeorder: ["create", "read", "update", "delete", "approve"],
  document: ["create", "read", "update", "delete", "approve"],
  user: ["create", "read", "update", "delete"],
  organization: ["create", "read", "update", "delete"],
  team: ["create", "read", "update", "delete"],
  group: ["create", "read", "update", "delete"],
  customer: ["create", "read", "update", "delete"],
  vendor: ["create", "read", "update", "delete"],
  finance: ["create", "read", "update", "delete", "approve"],
  bill_submission: ["create", "read", "update", "delete", "approve"],
  agent: ["create", "read", "update", "delete"],
  channels: ["create", "read", "update", "delete", "moderate"],
  help: ["create", "read", "update", "delete"],
}

const INTERNAL_PROJECT_PERMISSIONS: RolePermissionSet = {
  project: ["create", "read", "update"],
  schedule: ["create", "read", "update"],
  budget: ["create", "read", "update"],
  changeorder: ["create", "read", "update"],
  document: ["create", "read", "update"],
  user: ["read"],
  organization: ["read"],
  team: ["read"],
  group: ["read"],
  customer: ["create", "read", "update"],
  vendor: ["create", "read", "update"],
  finance: ["create", "read", "update"],
  bill_submission: ["create", "read", "update"],
  agent: ["read"],
  channels: ["create", "read", "update"],
  help: ["read"],
}

const FIELD_PERMISSIONS: RolePermissionSet = {
  project: ["read"],
  schedule: ["read", "update"],
  budget: ["read"],
  changeorder: ["create", "read"],
  document: ["create", "read"],
  user: ["read"],
  organization: ["read"],
  team: ["read"],
  group: ["read"],
  customer: ["read"],
  vendor: ["read"],
  finance: ["read"],
  bill_submission: ["create", "read"],
  agent: ["read"],
  channels: ["create", "read"],
  help: ["read"],
}

const EXTERNAL_PROJECT_PERMISSIONS: RolePermissionSet = {
  project: ["read"],
  schedule: ["read"],
  budget: ["read"],
  changeorder: ["read"],
  document: ["read"],
  user: [],
  organization: ["read"],
  team: ["read"],
  group: ["read"],
  customer: ["read"],
  vendor: ["read"],
  finance: [],
  bill_submission: ["create", "read"],
  agent: [],
  channels: ["read"],
  help: [],
}

const DEVELOPER_PERMISSIONS: RolePermissionSet = {
  project: ["read", "update"],
  schedule: ["create", "read", "update"],
  budget: ["create", "read", "update"],
  changeorder: ["create", "read", "update"],
  document: ["create", "read", "update"],
  user: ["read"],
  organization: ["read"],
  team: ["read"],
  group: ["read"],
  customer: ["read"],
  vendor: ["read"],
  finance: ["read"],
  bill_submission: ["create", "read", "update"],
  agent: ["read"],
  channels: ["create", "read", "update"],
  help: ["read"],
}

const PERMISSIONS: RolePermissions = {
  admin: ADMIN_PERMISSIONS,
  secondary_admin: ADMIN_PERMISSIONS,
  executive: {
    ...INTERNAL_PROJECT_PERMISSIONS,
    finance: ["read", "approve"],
    organization: ["read"],
    user: ["read"],
  },
  office: INTERNAL_PROJECT_PERMISSIONS,
  office_manager: INTERNAL_PROJECT_PERMISSIONS,
  project_manager: INTERNAL_PROJECT_PERMISSIONS,
  project_administrator: INTERNAL_PROJECT_PERMISSIONS,
  assistant_project_manager: INTERNAL_PROJECT_PERMISSIONS,
  architectural_designer: INTERNAL_PROJECT_PERMISSIONS,
  drafter: INTERNAL_PROJECT_PERMISSIONS,
  lead_estimator: INTERNAL_PROJECT_PERMISSIONS,
  assistant_estimator: INTERNAL_PROJECT_PERMISSIONS,
  developer: DEVELOPER_PERMISSIONS,
  coordinator: INTERNAL_PROJECT_PERMISSIONS,
  accounting: {
    ...INTERNAL_PROJECT_PERMISSIONS,
    finance: ["create", "read", "update", "approve"],
  },
  field_superintendent: FIELD_PERMISSIONS,
  field_crew: FIELD_PERMISSIONS,
  field: FIELD_PERMISSIONS,
  client: EXTERNAL_PROJECT_PERMISSIONS,
  subcontractor: EXTERNAL_PROJECT_PERMISSIONS,
  supplier: EXTERNAL_PROJECT_PERMISSIONS,
  guest: EXTERNAL_PROJECT_PERMISSIONS,
}

export function can(
  user: AuthUser | null,
  resource: Resource,
  action: Action
): boolean {
  if (!user || !user.isActive) return false

  const rolePermissions = PERMISSIONS[user.role]
  if (!rolePermissions) return false

  const resourcePermissions = rolePermissions[resource]
  if (!resourcePermissions) return false

  return resourcePermissions.includes(action)
}

/**
 * Jarvis is an internal capability. External and guest roles have no agent
 * permission in the baseline matrix and remain denied here.
 */
export function canUseAskCompass(user: AuthUser | null): boolean {
  return user?.role !== "guest" && can(user, "agent", "read")
}

export function canUseFieldDesk(user: AuthUser | null): boolean {
  return (
    user !== null &&
    canUseAskCompass(user) &&
    isInternalStaffRole(user.role)
  )
}

export function canUseOfficeTalk(user: AuthUser | null): boolean {
  if (
    !user ||
    isDemoUser(user.id) ||
    (user.organizationId !== null && isDemoOrg(user.organizationId))
  ) {
    return false
  }
  return (
    user.isActive &&
    isInternalStaffRole(user.role) &&
    can(user, "channels", "read")
  )
}

/**
 * Calendar event management is broader than field schedule progress but
 * narrower than schedule.update. Keep it with office/project leadership.
 */
export function canManageWorkCalendarEvents(
  user: AuthUser | null
): boolean {
  if (!user || !user.isActive || !can(user, "schedule", "update")) {
    return false
  }

  switch (user.role) {
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

export function requirePermission(
  user: AuthUser | null,
  resource: Resource,
  action: Action
): void {
  if (!can(user, resource, action)) {
    throw new Error(
      `Permission denied: ${user?.role ?? "unknown"} cannot ${action} ${resource}`
    )
  }
}

export function getPermissions(role: string, resource: Resource): Action[] {
  const rolePermissions = PERMISSIONS[role]
  if (!rolePermissions) return []

  return rolePermissions[resource] ?? []
}

export function permissionAccessLevelFromActions(
  actions: readonly Action[]
): PermissionAccessLevel {
  if (actions.includes("approve") || actions.includes("moderate")) {
    return "approve"
  }
  if (actions.includes("delete")) return "delete"
  if (actions.includes("create") || actions.includes("update")) return "edit"
  if (actions.includes("read")) return "view"
  return "none"
}

export function getPermissionAccessLevel(
  role: string,
  resource: Resource
): PermissionAccessLevel {
  return permissionAccessLevelFromActions(getPermissions(role, resource))
}

export function hasAnyPermission(
  user: AuthUser | null,
  resource: Resource
): boolean {
  if (!user || !user.isActive) return false

  const rolePermissions = PERMISSIONS[user.role]
  if (!rolePermissions) return false

  const resourcePermissions = rolePermissions[resource]
  return !!resourcePermissions && resourcePermissions.length > 0
}

export function canManageProjectRegistry(user: AuthUser | null): boolean {
  if (!user || !user.isActive) return false
  if (
    isDemoUser(user.id) ||
    (user.organizationId !== null && isDemoOrg(user.organizationId))
  ) {
    return false
  }

  return (
    canManageUserAccessRole(user.role) ||
    can(user, "organization", "update")
  )
}

export function canManageUserAccess(user: AuthUser | null): boolean {
  if (!user || !user.isActive) return false
  if (
    isDemoUser(user.id) ||
    (user.organizationId !== null && isDemoOrg(user.organizationId))
  ) {
    return false
  }

  return canManageUserAccessRole(user.role)
}
