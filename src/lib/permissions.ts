import type { AuthUser } from "./auth"

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

export type Action = "create" | "read" | "update" | "delete" | "approve"

type RolePermissions = {
  [key: string]: {
    [key in Resource]?: Action[]
  }
}

const PERMISSIONS: RolePermissions = {
  admin: {
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
  },
  office: {
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
  },
  field: {
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
  },
  client: {
    project: ["read"],
    schedule: ["read"],
    budget: ["read"],
    changeorder: ["read"],
    document: ["read"],
    user: ["read"],
    organization: ["read"],
    team: ["read"],
    group: ["read"],
    customer: ["read"],
    vendor: ["read"],
    finance: ["read"],
  },
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
