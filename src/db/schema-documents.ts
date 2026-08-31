import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

import { projects, users } from "./schema"

/**
 * Curated, project-scoped publication records for construction documents.
 * Google Drive remains the source of truth, while this table is the Compass
 * authorization boundary for owners, subcontractors, and internal staff.
 */
export const projectDocuments = sqliteTable(
  "project_documents",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    documentDate: text("document_date"),
    revision: text("revision"),
    status: text("status").notNull().default("current"),
    audience: text("audience").notNull().default("project_team"),
    downloadable: integer("downloadable", { mode: "boolean" })
      .notNull()
      .default(true),
    sourceDriveFileId: text("source_drive_file_id").notNull(),
    sourceFileName: text("source_file_name").notNull(),
    sourceMimeType: text("source_mime_type").notNull(),
    sourceUrl: text("source_url"),
    sourceChecksum: text("source_checksum"),
    supersedesDocumentId: text("supersedes_document_id"),
    publishedBy: text("published_by").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedAt: text("published_at"),
    archivedAt: text("archived_at"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_documents_project_drive_file_uq").on(
      table.projectId,
      table.sourceDriveFileId
    ),
    index("project_documents_project_status_idx").on(
      table.projectId,
      table.status,
      table.category
    ),
    index("project_documents_project_audience_idx").on(
      table.projectId,
      table.audience,
      table.status
    ),
  ]
)

export type ProjectDocument = typeof projectDocuments.$inferSelect
export type NewProjectDocument = typeof projectDocuments.$inferInsert
