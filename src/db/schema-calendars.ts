/*
 * Calendars: the company work calendar (settings, events, attendees), client
 * Google Meet meetings, My Compass personal calendars and Today's plan
 * preferences, Compass project calendars, and Google Calendar connections,
 * selections, project calendars, ACL members, subscriptions, synced events
 * and links to Compass records.
 * Written by: src/lib/domain/work-calendar/ and src/lib/domain/calendars/.
 */

import { sql } from "drizzle-orm"
import {
  index,
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { WORK_CALENDAR_EVENT_TYPES, WORK_CALENDAR_EVENT_VISIBILITIES } from "../lib/domain/work-calendar/statuses"
import { dailyLogs } from "./schema-field"
import { organizations, users } from "./schema-identity"
import { projects } from "./schema-projects"

export const organizationCalendarSettings = sqliteTable(
  "organization_calendar_settings",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    defaultProjectId: text("default_project_id").references(
      () => projects.id,
      { onDelete: "set null" },
    ),
    timeZone: text("time_zone").notNull().default("America/Denver"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("organization_calendar_settings_default_project_id_idx").on(table.defaultProjectId),
  ],
)

export const workCalendarEvents = sqliteTable(
  "work_calendar_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    eventType: text("event_type", { enum: WORK_CALENDAR_EVENT_TYPES }).notNull().default("meeting"),
    visibility: text("visibility", { enum: WORK_CALENDAR_EVENT_VISIBILITIES }).notNull().default("organization"),
    description: text("description"),
    startDate: text("start_date"),
    endDateExclusive: text("end_date_exclusive"),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    allDay: integer("all_day", { mode: "boolean" })
      .notNull()
      .default(false),
    timeZone: text("time_zone").notNull().default("UTC"),
    location: text("location"),
    meetingUrl: text("meeting_url"),
    recurrence: text("recurrence").notNull().default("none"),
    recurrenceUntil: text("recurrence_until"),
    status: text("status").notNull().default("open"),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    cancelledBy: text("cancelled_by").references(() => users.id, {
      onDelete: "set null",
    }),
    cancelledAt: text("cancelled_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_work_calendar_events_org_start").on(
      table.organizationId,
      table.status,
      table.startDate,
      table.startsAt,
    ),
    index("idx_work_calendar_events_project_start").on(
      table.projectId,
      table.status,
      table.startDate,
      table.startsAt,
    ),
  ],
)

// Google Meet calls with a project's clients, hosted from the booking staff
// member's own Google Calendar. Guest and staff lists are JSON email arrays.
export const projectClientMeetings = sqliteTable(
  "project_client_meetings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizerUserId: text("organizer_user_id")
      .notNull()
      .references(() => users.id),
    organizerEmail: text("organizer_email").notNull(),
    title: text("title").notNull(),
    note: text("note"),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    timeZone: text("time_zone").notNull(),
    guestEmails: text("guest_emails").notNull().default("[]"),
    staffEmails: text("staff_emails").notNull().default("[]"),
    googleEventId: text("google_event_id"),
    meetingUrl: text("meeting_url"),
    status: text("status").notNull().default("scheduled"),
    cancelledBy: text("cancelled_by").references(() => users.id),
    cancelledAt: text("cancelled_at"),
    transcriptStatus: text("transcript_status"),
    transcriptDriveFileId: text("transcript_drive_file_id"),
    transcriptUrl: text("transcript_url"),
    /** The saved transcript's text, as Google wrote it. */
    transcriptText: text("transcript_text"),
    transcriptError: text("transcript_error"),
    transcriptCheckedAt: text("transcript_checked_at"),
    /** The internal draft daily log made from the transcript. */
    dailyLogId: text("daily_log_id").references(() => dailyLogs.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_project_client_meetings_project").on(
      table.projectId,
      table.startsAt,
    ),
    index("idx_project_client_meetings_org").on(
      table.organizationId,
      table.startsAt,
    ),
    index("project_client_meetings_daily_log_id_idx").on(table.dailyLogId),
    index("project_client_meetings_organizer_user_id_idx").on(table.organizerUserId),
  ],
)

