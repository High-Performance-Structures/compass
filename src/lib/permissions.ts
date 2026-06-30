import type { AuthUser } from "./auth"
import { canManageUserAccessRole } from "@/lib/user-roles"

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
  | "agent"
  | "channels"

export type Action = "create" | "read" | "update" | "delete" | "approve" | "moderate"

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
  agent: ["create", "read", "update", "delete"],
  channels: ["create", "read", "update", "delete", "moderate"],
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
  agent: ["read"],
  channels: ["create", "read", "update"],
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
  agent: ["read"],
  channels: ["create", "read"],
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
  finance: ["read"],
  agent: [],
  channels: ["read"],
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
  agent: ["read"],
  channels: ["create", "read", "update"],
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

  return (
    canManageUserAccessRole(user.role) ||
    can(user, "organization", "update")
  )
}

export function canManageUserAccess(user: AuthUser | null): boolean {
  return !!user && user.isActive && canManageUserAccessRole(user.role)
}
