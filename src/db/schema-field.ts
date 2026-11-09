/*
 * Field work: daily logs, daily log photos (with source dates and duplicate
 * aliases), owner project updates, missing-log reminders, daily log to
 * schedule task links, per-project Field Mode cost codes, project videos and
 * YouTube channel connections.
 * Written by: src/lib/domain/field/ and src/lib/domain/media/.
 */

import { sql } from "drizzle-orm"
import {
  check,
  index,
  sqliteTable,
  text,
  integer,
  primaryKey,
  real,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { organizations, users } from "./schema-identity"
import { projects } from "./schema-projects"
import { scheduleTasks } from "./schema-schedule"

export const projectVideos = sqliteTable(
  "project_videos",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    department: text("department").notNull(),
    youtubeChannelKey: text("youtube_channel_key").notNull(),
    compassAudience: text("compass_audience").notNull().default("staff"),
    youtubePrivacy: text("youtube_privacy").notNull().default("private"),
    publishStatus: text("publish_status").notNull().default("pending_review"),
    sourceSystem: text("source_system").notNull(),
    sourceExternalId: text("source_external_id").notNull(),
    sourceFileName: text("source_file_name").notNull(),
    sourceMimeType: text("source_mime_type").notNull(),
    sourceFileSize: integer("source_file_size").notNull().default(0),
    driveFileId: text("drive_file_id").notNull(),
    driveUrl: text("drive_url"),
    linkedEntityType: text("linked_entity_type"),
    linkedEntityId: text("linked_entity_id"),
    youtubeVideoId: text("youtube_video_id"),
    youtubeUrl: text("youtube_url"),
    youtubeUploadSessionUrl: text("youtube_upload_session_url"),
    uploadError: text("upload_error"),
    submittedByName: text("submitted_by_name"),
    submittedByEmail: text("submitted_by_email"),
    reviewedBy: text("reviewed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: text("reviewed_at"),
    publishedAt: text("published_at"),
    archivedAt: text("archived_at"),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_videos_source_unique").on(
      table.sourceSystem,
      table.sourceExternalId
    ),
    index("project_videos_project_created_idx").on(
      table.projectId,
      table.createdAt
    ),
    index("project_videos_org_status_idx").on(
      table.organizationId,
      table.publishStatus,
      table.createdAt
    ),
  ]
)

export type ProjectVideo = typeof projectVideos.$inferSelect

export type NewProjectVideo = typeof projectVideos.$inferInsert

export const youtubeChannelConnections = sqliteTable(
  "youtube_channel_connections",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    channelKey: text("channel_key").notNull(),
    channelId: text("channel_id").notNull(),
    channelTitle: text("channel_title").notNull(),
    googleAccountEmail: text("google_account_email").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
    grantedScopes: text("granted_scopes").notNull(),
    status: text("status").notNull().default("connected"),
    connectedBy: text("connected_by").references(() => users.id, {
      onDelete: "set null",
    }),
    connectedAt: text("connected_at").notNull(),
    lastUploadAt: text("last_upload_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("youtube_channel_connections_org_key_unique").on(
      table.organizationId,
      table.channelKey
    ),
    uniqueIndex("youtube_channel_connections_org_channel_unique").on(
      table.organizationId,
      table.channelId
    ),
    index("youtube_channel_connections_org_status_idx").on(
      table.organizationId,
      table.status
    ),
  ]
)

export type YoutubeChannelConnection =
  typeof youtubeChannelConnections.$inferSelect

export type NewYoutubeChannelConnection =
  typeof youtubeChannelConnections.$inferInsert

/** Explicit additions to the Field Mode cost codes offered on one project. */
export const projectFieldCostCodes = sqliteTable("project_field_cost_codes", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  codesJson: text("codes_json").notNull(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("project_field_cost_codes_org_idx").on(table.organizationId)])

