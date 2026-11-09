/*
 * Sign-in, companies and permissions: users, account deletion requests,
 * organizations (companies) and their members and invites, teams, groups,
 * role/team/user permission overrides with their audit trail, and users'
 * alternate email addresses.
 * Written by: src/lib/domain/identity/ and the auth/permission actions.
 */

import {
  index,
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { ACCOUNT_DELETION_REQUEST_STATUSES, STORED_USER_ROLES, USER_ROLES } from "../lib/domain/identity/statuses"

// Auth and user management tables
export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // workos user id
  email: text("email").notNull().unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  displayName: text("display_name"),
  phone: text("phone"),
  address: text("address"),
  avatarUrl: text("avatar_url"),
  dashboardDeskPhotoUrl: text("dashboard_desk_photo_url"),
  sidebarDeskPhotoUrl: text("sidebar_desk_photo_url"),
  role: text("role", { enum: STORED_USER_ROLES }).notNull().default("office"),
  googleEmail: text("google_email"), // override for google workspace impersonation
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

// Account deletion is intentionally request-based: project and financial
// records may have contractual retention requirements, so an operator must
// review dependencies before removing the WorkOS identity and personal data.
export const accountDeletionRequests = sqliteTable(
  "account_deletion_requests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Snapshots support ownership verification while a request is open and
    // must be cleared when deletion completes.
    emailSnapshot: text("email_snapshot"),
    displayNameSnapshot: text("display_name_snapshot"),
    status: text("status", { enum: ACCOUNT_DELETION_REQUEST_STATUSES }).notNull().default("pending"),
    requestedAt: text("requested_at").notNull(),
    processingStartedAt: text("processing_started_at"),
    processingStartedBy: text("processing_started_by").references(
      () => users.id,
      { onDelete: "set null" }
    ),
    completedAt: text("completed_at"),
    completedBy: text("completed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    cancelledAt: text("cancelled_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("account_deletion_requests_user_status_idx").on(
      table.userId,
      table.status
    ),
    index("account_deletion_requests_status_requested_idx").on(
      table.status,
      table.requestedAt
    ),
  ]
)

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(), // workos org id
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  type: text("type").notNull(), // "internal" or "client"
  logoUrl: text("logo_url"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const organizationMembers = sqliteTable("organization_members", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: USER_ROLES }).notNull(),
  joinedAt: text("joined_at").notNull(),
}, (table) => [
  // Resolved on every authenticated request (current user's memberships).
  index("organization_members_user_idx").on(table.userId),
  index("organization_members_org_user_idx").on(table.organizationId, table.userId),
  uniqueIndex("organization_members_org_user_unique").on(table.organizationId, table.userId),
])

export const organizationInvites = sqliteTable("organization_invites", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  role: text("role", { enum: USER_ROLES }).notNull().default("office"),
  maxUses: integer("max_uses"),
  useCount: integer("use_count").notNull().default(0),
  expiresAt: text("expires_at"),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
},
  (table) => [
    index("organization_invites_organization_id_idx").on(table.organizationId),
  ])

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: text("created_at").notNull(),
},
  (table) => [
    index("teams_organization_id_idx").on(table.organizationId),
  ])

export const teamMembers = sqliteTable("team_members", {
  id: text("id").primaryKey(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  joinedAt: text("joined_at").notNull(),
},
  (table) => [
    index("team_members_user_id_idx").on(table.userId),
    index("team_members_team_id_idx").on(table.teamId),
    uniqueIndex("team_members_team_user_unique").on(table.teamId, table.userId),
  ])

export const rolePermissionOverrides = sqliteTable(
  "role_permission_overrides",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: text("role", { enum: USER_ROLES }).notNull(),
    featureId: text("feature_id").notNull(),
    accessLevel: text("access_level").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("role_permission_overrides_unique").on(
      table.organizationId,
      table.role,
      table.featureId
    ),
    index("role_permission_overrides_org_idx").on(table.organizationId),
  ]
)