// "My Compass": a Google calendar in each staff member's own account that
// Compass fills with their assigned schedule items and to-dos.
export const myCompassCalendars = sqliteTable("my_compass_calendars", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  /** JSON array of other names this person appears as on assignments. */
  otherNames: text("other_names").notNull().default("[]"),
  googleEmail: text("google_email"),
  googleCalendarId: text("google_calendar_id"),
  /** pending | active | removed (deleted in Google) | error */
  status: text("status").notNull().default("pending"),
  lastSyncedAt: text("last_synced_at"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},
  (table) => [
    index("my_compass_calendars_organization_id_idx").on(table.organizationId),
  ])

// Today's plan: each person's daily digest choice, and what was last sent so
// the digest goes once a day and an overload warning once a week.
export const morningPlanPreferences = sqliteTable(
  "morning_plan_preferences",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    digestEnabled: integer("digest_enabled", { mode: "boolean" }).notNull().default(false),
    /** Local hour (0–23, company time zone) the daily digest is sent. */
    digestHour: integer("digest_hour").notNull().default(7),
    /** Local date (YYYY-MM-DD) the last digest went out. */
    lastDigestOn: text("last_digest_on"),
    /** Monday (YYYY-MM-DD) of the last week an overload warning went out. */
    lastOverloadWeek: text("last_overload_week"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_morning_plan_preferences_org").on(table.organizationId)],
)

export const myCompassCalendarItems = sqliteTable(
  "my_compass_calendar_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "<source>:<record id>", e.g. "schedule:abc". */
    itemKey: text("item_key").notNull(),
    googleEventId: text("google_event_id").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("my_compass_calendar_items_user_key").on(table.userId, table.itemKey),
  ],
)

/**
 * A Google calendar for one project, owned by the company's Compass account
 * and shared only with staff. Compass keeps its events and sharing current.
 */
export const compassProjectCalendars = sqliteTable(
  "compass_project_calendars",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Staff choice for this project; null follows the company setting. */
    enabled: integer("enabled", { mode: "boolean" }),
    ownerEmail: text("owner_email"),
    googleCalendarId: text("google_calendar_id"),
    /** The name last given to the Google calendar, to catch job renames. */
    calendarName: text("calendar_name"),
    /** pending | active | error */
    status: text("status").notNull().default("pending"),
    lastSyncedAt: text("last_synced_at"),
    lastError: text("last_error"),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("compass_project_calendars_org").on(table.organizationId, table.lastSyncedAt)],
)

export const compassProjectCalendarEvents = sqliteTable(
  "compass_project_calendar_events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** "<source>:<record id>", e.g. "schedule:abc". */
    itemKey: text("item_key").notNull(),
    googleEventId: text("google_event_id").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("compass_project_calendar_events_key").on(table.projectId, table.itemKey),
  ],
)

/** Staff the project calendar is shared with. */
export const compassProjectCalendarMembers = sqliteTable(
  "compass_project_calendar_members",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    aclRuleId: text("acl_rule_id").notNull(),
    /** When Compass added it to the person's calendar list; added only once. */
    listedAt: text("listed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("compass_project_calendar_members_user").on(table.projectId, table.userId),
    index("compass_project_calendar_members_user_id_idx").on(table.userId),
  ],
)

export const workCalendarEventAttendees = sqliteTable(
  "work_calendar_event_attendees",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => workCalendarEvents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    responseStatus: text("response_status").notNull().default("needs_action"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("work_calendar_event_attendee_unique").on(
      table.eventId,
      table.userId,
    ),
    index("idx_work_calendar_event_attendees_user").on(table.userId),
  ],
)

