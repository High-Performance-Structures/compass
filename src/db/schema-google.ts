import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { users, organizations } from "./schema"

export const googleAuth = sqliteTable("google_auth", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  serviceAccountKeyEncrypted: text(
    "service_account_key_encrypted"
  ).notNull(),
  workspaceDomain: text("workspace_domain").notNull(),
  sharedDriveId: text("shared_drive_id"),
  sharedDriveName: text("shared_drive_name"),
  connectedBy: text("connected_by")
    .notNull()
    .references(() => users.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const googleStarredFiles = sqliteTable("google_starred_files", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  googleFileId: text("google_file_id").notNull(),
  createdAt: text("created_at").notNull(),
})

export type GoogleAuth = typeof googleAuth.$inferSelect
export type NewGoogleAuth = typeof googleAuth.$inferInsert
export type GoogleStarredFile = typeof googleStarredFiles.$inferSelect
export type NewGoogleStarredFile = typeof googleStarredFiles.$inferInsert