export const teamPermissionOverrides = sqliteTable(
  "team_permission_overrides",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    featureId: text("feature_id").notNull(),
    accessLevel: text("access_level").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("team_permission_overrides_unique").on(
      table.organizationId,
      table.teamId,
      table.featureId
    ),
    index("team_permission_overrides_org_idx").on(table.organizationId),
    index("team_permission_overrides_team_id_idx").on(table.teamId),
  ]
)

export const userPermissionOverrides = sqliteTable(
  "user_permission_overrides",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    featureId: text("feature_id").notNull(),
    accessLevel: text("access_level").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("user_permission_overrides_unique").on(
      table.organizationId,
      table.userId,
      table.featureId
    ),
    index("user_permission_overrides_org_idx").on(table.organizationId),
    index("user_permission_overrides_user_id_idx").on(table.userId),
  ]
)

export const permissionAuditEvents = sqliteTable(
  "permission_audit_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    role: text("role", { enum: USER_ROLES }),
    teamId: text("team_id").references(() => teams.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    featureId: text("feature_id").notNull(),
    previousAccessLevel: text("previous_access_level"),
    nextAccessLevel: text("next_access_level"),
    changedBy: text("changed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("permission_audit_events_org_idx").on(
      table.organizationId,
      table.createdAt
    ),
    index("permission_audit_events_team_id_idx").on(table.teamId),
  ]
)

export type RolePermissionOverride =
  typeof rolePermissionOverrides.$inferSelect

export type NewRolePermissionOverride =
  typeof rolePermissionOverrides.$inferInsert

export type TeamPermissionOverride =
  typeof teamPermissionOverrides.$inferSelect

export type NewTeamPermissionOverride =
  typeof teamPermissionOverrides.$inferInsert

export type UserPermissionOverride =
  typeof userPermissionOverrides.$inferSelect

export type NewUserPermissionOverride =
  typeof userPermissionOverrides.$inferInsert

export type PermissionAuditEvent = typeof permissionAuditEvents.$inferSelect

export type NewPermissionAuditEvent =
  typeof permissionAuditEvents.$inferInsert

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color"), // hex color for badges
  createdAt: text("created_at").notNull(),
},
  (table) => [
    index("groups_organization_id_idx").on(table.organizationId),
  ])

export const groupMembers = sqliteTable("group_members", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  joinedAt: text("joined_at").notNull(),
},
  (table) => [
    index("group_members_user_id_idx").on(table.userId),
    index("group_members_group_id_idx").on(table.groupId),
    uniqueIndex("group_members_group_user_unique").on(table.groupId, table.userId),
  ])

/**
 * Other email addresses a staff member writes from (an old company domain, a
 * shared mailbox they own). Never used to sign in: they help recognize the
 * person on imported messages and are offered as extra send-to addresses.
 * Stored lowercased; one owner per address in a company.
 */
export const userAlternateEmails = sqliteTable(
  "user_alternate_emails",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("user_alternate_emails_org_email_unique").on(table.organizationId, table.email),
    index("user_alternate_emails_user_idx").on(table.userId, table.organizationId),
    index("user_alternate_emails_created_by_idx").on(table.createdByUserId),
  ]
)

// Auth and user management types
export type User = typeof users.$inferSelect

export type NewUser = typeof users.$inferInsert

export type AccountDeletionRequest =
  typeof accountDeletionRequests.$inferSelect

export type NewAccountDeletionRequest =
  typeof accountDeletionRequests.$inferInsert

export type Organization = typeof organizations.$inferSelect

export type NewOrganization = typeof organizations.$inferInsert

export type OrganizationMember = typeof organizationMembers.$inferSelect

export type NewOrganizationMember = typeof organizationMembers.$inferInsert

export type OrganizationInvite = typeof organizationInvites.$inferSelect

export type NewOrganizationInvite = typeof organizationInvites.$inferInsert

export type Team = typeof teams.$inferSelect

export type NewTeam = typeof teams.$inferInsert

export type TeamMember = typeof teamMembers.$inferSelect

export type NewTeamMember = typeof teamMembers.$inferInsert

export type Group = typeof groups.$inferSelect

export type NewGroup = typeof groups.$inferInsert

export type GroupMember = typeof groupMembers.$inferSelect

export type NewGroupMember = typeof groupMembers.$inferInsert
