import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

import { organizations, projects, users } from "./schema"

export const socialAccounts = sqliteTable(
  "social_accounts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    department: text("department").notNull(),
    platform: text("platform").notNull(),
    externalAccountId: text("external_account_id").notNull(),
    parentExternalAccountId: text("parent_external_account_id"),
    accountName: text("account_name").notNull(),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    tokenExpiresAt: text("token_expires_at"),
    grantedScopes: text("granted_scopes").notNull(),
    status: text("status").notNull().default("connected"),
    connectedBy: text("connected_by").references(() => users.id, {
      onDelete: "set null",
    }),
    connectedAt: text("connected_at").notNull(),
    lastPublishedAt: text("last_published_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("social_accounts_org_department_platform_unique").on(
      table.organizationId,
      table.department,
      table.platform,
    ),
    index("social_accounts_org_status_idx").on(
      table.organizationId,
      table.status,
    ),
  ],
)

// Meta may return several managed Pages. Candidate Page tokens remain encrypted
// server-side until an administrator chooses the department destination.
export const socialConnectionDrafts = sqliteTable(
  "social_connection_drafts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    department: text("department").notNull(),
    candidatesEncrypted: text("candidates_encrypted").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("social_connection_drafts_user_expires_idx").on(
      table.userId,
      table.expiresAt,
    ),
  ],
)

export const socialPosts = sqliteTable(
  "social_posts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    department: text("department").notNull(),
    publicTitleSnapshot: text("public_title_snapshot").notNull(),
    locationCitySnapshot: text("location_city_snapshot").notNull(),
    heading: text("heading").notNull(),
    body: text("body").notNull(),
    hashtagsJson: text("hashtags_json").notNull().default("[]"),
    status: text("status").notNull().default("draft"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedBy: text("reviewed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: text("reviewed_at"),
    publishedAt: text("published_at"),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("social_posts_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("social_posts_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
    index("social_posts_org_status_idx").on(
      table.organizationId,
      table.status,
    ),
  ],
)

export const socialPostMedia = sqliteTable(
  "social_post_media",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => socialPosts.id, { onDelete: "cascade" }),
    photoId: text("photo_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    altText: text("alt_text"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("social_post_media_post_photo_unique").on(
      table.postId,
      table.photoId,
    ),
  ],
)

export const socialPostTargets = sqliteTable(
  "social_post_targets",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => socialPosts.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "restrict" }),
    platform: text("platform").notNull(),
    facebookAlbumMode: text("facebook_album_mode").notNull().default("none"),
    status: text("status").notNull().default("pending"),
    externalPostId: text("external_post_id"),
    externalPostUrl: text("external_post_url"),
    error: text("error"),
    publishedAt: text("published_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("social_post_targets_post_account_unique").on(
      table.postId,
      table.accountId,
    ),
    index("social_post_targets_status_idx").on(table.status, table.updatedAt),
  ],
)

export const socialProjectAlbums = sqliteTable(
  "social_project_albums",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    externalAlbumId: text("external_album_id").notNull(),
    albumName: text("album_name").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("social_project_albums_account_project_unique").on(
      table.accountId,
      table.projectId,
    ),
  ],
)

export type SocialAccount = typeof socialAccounts.$inferSelect
export type SocialPost = typeof socialPosts.$inferSelect