export const dailyLogs = sqliteTable("daily_logs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  authorId: text("author_id").references(() => users.id),
  sourceSystem: text("source_system").notNull().default("compass"),
  sourceExternalId: text("source_external_id"),
  logDate: text("log_date").notNull(),
  weatherTempF: integer("weather_temp_f"),
  weatherConditions: text("weather_conditions"),
  weatherPrecipitation: text("weather_precipitation"),
  weatherSource: text("weather_source").notNull().default("manual"),
  workCompleted: text("work_completed").notNull(),
  issues: text("issues"),
  materialsUsed: text("materials_used"),
  crewPresent: text("crew_present"),
  hoursWorked: real("hours_worked"),
  safetyIncidents: text("safety_incidents"),
  visitorLog: text("visitor_log"),
  notes: text("notes"),
  isClientVisible: integer("is_client_visible", {
    mode: "boolean",
  }).notNull().default(false),
  reviewStatus: text("review_status").notNull().default("draft"),
  tags: text("tags"),
  syncStatus: text("sync_status").notNull().default("synced"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},
  (table) => [
    // Declared from drizzle/0031_daily_logs_owner_updates.sql.
    index("idx_daily_logs_project_date").on(table.projectId, table.logDate),
    // Declared from drizzle/0031_daily_logs_owner_updates.sql.
    index("idx_daily_logs_author").on(table.authorId),
    // Declared from drizzle/0031_daily_logs_owner_updates.sql.
    index("idx_daily_logs_sync").on(table.syncStatus),
  ])

export const dailyLogPhotos = sqliteTable("daily_log_photos", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  dailyLogId: text("daily_log_id").references(() => dailyLogs.id, {
    onDelete: "set null",
  }),
  uploadedBy: text("uploaded_by").references(() => users.id),
  sourceSystem: text("source_system").notNull().default("compass"),
  sourceExternalId: text("source_external_id"),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  driveFileId: text("drive_file_id"),
  driveUrl: text("drive_url"),
  thumbnailUrl: text("thumbnail_url"),
  caption: text("caption"),
  capturedAt: text("captured_at"),
  gpsLat: real("gps_lat"),
  gpsLng: real("gps_lng"),
  uploadStatus: text("upload_status").notNull().default("pending"),
  reviewStatus: text("review_status").notNull().default("needs_review"),
  ownerVisible: integer("owner_visible", {
    mode: "boolean",
  }).notNull().default(false),
  subVendorVisible: integer("sub_vendor_visible", {
    mode: "boolean",
  }).notNull().default(false),
  publicShareable: integer("public_shareable", {
    mode: "boolean",
  }).notNull().default(false),
  photoKind: text("photo_kind").notNull().default("progress"),
  schedulePhaseOverride: text("schedule_phase_override"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},
  (table) => [
    // Declared from drizzle/0031_daily_logs_owner_updates.sql.
    index("idx_daily_log_photos_project").on(table.projectId),
    // Declared from drizzle/0031_daily_logs_owner_updates.sql.
    index("idx_daily_log_photos_log").on(table.dailyLogId),
    // An imported file is attached once per daily log (migration 0276); the
    // same document may sit on several logs.
    uniqueIndex("daily_log_photos_log_source_unique")
      .on(table.dailyLogId, table.sourceSystem, table.sourceExternalId)
      .where(sql`${table.sourceExternalId} IS NOT NULL`),
    // Declared from drizzle/0031_daily_logs_owner_updates.sql.
    index("idx_daily_log_photos_upload").on(table.uploadStatus),
  ])

