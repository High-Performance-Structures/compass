/*
 * Enumerated values for people, accounts and memberships (architecture
 * standard, section 3). Pure constants with no imports, so the Drizzle schema
 * can type its columns with them. Role permissions are configurable per
 * company (role_permission_overrides); the role names themselves are this list.
 */

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
  "developer",
  "subcontractor",
  "supplier",
  "client",
  "guest",
  // Legacy roles kept so existing accounts and old invite links keep working.
  "coordinator",
  "field",
] as const
export type UserRole = (typeof USER_ROLES)[number]

export const ACCOUNT_DELETION_REQUEST_STATUSES = ["pending", "processing", "completed", "cancelled"] as const
export type AccountDeletionRequestStatus = (typeof ACCOUNT_DELETION_REQUEST_STATUSES)[number]

/** Roles that administer the company account. */
export const ADMIN_USER_ROLES: readonly UserRole[] = ["admin", "secondary_admin"]

/**
 * Every role a users or membership row may hold: the assignable USER_ROLES
 * plus roles that exist in live data but are never offered or assigned in
 * Compass. "integration" marks service accounts created outside the app
 * (no Compass writer); permission and staff checks treat it as an unknown
 * role, exactly as before it was listed. Assignment, invites and role
 * pickers keep using USER_ROLES.
 */
export const STORED_USER_ROLES = [...USER_ROLES, "integration"] as const
