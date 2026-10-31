import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { organizations, projects, users } from "./schema"

/** Historical reading editions have explicit readers, separate from construction sets. */
export const projectArchiveDocuments = sqliteTable("project_archive_documents", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  kind: text("kind").notNull(),
  period: text("period").notNull(),
  audience: text("audience", { enum: ["owner", "sub_vendor"] }).notNull(),
  sourceSystem: text("source_system").notNull().default("buildertrend"),
  sourceRecordIds: text("source_record_ids").notNull(),
  sourceAudienceEvidence: text("source_audience_evidence").notNull(),
  driveFileId: text("drive_file_id").notNull(),
  fileName: text("file_name").notNull(),
  sha256: text("sha256").notNull(),
  byteSize: integer("byte_size").notNull(),
  pageCount: integer("page_count").notNull(),
  status: text("status", { enum: ["published", "revoked"] }).notNull().default("published"),
  publishedBy: text("published_by").references(() => users.id, { onDelete: "set null" }),
  publishedAt: text("published_at").notNull(),
  revokedBy: text("revoked_by").references(() => users.id, { onDelete: "set null" }),
  revokedAt: text("revoked_at"),
  revokeReason: text("revoke_reason"),
  restoredBy: text("restored_by").references(() => users.id, { onDelete: "set null" }),
  restoredAt: text("restored_at"),
}, (table) => [
  index("project_archive_project_status_idx").on(table.projectId, table.status),
  uniqueIndex("project_archive_file_audience_uq").on(table.projectId, table.driveFileId, table.audience),
    index("project_archive_documents_organization_id_idx").on(table.organizationId),
])

/** Each named account needs its own grant; company labels never confer access. */
export const projectArchiveRecipients = sqliteTable("project_archive_recipients", {
  archiveId: text("archive_id").notNull().references(() => projectArchiveDocuments.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.archiveId, table.userId] }),
    index("project_archive_recipients_user_id_idx").on(table.userId)])

export type ProjectArchiveDocument = typeof projectArchiveDocuments.$inferSelect