export const googleCalendarConnections = sqliteTable(
  "google_calendar_connections",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    googleAccountId: text("google_account_id").notNull(),
    googleAccountEmail: text("google_account_email").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
    grantedScopes: text("granted_scopes").notNull(),
    status: text("status").notNull().default("connected"),
    calendarSyncEnabled: integer("calendar_sync_enabled", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    tasksSyncEnabled: integer("tasks_sync_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    isOrganizationCalendarOwner: integer("is_organization_calendar_owner", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    connectedAt: text("connected_at").notNull(),
    lastSyncedAt: text("last_synced_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("google_calendar_connection_user_unique").on(
      table.organizationId,
      table.userId,
    ),
    uniqueIndex("google_calendar_connection_account_unique").on(
      table.organizationId,
      table.googleAccountId,
    ),
    index("idx_google_calendar_connections_status").on(
      table.organizationId,
      table.status,
    ),
    // Declared from drizzle/0122_google_project_calendars.sql.
    uniqueIndex("google_calendar_connection_org_owner_unique").on(table.organizationId).where(sql`"is_organization_calendar_owner" = 1`),
    index("google_calendar_connections_user_id_idx").on(table.userId),
  ],
)

export const googleCalendarSelections = sqliteTable(
  "google_calendar_selections",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => googleCalendarConnections.id, {
        onDelete: "cascade",
      }),
    googleCalendarId: text("google_calendar_id").notNull(),
    summary: text("summary").notNull(),
    description: text("description"),
    timeZone: text("time_zone"),
    backgroundColor: text("background_color"),
    accessRole: text("access_role").notNull().default("reader"),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    selected: integer("selected", { mode: "boolean" })
      .notNull()
      .default(false),
    importEvents: integer("import_events", { mode: "boolean" })
      .notNull()
      .default(false),
    exportCompassEvents: integer("export_compass_events", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    isCompassDestination: integer("is_compass_destination", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    calendarScope: text("calendar_scope").notNull().default("personal"),
    internalVisibility: text("internal_visibility")
      .notNull()
      .default("busy"),
    internalCanCreate: integer("internal_can_create", { mode: "boolean" })
      .notNull()
      .default(false),
    internalCanEdit: integer("internal_can_edit", { mode: "boolean" })
      .notNull()
      .default(false),
    internalCanDelete: integer("internal_can_delete", { mode: "boolean" })
      .notNull()
      .default(false),
    syncToken: text("sync_token"),
    watchChannelId: text("watch_channel_id"),
    watchResourceId: text("watch_resource_id"),
    watchExpiresAt: text("watch_expires_at"),
    lastSyncedAt: text("last_synced_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("google_calendar_selection_unique").on(
      table.connectionId,
      table.googleCalendarId,
    ),
    index("idx_google_calendar_selections_selected").on(
      table.connectionId,
      table.selected,
    ),
  ],
)

export const googleProjectCalendars = sqliteTable(
  "google_project_calendars",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ownerConnectionId: text("owner_connection_id")
      .notNull()
      .references(() => googleCalendarConnections.id, { onDelete: "cascade" }),
    selectionId: text("selection_id")
      .notNull()
      .references(() => googleCalendarSelections.id, { onDelete: "cascade" }),
    googleCalendarId: text("google_calendar_id").notNull(),
    summary: text("summary").notNull(),
    timeZone: text("time_zone").notNull(),
    status: text("status").notNull().default("active"),
    lastAclSyncedAt: text("last_acl_synced_at"),
    lastSyncedAt: text("last_synced_at"),
    lastError: text("last_error"),
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
    uniqueIndex("google_project_calendar_project_unique").on(table.projectId),
    uniqueIndex("google_project_calendar_google_unique").on(
      table.ownerConnectionId,
      table.googleCalendarId,
    ),
    index("idx_google_project_calendars_org_status").on(
      table.organizationId,
      table.status,
    ),
    index("google_project_calendars_selection_id_idx").on(table.selectionId),
  ],
)