// Source chronology survives before/after an import and never overwrites capture
// metadata or the Compass audit timestamps. Exact source IDs preserve alias dates.
export const projectPhotoSourceDates = sqliteTable(
  "project_photo_source_dates",
  {
    projectId: text("project_id").notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceSystem: text("source_system").notNull(),
    sourceExternalId: text("source_external_id").notNull(),
    sourceDate: text("source_date").notNull(),
    sourceDateKind: text("source_date_kind").notNull(),
    sourceDateDisplay: text("source_date_display").notNull(),
    evidenceJson: text("evidence_json").notNull(),
    recordedAt: text("recorded_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.sourceSystem, table.sourceExternalId] })]
)

export const dailyLogPhotoAliases = sqliteTable(
  "daily_log_photo_aliases",
  {
    sourcePhotoId: text("source_photo_id")
      .primaryKey()
      .notNull()
      .references(() => dailyLogPhotos.id, { onDelete: "restrict" }),
    canonicalPhotoId: text("canonical_photo_id")
      .notNull()
      .references(() => dailyLogPhotos.id, { onDelete: "restrict" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    contentSha256: text("content_sha256").notNull(),
    contentSizeBytes: integer("content_size_bytes").notNull(),
    adjudication: text("adjudication").notNull().default("verified_sha256"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "daily_log_photo_aliases_distinct_check",
      sql`${table.sourcePhotoId} <> ${table.canonicalPhotoId}`,
    ),
    check(
      "daily_log_photo_aliases_sha256_check",
      sql`length(${table.contentSha256}) = 64 AND ${table.contentSha256} NOT GLOB '*[^0-9A-Fa-f]*'`,
    ),
    check(
      "daily_log_photo_aliases_size_check",
      sql`${table.contentSizeBytes} >= 0`,
    ),
    index("idx_daily_log_photo_aliases_project_canonical").on(
      table.projectId,
      table.canonicalPhotoId,
    ),
    index("idx_daily_log_photo_aliases_content").on(
      table.projectId,
      table.contentSha256,
      table.contentSizeBytes,
    ),
    index("daily_log_photo_aliases_canonical_photo_id_idx").on(table.canonicalPhotoId),
  ],
)

export const ownerProjectUpdates = sqliteTable("owner_project_updates", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  createdBy: text("created_by").references(() => users.id),
  title: text("title").notNull(),
  updateDate: text("update_date").notNull(),
  summary: text("summary").notNull(),
  status: text("status").notNull().default("draft"),
  channel: text("channel").notNull().default("compass"),
  sourceDailyLogIds: text("source_daily_log_ids"),
  selectedPhotoIds: text("selected_photo_ids"),
  periodStart: text("period_start"),
  periodEnd: text("period_end"),
  scheduleSnapshot: text("schedule_snapshot"),
  publishedAt: text("published_at"),
  sentAt: text("sent_at"),
  recalledAt: text("recalled_at"),
  recalledBy: text("recalled_by").references(() => users.id, {
    onDelete: "set null",
  }),
  revision: integer("revision").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},
  (table) => [
    // Declared from drizzle/0031_daily_logs_owner_updates.sql.
    index("idx_owner_project_updates_project_date").on(table.projectId, table.updateDate),
  ])

/** One missing daily log reminder per person per day. */
export const dailyLogReminders = sqliteTable(
  "daily_log_reminders",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reminderDate: text("reminder_date").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    remindedAt: text("reminded_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.reminderDate] }),
    index("daily_log_reminders_org_date_idx").on(table.organizationId, table.reminderDate),
  ],
)

export const dailyLogTaskLinks = sqliteTable("daily_log_task_links", {
  id: text("id").primaryKey(),
  dailyLogId: text("daily_log_id")
    .notNull()
    .references(() => dailyLogs.id, { onDelete: "cascade" }),
  scheduleTaskId: text("schedule_task_id")
    .notNull()
    .references(() => scheduleTasks.id, { onDelete: "cascade" }),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
},
  (table) => [
    index("daily_log_task_links_schedule_task_id_idx").on(table.scheduleTaskId),
    index("daily_log_task_links_daily_log_id_idx").on(table.dailyLogId),
  ])

export type DailyLog = typeof dailyLogs.$inferSelect

export type NewDailyLog = typeof dailyLogs.$inferInsert

export type DailyLogPhoto = typeof dailyLogPhotos.$inferSelect

export type NewDailyLogPhoto = typeof dailyLogPhotos.$inferInsert

export type DailyLogPhotoAlias = typeof dailyLogPhotoAliases.$inferSelect

export type NewDailyLogPhotoAlias = typeof dailyLogPhotoAliases.$inferInsert

export type DailyLogTaskLink = typeof dailyLogTaskLinks.$inferSelect

export type NewDailyLogTaskLink = typeof dailyLogTaskLinks.$inferInsert

export type OwnerProjectUpdate = typeof ownerProjectUpdates.$inferSelect

export type NewOwnerProjectUpdate = typeof ownerProjectUpdates.$inferInsert
