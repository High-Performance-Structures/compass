import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { organizations, projects } from "./schema"

export const PAPER_TRAIL_RECORD_TYPES = [
  "purchase_order",
  "estimate",
  "rfi",
  "change_order",
] as const
export type PaperTrailRecordType = (typeof PAPER_TRAIL_RECORD_TYPES)[number]

export const PAPER_TRAIL_FILE_STATUSES = [
  "pending",
  "synced",
  "failed",
  // Written to the private "Compass Records" folder because the usual
  // subfolder is shared outside the company.
  "held_private",
  // The record no longer exists; its last Drive copy is kept.
  "removed",
] as const
export type PaperTrailFileStatus = (typeof PAPER_TRAIL_FILE_STATUSES)[number]

/**
 * One living Drive copy per Compass record. Edits only move `dueAt`; the
 * scheduled job writes the file after a quiet period and skips records whose
 * `contentVersion` has not changed.
 */
export const projectRecordDriveFiles = sqliteTable(
  "project_record_drive_files",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    recordType: text("record_type", { enum: PAPER_TRAIL_RECORD_TYPES }).notNull(),
    recordId: text("record_id").notNull(),
    status: text("status", { enum: PAPER_TRAIL_FILE_STATUSES }).notNull().default("pending"),
    dueAt: text("due_at").notNull(),
    /** Starts the quiet period; "Save now" moves it into the past. */
    changedAt: text("changed_at").notNull(),
    /** The record's own latest change, as last seen by the change sweep. */
    sourceChangedAt: text("source_changed_at"),
    lastSyncedAt: text("last_synced_at"),
    driveFileId: text("drive_file_id"),
    driveFolderId: text("drive_folder_id"),
    /** The copy lives in the private records folder (its usual subfolder is shared outside). */
    inPrivateFolder: integer("in_private_folder", { mode: "boolean" }).notNull().default(false),
    fileName: text("file_name"),
    contentVersion: text("content_version"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_record_drive_files_record_idx").on(table.recordType, table.recordId),
    index("project_record_drive_files_due_idx").on(table.status, table.dueAt),
    index("project_record_drive_files_project_idx").on(table.projectId),
  ],
)

export type ProjectRecordDriveFile = typeof projectRecordDriveFiles.$inferSelect

/** Frozen milestone copies (sent, signed, approved, answered). Never overwritten. */
export const projectRecordDriveSnapshots = sqliteTable(
  "project_record_drive_snapshots",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    recordType: text("record_type", { enum: PAPER_TRAIL_RECORD_TYPES }).notNull(),
    recordId: text("record_id").notNull(),
    milestone: text("milestone").notNull(),
    /** When the milestone happened (sent, signed, approved, answered). */
    milestoneAt: text("milestone_at").notNull(),
    status: text("status", { enum: ["pending", "saved", "failed"] }).notNull().default("pending"),
    requestedAt: text("requested_at").notNull(),
    savedAt: text("saved_at"),
    driveFileId: text("drive_file_id"),
    fileName: text("file_name"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (table) => [
    index("project_record_drive_snapshots_due_idx").on(table.status, table.requestedAt),
    uniqueIndex("project_record_drive_snapshots_record_idx").on(table.recordType, table.recordId, table.milestone, table.milestoneAt),
  ],
)

/** Cached answer to "is this Drive folder shared outside the company?". */
export const driveFolderShareChecks = sqliteTable("drive_folder_share_checks", {
  folderId: text("folder_id").primaryKey(),
  sharedOutside: integer("shared_outside", { mode: "boolean" }).notNull(),
  checkedAt: text("checked_at").notNull(),
})