export const googleProjectCalendarAclMembers = sqliteTable(
  "google_project_calendar_acl_members",
  {
    id: text("id").primaryKey(),
    projectCalendarId: text("project_calendar_id")
      .notNull()
      .references(() => googleProjectCalendars.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    email: text("email").notNull(),
    googleAclRuleId: text("google_acl_rule_id").notNull(),
    role: text("role").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("google_project_calendar_acl_email_unique").on(
      table.projectCalendarId,
      table.email,
    ),
    index("idx_google_project_calendar_acl_user").on(table.userId),
  ],
)

export const googleProjectCalendarSubscriptions = sqliteTable(
  "google_project_calendar_subscriptions",
  {
    id: text("id").primaryKey(),
    projectCalendarId: text("project_calendar_id")
      .notNull()
      .references(() => googleProjectCalendars.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => googleCalendarConnections.id, { onDelete: "cascade" }),
    subscribedAt: text("subscribed_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("google_project_calendar_subscription_unique").on(
      table.projectCalendarId,
      table.userId,
    ),
    index("google_project_calendar_subscriptions_connection_id_idx").on(table.connectionId),
  ],
)

export const googleCalendarEvents = sqliteTable(
  "google_calendar_events",
  {
    id: text("id").primaryKey(),
    selectionId: text("selection_id")
      .notNull()
      .references(() => googleCalendarSelections.id, {
        onDelete: "cascade",
      }),
    googleEventId: text("google_event_id").notNull(),
    googleICalUid: text("google_ical_uid"),
    recurringEventId: text("recurring_event_id"),
    status: text("status").notNull().default("confirmed"),
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),
    htmlLink: text("html_link"),
    meetingUrl: text("meeting_url"),
    startDate: text("start_date"),
    endDateExclusive: text("end_date_exclusive"),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    allDay: integer("all_day", { mode: "boolean" })
      .notNull()
      .default(false),
    timeZone: text("time_zone"),
    visibility: text("visibility").notNull().default("default"),
    transparency: text("transparency").notNull().default("opaque"),
    organizerEmail: text("organizer_email"),
    googleEtag: text("google_etag"),
    googleUpdatedAt: text("google_updated_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("google_calendar_event_unique").on(
      table.selectionId,
      table.googleEventId,
    ),
    index("idx_google_calendar_events_start").on(
      table.selectionId,
      table.status,
      table.startDate,
      table.startsAt,
    ),
    index("idx_google_calendar_events_ical_uid").on(table.googleICalUid),
  ],
)

export const googleCalendarEntityLinks = sqliteTable(
  "google_calendar_entity_links",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => googleCalendarConnections.id, {
        onDelete: "cascade",
      }),
    googleCalendarId: text("google_calendar_id").notNull(),
    googleEventId: text("google_event_id").notNull(),
    googleICalUid: text("google_ical_uid"),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    syncDirection: text("sync_direction").notNull().default("push"),
    syncStatus: text("sync_status").notNull().default("pending"),
    googleEtag: text("google_etag"),
    googleUpdatedAt: text("google_updated_at"),
    compassVersion: integer("compass_version"),
    lastSyncedAt: text("last_synced_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("google_calendar_entity_source_unique").on(
      table.connectionId,
      table.googleCalendarId,
      table.sourceType,
      table.sourceId,
    ),
    uniqueIndex("google_calendar_entity_event_unique").on(
      table.connectionId,
      table.googleCalendarId,
      table.googleEventId,
    ),
    index("idx_google_calendar_entity_sync_status").on(
      table.connectionId,
      table.syncStatus,
    ),
  ],
)

export type WorkCalendarEvent = typeof workCalendarEvents.$inferSelect

export type NewWorkCalendarEvent = typeof workCalendarEvents.$inferInsert

export type OrganizationCalendarSettings =
  typeof organizationCalendarSettings.$inferSelect

export type NewOrganizationCalendarSettings =
  typeof organizationCalendarSettings.$inferInsert

export type WorkCalendarEventAttendee =
  typeof workCalendarEventAttendees.$inferSelect

export type NewWorkCalendarEventAttendee =
  typeof workCalendarEventAttendees.$inferInsert

export type GoogleCalendarConnection =
  typeof googleCalendarConnections.$inferSelect

export type NewGoogleCalendarConnection =
  typeof googleCalendarConnections.$inferInsert

export type GoogleCalendarSelection =
  typeof googleCalendarSelections.$inferSelect

export type NewGoogleCalendarSelection =
  typeof googleCalendarSelections.$inferInsert

export type GoogleCalendarEvent = typeof googleCalendarEvents.$inferSelect

export type NewGoogleCalendarEvent = typeof googleCalendarEvents.$inferInsert

export type GoogleCalendarEntityLink =
  typeof googleCalendarEntityLinks.$inferSelect

export type NewGoogleCalendarEntityLink =
  typeof googleCalendarEntityLinks.$inferInsert
