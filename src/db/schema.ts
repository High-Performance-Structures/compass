import { sql } from "drizzle-orm"
import {
  index,
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

// Auth and user management tables
export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // workos user id
  email: text("email").notNull().unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  dashboardDeskPhotoUrl: text("dashboard_desk_photo_url"),
  sidebarDeskPhotoUrl: text("sidebar_desk_photo_url"),
  role: text("role").notNull().default("office"), // admin, office, field, client
  googleEmail: text("google_email"), // override for google workspace impersonation
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

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
  role: text("role").notNull(),
  joinedAt: text("joined_at").notNull(),
})

export const cherishPulseResponses = sqliteTable("cherish_pulse_responses", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  submittedBy: text("submitted_by").references(() => users.id, {
    onDelete: "set null",
  }),
  submittedByName: text("submitted_by_name"),
  submittedByEmail: text("submitted_by_email"),
  weekStart: text("week_start").notNull(),
  cherishValue: text("cherish_value").notNull(),
  responseType: text("response_type").notNull(),
  message: text("message").notNull(),
  source: text("source").notNull().default("compass_dashboard"),
  visibility: text("visibility").notNull().default("team"),
  reviewStatus: text("review_status").notNull().default("needs_review"),
  reviewedBy: text("reviewed_by").references(() => users.id, {
    onDelete: "set null",
  }),
  reviewedAt: text("reviewed_at"),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const notificationPreferences = sqliteTable("notification_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  inAppEnabled: integer("in_app_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  emailEnabled: integer("email_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  smsEnabled: integer("sms_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  smsPhoneNumber: text("sms_phone_number"),
  smsConsentAccepted: integer("sms_consent_accepted", { mode: "boolean" })
    .notNull()
    .default(false),
  smsConsentAcceptedAt: text("sms_consent_accepted_at"),
  smsConsentDisclosureUrl: text("sms_consent_disclosure_url"),
  smsConsentDisclosureVersion: text("sms_consent_disclosure_version"),
  smsConsentPhoneNumber: text("sms_consent_phone_number"),
  pushEnabled: integer("push_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  mentionEmailEnabled: integer("mention_email_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  mentionSmsEnabled: integer("mention_sms_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  announcementEmailEnabled: integer("announcement_email_enabled", {
    mode: "boolean",
  })
    .notNull()
    .default(true),
  announcementSmsEnabled: integer("announcement_sms_enabled", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  projectActivitySmsEnabled: integer("project_activity_sms_enabled", {
    mode: "boolean",
  })
    .notNull()
    .default(true),
  smsQuietHoursEnabled: integer("sms_quiet_hours_enabled", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  smsQuietHoursStart: text("sms_quiet_hours_start")
    .notNull()
    .default("21:00"),
  smsQuietHoursEnd: text("sms_quiet_hours_end")
    .notNull()
    .default("07:00"),
  weeklyDigestEnabled: integer("weekly_digest_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  rfiEnabled: integer("rfi_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  ownerUpdateEnabled: integer("owner_update_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  scheduleEnabled: integer("schedule_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  poEnabled: integer("po_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  timeZone: text("time_zone").notNull().default("America/Denver"),
  updatedAt: text("updated_at").notNull(),
})

export const notificationEvents = sqliteTable("notification_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  eventType: text("event_type").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  href: text("href").notNull(),
  priority: text("priority").notNull().default("normal"),
  audience: text("audience").notNull().default("internal"),
  createdBy: text("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: text("created_at").notNull(),
})

export const notificationRecipients = sqliteTable("notification_recipients", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => notificationEvents.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  inApp: integer("in_app", { mode: "boolean" }).notNull().default(true),
  email: integer("email", { mode: "boolean" }).notNull().default(false),
  sms: integer("sms", { mode: "boolean" }).notNull().default(false),
  push: integer("push", { mode: "boolean" }).notNull().default(false),
  readAt: text("read_at"),
  dismissedAt: text("dismissed_at"),
  createdAt: text("created_at").notNull(),
})

export const notificationDeliveries = sqliteTable("notification_deliveries", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => notificationEvents.id, { onDelete: "cascade" }),
  recipientId: text("recipient_id")
    .notNull()
    .references(() => notificationRecipients.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  status: text("status").notNull().default("queued"),
  toAddress: text("to_address"),
  provider: text("provider"),
  providerMessageId: text("provider_message_id"),
  error: text("error"),
  attemptedAt: text("attempted_at"),
  createdAt: text("created_at").notNull(),
})

export const emailReplyThreads = sqliteTable(
  "email_reply_threads",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    channelId: text("channel_id"),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    sourceNumber: text("source_number"),
    replyToAddress: text("reply_to_address").notNull(),
    subject: text("subject").notNull(),
    status: text("status").notNull().default("active"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    lastInboundAt: text("last_inbound_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("email_reply_threads_token_idx").on(table.token),
    index("email_reply_threads_org_project_idx").on(
      table.organizationId,
      table.projectId
    ),
    index("email_reply_threads_source_idx").on(table.sourceType, table.sourceId),
  ]
)

export const inboundEmails = sqliteTable(
  "inbound_emails",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    replyThreadId: text("reply_thread_id").references(
      () => emailReplyThreads.id,
      { onDelete: "set null" }
    ),
    token: text("token"),
    gmailMessageId: text("gmail_message_id").notNull(),
    gmailThreadId: text("gmail_thread_id"),
    messageIdHeader: text("message_id_header"),
    inReplyToHeader: text("in_reply_to_header"),
    referencesHeader: text("references_header"),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    toAddress: text("to_address"),
    subject: text("subject").notNull(),
    textBody: text("text_body"),
    htmlBody: text("html_body"),
    snippet: text("snippet"),
    matchedStatus: text("matched_status").notNull().default("needs_review"),
    postedMessageId: text("posted_message_id"),
    receivedAt: text("received_at").notNull(),
    importedAt: text("imported_at").notNull(),
  },
  (table) => [
    uniqueIndex("inbound_emails_gmail_message_id_idx").on(table.gmailMessageId),
    index("inbound_emails_org_project_idx").on(
      table.organizationId,
      table.projectId
    ),
    index("inbound_emails_reply_thread_idx").on(table.replyThreadId),
    index("inbound_emails_status_idx").on(table.matchedStatus),
  ]
)

export const organizationInvites = sqliteTable("organization_invites", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  role: text("role").notNull().default("office"),
  maxUses: integer("max_uses"),
  useCount: integer("use_count").notNull().default(0),
  expiresAt: text("expires_at"),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
})

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: text("created_at").notNull(),
})

export const teamMembers = sqliteTable("team_members", {
  id: text("id").primaryKey(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  joinedAt: text("joined_at").notNull(),
})

export const rolePermissionOverrides = sqliteTable(
  "role_permission_overrides",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
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
    role: text("role"),
    teamId: text("team_id").references(() => teams.id, {
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
})

export const groupMembers = sqliteTable("group_members", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  joinedAt: text("joined_at").notNull(),
})

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  projectNumber: text("project_number"),
  name: text("name").notNull(),
  status: text("status").notNull().default("OPEN"),
  // `address` remains the project/site address for compatibility with existing data.
  address: text("address"),
  mailingAddress: text("mailing_address"),
  clientStatus: text("client_status").notNull().default("customer"),
  jobStatusId: text("job_status_id").notNull().default("current"),
  clientName: text("client_name"),
  projectManager: text("project_manager"),
  organizationId: text("organization_id").references(() => organizations.id),
  netsuiteJobId: text("netsuite_job_id"),
  sageJobId: text("sage_job_id"),
  sageJobNumber: text("sage_job_number"),
  googleDriveFolderId: text("google_drive_folder_id"),
  googleScheduleSheetId: text("google_schedule_sheet_id"),
  googleDailyLogSheetId: text("google_daily_log_sheet_id"),
  googleCalendarId: text("google_calendar_id"),
  buildertrendProjectId: text("buildertrend_project_id"),
  ownerUpdatesEnabled: integer("owner_updates_enabled", {
    mode: "boolean",
  }).notNull().default(true),
  ownerUpdateChannel: text("owner_update_channel").notNull().default("compass"),
  ownerUpdateCadence: text("owner_update_cadence").notNull().default("weekly"),
  ownerScheduleView: text("owner_schedule_view").notNull().default("items"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
})

export const projectNumberReservations = sqliteTable(
  "project_number_reservations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    department: text("department").notNull(),
    sequence: integer("sequence").notNull(),
    projectNumber: text("project_number").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_number_reservations_org_department_sequence_unique").on(
      table.organizationId,
      table.department,
      table.sequence
    ),
    uniqueIndex("project_number_reservations_org_number_unique").on(
      table.organizationId,
      table.projectNumber
    ),
  ]
)

export const projectNumberAliases = sqliteTable(
  "project_number_aliases",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    projectNumber: text("project_number").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_number_aliases_org_number_unique").on(
      table.organizationId,
      table.projectNumber,
    ),
  ],
)

export const projectJobStatuses = sqliteTable(
  "project_job_statuses",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    sageCode: text("sage_code"),
    followUpCadenceDays: integer("follow_up_cadence_days"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(1000),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_job_statuses_org_label_unique").on(
      table.organizationId,
      table.label,
    ),
    index("project_job_statuses_org_active_idx").on(
      table.organizationId,
      table.active,
      table.sortOrder,
    ),
  ],
)

export const projectJobStatusLabelKeys = sqliteTable(
  "project_job_status_label_keys",
  {
    statusId: text("status_id")
      .primaryKey()
      .references(() => projectJobStatuses.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    normalizedLabel: text("normalized_label").notNull(),
  },
  (table) => [
    uniqueIndex("project_job_status_label_keys_org_normalized_unique").on(
      table.organizationId,
      table.normalizedLabel,
    ),
  ],
)

export const projectJobStatusLabelConflicts = sqliteTable(
  "project_job_status_label_conflicts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    normalizedLabel: text("normalized_label").notNull(),
    retainedStatusId: text("retained_status_id").notNull(),
    retainedLabel: text("retained_label").notNull(),
    discardedStatusId: text("discarded_status_id").notNull(),
    discardedLabel: text("discarded_label").notNull(),
    discardedSageCode: text("discarded_sage_code"),
    discardedFollowUpCadenceDays: integer("discarded_follow_up_cadence_days"),
    discardedActive: integer("discarded_active", { mode: "boolean" }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("project_job_status_label_conflicts_org_idx").on(table.organizationId),
    uniqueIndex("project_job_status_label_conflicts_discarded_unique").on(
      table.discardedStatusId,
    ),
  ],
)

export const projectProfileAuditEvents = sqliteTable(
  "project_profile_audit_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("project_profile_audit_events_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
)

export const projectProfileSyncOperations = sqliteTable(
  "project_profile_sync_operations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    status: text("status").notNull().default("pending"),
    payloadJson: text("payload_json").notNull(),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    attemptedAt: text("attempted_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("project_profile_sync_operations_project_status_idx").on(
      table.projectId,
      table.status,
      table.createdAt,
    ),
  ],
)

export const projectFollowUps = sqliteTable("project_follow_ups", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  nextFollowUpAt: text("next_follow_up_at").notNull(),
  ownerUserId: text("owner_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdBy: text("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const activityEvents = sqliteTable(
  "activity_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name").notNull(),
    actorRole: text("actor_role").notNull(),
    category: text("category").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    metadata: text("metadata"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("activity_events_org_created_idx").on(
      table.organizationId,
      table.createdAt
    ),
    index("activity_events_project_created_idx").on(
      table.projectId,
      table.createdAt
    ),
    index("activity_events_actor_created_idx").on(
      table.actorUserId,
      table.createdAt
    ),
  ]
)

export type ActivityEvent = typeof activityEvents.$inferSelect
export type NewActivityEvent = typeof activityEvents.$inferInsert

export const staffMessageRecords = sqliteTable(
  "staff_message_records",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    gotoInboundEventId: text("goto_inbound_event_id").references(
      () => gotoInboundEvents.id,
      { onDelete: "set null" }
    ),
    callerName: text("caller_name").notNull(),
    callerCompany: text("caller_company"),
    callerPhone: text("caller_phone"),
    callerEmail: text("caller_email"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    assigneeUserId: text("assignee_user_id")
      .notNull()
      .references(() => users.id),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("staff_message_records_goto_event_unique")
      .on(table.gotoInboundEventId)
      .where(
        sql`${table.gotoInboundEventId} IS NOT NULL`
      ),
    index("staff_message_records_org_created_idx").on(
      table.organizationId,
      table.createdAt
    ),
    index("staff_message_records_assignee_created_idx").on(
      table.assigneeUserId,
      table.createdAt
    ),
  ]
)

export type StaffMessageRecord = typeof staffMessageRecords.$inferSelect
export type NewStaffMessageRecord = typeof staffMessageRecords.$inferInsert

export const gotoInboundEvents = sqliteTable(
  "goto_inbound_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    messageId: text("message_id").notNull(),
    accountKey: text("account_key").notNull(),
    ownerTouchpoint: text("owner_touchpoint").notNull(),
    senderPhone: text("sender_phone").notNull(),
    conversationId: text("conversation_id"),
    messageBody: text("message_body"),
    attachmentMetadata: text("attachment_metadata"),
    reviewReason: text("review_reason"),
    status: text("status").notNull().default("received"),
    error: text("error"),
    receivedAt: text("received_at").notNull(),
    processedAt: text("processed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("goto_inbound_events_message_unique").on(table.messageId),
    index("goto_inbound_events_org_status_idx").on(
      table.organizationId,
      table.status,
      table.receivedAt
    ),
  ]
)

export type GotoInboundEvent = typeof gotoInboundEvents.$inferSelect
export type NewGotoInboundEvent = typeof gotoInboundEvents.$inferInsert

export const gotoInboundSettings = sqliteTable(
  "goto_inbound_settings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountKey: text("account_key").notNull(),
    channelId: text("channel_id").notNull(),
    channelNickname: text("channel_nickname").notNull(),
    subscriptionId: text("subscription_id"),
    configuredBy: text("configured_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("goto_inbound_settings_org_unique").on(table.organizationId),
    uniqueIndex("goto_inbound_settings_account_unique").on(table.accountKey),
  ]
)

export type GotoInboundSetting = typeof gotoInboundSettings.$inferSelect
export type NewGotoInboundSetting = typeof gotoInboundSettings.$inferInsert

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

export const userSchedulePreferences = sqliteTable("user_schedule_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  ganttScrollMode: text("gantt_scroll_mode").notNull().default("default"),
  updatedAt: text("updated_at").notNull(),
})

export const scheduleSavedViews = sqliteTable(
  "schedule_saved_views",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    visibility: text("visibility").notNull().default("personal"),
    definition: text("definition").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("schedule_saved_views_org_idx").on(table.organizationId),
    index("schedule_saved_views_owner_idx").on(table.ownerUserId),
    uniqueIndex("schedule_saved_views_owner_name_unique").on(
      table.ownerUserId,
      table.name
    ),
  ]
)

export type ScheduleSavedView = typeof scheduleSavedViews.$inferSelect
export type NewScheduleSavedView = typeof scheduleSavedViews.$inferInsert

export const schedulePhaseOptions = sqliteTable(
  "schedule_phase_options",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("schedule_phase_options_org_name_unique").on(
      table.organizationId,
      table.normalizedName
    ),
    index("schedule_phase_options_org_name_idx").on(
      table.organizationId,
      table.name
    ),
  ]
)

export type SchedulePhaseOption = typeof schedulePhaseOptions.$inferSelect
export type NewSchedulePhaseOption = typeof schedulePhaseOptions.$inferInsert

export const projectExternalLinks = sqliteTable("project_external_links", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  system: text("system").notNull(),
  label: text("label").notNull(),
  externalId: text("external_id"),
  externalNumber: text("external_number"),
  externalUrl: text("external_url"),
  syncDirection: text("sync_direction").notNull().default("read"),
  syncStatus: text("sync_status").notNull().default("unmapped"),
  metadata: text("metadata"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

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
})

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
})

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
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const projectOperations = sqliteTable("project_operations", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sourceSystem: text("source_system").notNull().default("sage"),
  sourceRecordType: text("source_record_type").notNull(),
  sourceRecordId: text("source_record_id"),
  sourceRecordNumber: text("source_record_number"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("normal"),
  assigneeType: text("assignee_type"),
  assigneeName: text("assignee_name"),
  companyName: text("company_name"),
  costCode: text("cost_code"),
  startDate: text("start_date"),
  dueDate: text("due_date"),
  amount: real("amount"),
  externalUrl: text("external_url"),
  sageJobId: text("sage_job_id"),
  sageJobNumber: text("sage_job_number"),
  sageVendorId: text("sage_vendor_id"),
  sageVendorName: text("sage_vendor_name"),
  sagePhaseCode: text("sage_phase_code"),
  sageCostCode: text("sage_cost_code"),
  sageTaxGroup: text("sage_tax_group"),
  sageShipTo: text("sage_ship_to"),
  sageOrderDate: text("sage_order_date"),
  sageRequiredDate: text("sage_required_date"),
  sageWriteStatus: text("sage_write_status").notNull().default("not_ready"),
  sagePayloadJson: text("sage_payload_json"),
  syncDirection: text("sync_direction").notNull().default("read"),
  syncStatus: text("sync_status").notNull().default("synced"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

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
    eventType: text("event_type").notNull().default("meeting"),
    visibility: text("visibility").notNull().default("organization"),
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

export const projectPurchaseOrderLines = sqliteTable("project_purchase_order_lines", {
  id: text("id").primaryKey(),
  operationId: text("operation_id")
    .notNull()
    .references(() => projectOperations.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sourceSystem: text("source_system").notNull().default("compass"),
  sourceRecordId: text("source_record_id"),
  lineNumber: integer("line_number").notNull().default(1),
  costCode: text("cost_code"),
  phaseCode: text("phase_code"),
  description: text("description").notNull(),
  quantity: real("quantity").notNull().default(1),
  unitCost: real("unit_cost").notNull().default(0),
  unit: text("unit"),
  amount: real("amount").notNull().default(0),
  taxGroup: text("tax_group"),
  sagePayloadJson: text("sage_payload_json"),
  syncStatus: text("sync_status").notNull().default("pending_sage"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const projectFinishSelections = sqliteTable("project_finish_selections", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sourceSystem: text("source_system").notNull().default("compass"),
  sourceRecordId: text("source_record_id"),
  sourceWorkbookId: text("source_workbook_id"),
  sourceSheetName: text("source_sheet_name"),
  roomName: text("room_name").notNull(),
  roomType: text("room_type"),
  category: text("category").notNull().default("Uncategorized"),
  name: text("name").notNull(),
  description: text("description"),
  quantity: real("quantity"),
  manufacturer: text("manufacturer"),
  model: text("model"),
  colorFinish: text("color_finish"),
  choiceOptionsJson: text("choice_options_json"),
  parentSelectionId: text("parent_selection_id"),
  parentChoiceValue: text("parent_choice_value"),
  selectionLevel: integer("selection_level").notNull().default(0),
  supplierName: text("supplier_name"),
  productUrl: text("product_url"),
  costCode: text("cost_code"),
  phaseCode: text("phase_code"),
  status: text("status").notNull().default("needed"),
  ownerVisible: integer("owner_visible", { mode: "boolean" })
    .notNull()
    .default(false),
  ownerApproved: integer("owner_approved", { mode: "boolean" })
    .notNull()
    .default(false),
  approvedBy: text("approved_by"),
  approvedAt: text("approved_at"),
  rfqOperationId: text("rfq_operation_id").references(() => projectOperations.id, {
    onDelete: "set null",
  }),
  purchaseOrderOperationId: text("purchase_order_operation_id").references(
    () => projectOperations.id,
    { onDelete: "set null" }
  ),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  syncStatus: text("sync_status").notNull().default("manual"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const projectFinishSelectionRooms = sqliteTable("project_finish_selection_rooms", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sourceSystem: text("source_system").notNull().default("compass"),
  sourceWorkbookId: text("source_workbook_id"),
  sourceSheetId: text("source_sheet_id"),
  sourceSheetName: text("source_sheet_name"),
  roomName: text("room_name").notNull(),
  roomType: text("room_type"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const projectBudgetApplications = sqliteTable("project_budget_applications", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sourceSystem: text("source_system").notNull().default("sage"),
  sourceRecordId: text("source_record_id"),
  applicationNumber: text("application_number").notNull(),
  periodTo: text("period_to"),
  status: text("status").notNull().default("current"),
  originalContractSum: real("original_contract_sum").notNull().default(0),
  netChanges: real("net_changes").notNull().default(0),
  contractSumToDate: real("contract_sum_to_date").notNull().default(0),
  totalCompletedStoredToDate: real("total_completed_stored_to_date")
    .notNull()
    .default(0),
  retainageHeld: real("retainage_held").notNull().default(0),
  totalEarnedLessRetainage: real("total_earned_less_retainage")
    .notNull()
    .default(0),
  previousCertificates: real("previous_certificates").notNull().default(0),
  currentPaymentDue: real("current_payment_due").notNull().default(0),
  balanceToFinish: real("balance_to_finish").notNull().default(0),
  ownerVisible: integer("owner_visible", { mode: "boolean" })
    .notNull()
    .default(false),
  sourceUrl: text("source_url"),
  budgetRevisionId: text("budget_revision_id"),
  syncStatus: text("sync_status").notNull().default("synced"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const projectBudgetLines = sqliteTable("project_budget_lines", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  applicationId: text("application_id").references(
    () => projectBudgetApplications.id,
    { onDelete: "set null" }
  ),
  budgetRevisionLineId: text("budget_revision_line_id"),
  sourceSystem: text("source_system").notNull().default("sage"),
  sourceRecordId: text("source_record_id"),
  sourceRecordNumber: text("source_record_number"),
  costCode: text("cost_code").notNull(),
  csiDivision: text("csi_division").notNull(),
  csiDivisionName: text("csi_division_name").notNull(),
  description: text("description").notNull(),
  notes: text("notes"),
  originalEstimate: real("original_estimate").notNull().default(0),
  priorChanges: real("prior_changes").notNull().default(0),
  currentChanges: real("current_changes").notNull().default(0),
  totalChanges: real("total_changes").notNull().default(0),
  adjustedEstimate: real("adjusted_estimate").notNull().default(0),
  previousWorkCompleted: real("previous_work_completed").notNull().default(0),
  currentWorkCompleted: real("current_work_completed").notNull().default(0),
  storedMaterials: real("stored_materials").notNull().default(0),
  priorCosts: real("prior_costs").notNull().default(0),
  currentCosts: real("current_costs").notNull().default(0),
  totalCosts: real("total_costs").notNull().default(0),
  percentComplete: real("percent_complete").notNull().default(0),
  balanceToFinish: real("balance_to_finish").notNull().default(0),
  retainageHeld: real("retainage_held").notNull().default(0),
  vendorName: text("vendor_name"),
  ownerLabel: text("owner_label"),
  ownerVisible: integer("owner_visible", { mode: "boolean" })
    .notNull()
    .default(false),
  internalNotes: text("internal_notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  syncStatus: text("sync_status").notNull().default("synced"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const projectRfis = sqliteTable("project_rfis", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sourceSystem: text("source_system").notNull().default("compass"),
  sourceRecordId: text("source_record_id"),
  rfiNumber: text("rfi_number").notNull(),
  subject: text("subject").notNull(),
  question: text("question").notNull(),
  answer: text("answer"),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("normal"),
  audience: text("audience").notNull().default("internal"),
  requesterName: text("requester_name"),
  assignedToName: text("assigned_to_name"),
  companyName: text("company_name"),
  dueDate: text("due_date"),
  submittedAt: text("submitted_at").notNull(),
  answeredAt: text("answered_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const projectRfiAttachments = sqliteTable("project_rfi_attachments", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  rfiId: text("rfi_id")
    .notNull()
    .references(() => projectRfis.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),
  fileSize: integer("file_size").notNull().default(0),
  storageProvider: text("storage_provider").notNull().default("google_drive"),
  storageId: text("storage_id"),
  storageUrl: text("storage_url"),
  storageStatus: text("storage_status").notNull().default("uploaded"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const projectChangeOrders = sqliteTable(
  "project_change_orders",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    changeOrderNumber: text("change_order_number").notNull(),
    title: text("title").notNull(),
    scope: text("scope").notNull(),
    reason: text("reason"),
    amountCents: integer("amount_cents"),
    scheduleImpactDays: integer("schedule_impact_days"),
    status: text("status").notNull().default("draft"),
    audience: text("audience").notNull().default("internal"),
    requesterType: text("requester_type").notNull(),
    requesterUserId: text("requester_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    requesterName: text("requester_name").notNull(),
    requesterCompany: text("requester_company"),
    sourceType: text("source_type").notNull(),
    sourceRecordId: text("source_record_id"),
    sourceHref: text("source_href"),
    internalNotes: text("internal_notes"),
    foxitStatus: text("foxit_status").notNull().default("not_started"),
    foxitEnvelopeId: text("foxit_envelope_id"),
    signatureRequestedAt: text("signature_requested_at"),
    executedAt: text("executed_at"),
    sageStatus: text("sage_status").notNull().default("not_ready"),
    sageRecordId: text("sage_record_id"),
    lastSageSyncAt: text("last_sage_sync_at"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    submittedAt: text("submitted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_change_orders_project_number_uq").on(
      table.projectId,
      table.changeOrderNumber
    ),
    index("project_change_orders_project_status_idx").on(
      table.projectId,
      table.status
    ),
    index("project_change_orders_requester_idx").on(
      table.projectId,
      table.requesterUserId
    ),
  ]
)

export const projectChangeOrderLines = sqliteTable(
  "project_change_order_lines",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    changeOrderId: text("change_order_id")
      .notNull()
      .references(() => projectChangeOrders.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),
    description: text("description").notNull(),
    phaseCode: text("phase_code"),
    costCode: text("cost_code"),
    amountCents: integer("amount_cents"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_change_order_lines_order_uq").on(
      table.changeOrderId,
      table.lineNumber
    ),
    index("project_change_order_lines_project_idx").on(table.projectId),
    index("project_change_order_lines_cost_code_idx").on(
      table.projectId,
      table.costCode
    ),
  ]
)

export const projectChangeOrderDocuments = sqliteTable(
  "project_change_order_documents",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    changeOrderId: text("change_order_id")
      .notNull()
      .references(() => projectChangeOrders.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    url: text("url").notNull(),
    notes: text("notes"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("project_change_order_documents_order_idx").on(table.changeOrderId),
    index("project_change_order_documents_project_idx").on(table.projectId),
  ]
)

export const projectChangeOrderHistory = sqliteTable(
  "project_change_order_history",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    changeOrderId: text("change_order_id")
      .notNull()
      .references(() => projectChangeOrders.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name").notNull(),
    actorRole: text("actor_role").notNull(),
    note: text("note"),
    metadataJson: text("metadata_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("project_change_order_history_order_idx").on(
      table.changeOrderId,
      table.createdAt
    ),
    index("project_change_order_history_project_idx").on(table.projectId),
  ]
)

export const projectContacts = sqliteTable("project_contacts", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  contactType: text("contact_type").notNull(), // owner, supplier, subcontractor, internal
  sourceSystem: text("source_system").notNull().default("compass"),
  sourceRecordId: text("source_record_id"),
  sourceEntityType: text("source_entity_type").notNull().default("manual"),
  sourceEntityId: text("source_entity_id"),
  displayName: text("display_name").notNull(),
  companyName: text("company_name"),
  role: text("role"),
  trade: text("trade"),
  csiDivision: text("csi_division"),
  csiDivisionName: text("csi_division_name"),
  primaryCostCode: text("primary_cost_code"),
  email: text("email"),
  phone: text("phone"),
  notes: text("notes"),
  ownerPortalVisible: integer("owner_portal_visible", {
    mode: "boolean",
  }).notNull().default(false),
  subVendorPortalVisible: integer("sub_vendor_portal_visible", {
    mode: "boolean",
  }).notNull().default(false),
  internalVisible: integer("internal_visible", {
    mode: "boolean",
  }).notNull().default(true),
  primaryContact: integer("primary_contact", {
    mode: "boolean",
  }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  syncStatus: text("sync_status").notNull().default("synced"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const projectNotes = sqliteTable(
  "project_notes",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    deletedBy: text("deleted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("project_notes_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
)

export const projectInteractions = sqliteTable(
  "project_interactions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    projectContactId: text("project_contact_id").references(
      () => projectContacts.id,
      { onDelete: "set null" },
    ),
    interactionType: text("interaction_type").notNull(),
    direction: text("direction").notNull(),
    source: text("source").notNull().default("manual"),
    qualifiesForClientTouch: integer("qualifies_for_client_touch", {
      mode: "boolean",
    }).notNull().default(false),
    summary: text("summary").notNull(),
    occurredAt: text("occurred_at").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    deletedBy: text("deleted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("project_interactions_project_occurred_idx").on(
      table.projectId,
      table.occurredAt,
    ),
    index("project_interactions_org_occurred_idx").on(
      table.organizationId,
      table.occurredAt,
    ),
  ],
)

export const projectContactSourceLinks = sqliteTable("project_contact_source_links", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  projectContactId: text("project_contact_id").references(
    () => projectContacts.id,
    { onDelete: "set null" }
  ),
  sourceSystem: text("source_system").notNull(),
  sourceRecordType: text("source_record_type").notNull(),
  sourceRecordId: text("source_record_id").notNull(),
  sourceRecordNumber: text("source_record_number"),
  sourceLabel: text("source_label").notNull(),
  sourceName: text("source_name").notNull(),
  matchStatus: text("match_status").notNull().default("unmatched"),
  matchConfidence: real("match_confidence").notNull().default(0),
  matchReason: text("match_reason"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const projectMembers = sqliteTable("project_members", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  assignedAt: text("assigned_at").notNull(),
})

export const projectAccessInvitations = sqliteTable(
  "project_access_invitations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    projectContactId: text("project_contact_id").references(
      () => projectContacts.id,
      { onDelete: "set null" }
    ),
    email: text("email").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("sent"),
    workosInvitationId: text("workos_invitation_id"),
    workosExpiresAt: text("workos_expires_at"),
    emailProvider: text("email_provider"),
    emailProviderMessageId: text("email_provider_message_id"),
    emailError: text("email_error"),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    invitedAt: text("invited_at").notNull(),
    acceptedBy: text("accepted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    acceptedAt: text("accepted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_project_access_invites_project").on(table.projectId),
    index("idx_project_access_invites_email").on(table.email),
    index("idx_project_access_invites_status").on(table.status),
  ]
)

export const scheduleTasks = sqliteTable("schedule_tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  startDate: text("start_date").notNull(),
  workdays: integer("workdays").notNull(),
  endDateCalculated: text("end_date_calculated").notNull(),
  phase: text("phase").notNull(),
  displayColor: text("display_color").notNull().default("blue"),
  status: text("status").notNull().default("PENDING"),
  isCriticalPath: integer("is_critical_path", { mode: "boolean" })
    .notNull()
    .default(false),
  isMilestone: integer("is_milestone", { mode: "boolean" })
    .notNull()
    .default(false),
  percentComplete: integer("percent_complete").notNull().default(0),
  assignedTo: text("assigned_to"),
  assignedUserId: text("assigned_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  ownerVisible: integer("owner_visible", { mode: "boolean" })
    .notNull()
    .default(true),
  subVendorVisible: integer("sub_vendor_visible", { mode: "boolean" })
    .notNull()
    .default(false),
  confirmationRequired: integer("confirmation_required", { mode: "boolean" })
    .notNull()
    .default(false),
  confirmationStatus: text("confirmation_status")
    .notNull()
    .default("not_requested"),
  confirmationRequestedAt: text("confirmation_requested_at"),
  confirmationRespondedAt: text("confirmation_responded_at"),
  reminderSentAt: text("reminder_sent_at"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const scheduleTaskLinks = sqliteTable(
  "schedule_task_links",
  {
    id: text("id").primaryKey(),
    scheduleTaskId: text("schedule_task_id")
      .notNull()
      .references(() => scheduleTasks.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    label: text("label").notNull(),
    href: text("href").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_schedule_task_links_task").on(table.scheduleTaskId),
    index("idx_schedule_task_links_project_type").on(
      table.projectId,
      table.resourceType
    ),
  ]
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
})

export const taskDependencies = sqliteTable("task_dependencies", {
  id: text("id").primaryKey(),
  predecessorId: text("predecessor_id")
    .notNull()
    .references(() => scheduleTasks.id, { onDelete: "cascade" }),
  successorId: text("successor_id")
    .notNull()
    .references(() => scheduleTasks.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("FS"),
  lagDays: integer("lag_days").notNull().default(0),
})

export const workdayExceptions = sqliteTable("workday_exceptions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  type: text("type").notNull().default("non_working"),
  category: text("category").notNull().default("company_holiday"),
  recurrence: text("recurrence").notNull().default("one_time"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const scheduleBaselines = sqliteTable("schedule_baselines", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  snapshotData: text("snapshot_data").notNull(),
  createdAt: text("created_at").notNull(),
})

export const schedulePublications = sqliteTable(
  "schedule_publications",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    snapshotData: text("snapshot_data").notNull(),
    changeReason: text("change_reason").notNull(),
    publishedBy: text("published_by").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedAt: text("published_at").notNull(),
  },
  (table) => [
    index("idx_schedule_publications_project_published").on(
      table.projectId,
      table.publishedAt
    ),
  ]
)

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  company: text("company"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  notes: text("notes"),
  netsuiteId: text("netsuite_id"),
  organizationId: text("organization_id").references(() => organizations.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
})

export const vendors = sqliteTable("vendors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull().default("Subcontractor"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  netsuiteId: text("netsuite_id"),
  sourceSystem: text("source_system").notNull().default("manual"),
  sourceRecordId: text("source_record_id"),
  sourceRecordNumber: text("source_record_number"),
  sourceMetadata: text("source_metadata"),
  directoryStatus: text("directory_status").notNull().default("active"),
  syncStatus: text("sync_status").notNull().default("manual"),
  lastSyncedAt: text("last_synced_at"),
  organizationId: text("organization_id").references(() => organizations.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
})

export const sageCostCodes = sqliteTable("sage_cost_codes", {
  id: text("id").primaryKey(),
  sourceSystem: text("source_system").notNull().default("sage"),
  sourceRecordId: text("source_record_id"),
  sourceRecordNumber: text("source_record_number"),
  code: text("code").notNull(),
  description: text("description").notNull(),
  displayLabel: text("display_label").notNull(),
  divisionCode: text("division_code").notNull(),
  divisionDescription: text("division_description").notNull(),
  divisionDisplayLabel: text("division_display_label").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  syncStatus: text("sync_status").notNull().default("synced"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export type Project = typeof projects.$inferSelect
export type ProjectExternalLink = typeof projectExternalLinks.$inferSelect
export type NewProjectExternalLink = typeof projectExternalLinks.$inferInsert
export type DailyLog = typeof dailyLogs.$inferSelect
export type NewDailyLog = typeof dailyLogs.$inferInsert
export type DailyLogPhoto = typeof dailyLogPhotos.$inferSelect
export type NewDailyLogPhoto = typeof dailyLogPhotos.$inferInsert
export type DailyLogTaskLink = typeof dailyLogTaskLinks.$inferSelect
export type NewDailyLogTaskLink = typeof dailyLogTaskLinks.$inferInsert
export type OwnerProjectUpdate = typeof ownerProjectUpdates.$inferSelect
export type NewOwnerProjectUpdate = typeof ownerProjectUpdates.$inferInsert
export type ProjectOperation = typeof projectOperations.$inferSelect
export type NewProjectOperation = typeof projectOperations.$inferInsert
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
export type GoogleCalendarEntityLink =
  typeof googleCalendarEntityLinks.$inferSelect
export type NewGoogleCalendarEntityLink =
  typeof googleCalendarEntityLinks.$inferInsert
export type ProjectPurchaseOrderLine =
  typeof projectPurchaseOrderLines.$inferSelect
export type NewProjectPurchaseOrderLine =
  typeof projectPurchaseOrderLines.$inferInsert
export type ProjectFinishSelection =
  typeof projectFinishSelections.$inferSelect
export type NewProjectFinishSelection =
  typeof projectFinishSelections.$inferInsert
export type ProjectFinishSelectionRoom =
  typeof projectFinishSelectionRooms.$inferSelect
export type NewProjectFinishSelectionRoom =
  typeof projectFinishSelectionRooms.$inferInsert
export type ProjectBudgetApplication =
  typeof projectBudgetApplications.$inferSelect
export type NewProjectBudgetApplication =
  typeof projectBudgetApplications.$inferInsert
export type ProjectBudgetLine = typeof projectBudgetLines.$inferSelect
export type NewProjectBudgetLine = typeof projectBudgetLines.$inferInsert
export type ProjectRfi = typeof projectRfis.$inferSelect
export type NewProjectRfi = typeof projectRfis.$inferInsert
export type ProjectRfiAttachment = typeof projectRfiAttachments.$inferSelect
export type NewProjectRfiAttachment = typeof projectRfiAttachments.$inferInsert
export type ProjectChangeOrder = typeof projectChangeOrders.$inferSelect
export type NewProjectChangeOrder = typeof projectChangeOrders.$inferInsert
export type ProjectChangeOrderLine =
  typeof projectChangeOrderLines.$inferSelect
export type NewProjectChangeOrderLine =
  typeof projectChangeOrderLines.$inferInsert
export type ProjectChangeOrderDocument =
  typeof projectChangeOrderDocuments.$inferSelect
export type NewProjectChangeOrderDocument =
  typeof projectChangeOrderDocuments.$inferInsert
export type ProjectChangeOrderHistory =
  typeof projectChangeOrderHistory.$inferSelect
export type NewProjectChangeOrderHistory =
  typeof projectChangeOrderHistory.$inferInsert
export type ProjectContact = typeof projectContacts.$inferSelect
export type NewProjectContact = typeof projectContacts.$inferInsert
export type ProjectContactSourceLink =
  typeof projectContactSourceLinks.$inferSelect
export type NewProjectContactSourceLink =
  typeof projectContactSourceLinks.$inferInsert
export type ScheduleTask = typeof scheduleTasks.$inferSelect
export type NewScheduleTask = typeof scheduleTasks.$inferInsert
export type TaskDependency = typeof taskDependencies.$inferSelect
export type NewTaskDependency = typeof taskDependencies.$inferInsert
export type WorkdayException = typeof workdayExceptions.$inferSelect
export type NewWorkdayException = typeof workdayExceptions.$inferInsert
export type ScheduleBaseline = typeof scheduleBaselines.$inferSelect
export type NewScheduleBaseline = typeof scheduleBaselines.$inferInsert
export type SchedulePublication = typeof schedulePublications.$inferSelect
export type NewSchedulePublication = typeof schedulePublications.$inferInsert
export type Customer = typeof customers.$inferSelect
export type NewCustomer = typeof customers.$inferInsert
export type SageCostCode = typeof sageCostCodes.$inferSelect
export type NewSageCostCode = typeof sageCostCodes.$inferInsert
export const feedback = sqliteTable("feedback", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  name: text("name"),
  email: text("email"),
  pageUrl: text("page_url"),
  userAgent: text("user_agent"),
  viewportWidth: integer("viewport_width"),
  viewportHeight: integer("viewport_height"),
  ipHash: text("ip_hash"),
  githubIssueUrl: text("github_issue_url"),
  createdAt: text("created_at").notNull(),
})

export type Vendor = typeof vendors.$inferSelect
export type NewVendor = typeof vendors.$inferInsert
export type Feedback = typeof feedback.$inferSelect
export type NewFeedback = typeof feedback.$inferInsert

// Auth and user management types
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert
export type OrganizationMember = typeof organizationMembers.$inferSelect
export type NewOrganizationMember = typeof organizationMembers.$inferInsert
export type NotificationPreference =
  typeof notificationPreferences.$inferSelect
export type NewNotificationPreference =
  typeof notificationPreferences.$inferInsert
export type NotificationEvent = typeof notificationEvents.$inferSelect
export type NewNotificationEvent = typeof notificationEvents.$inferInsert
export type NotificationRecipient =
  typeof notificationRecipients.$inferSelect
export type NewNotificationRecipient =
  typeof notificationRecipients.$inferInsert
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect
export type NewNotificationDelivery =
  typeof notificationDeliveries.$inferInsert
export type EmailReplyThread = typeof emailReplyThreads.$inferSelect
export type NewEmailReplyThread = typeof emailReplyThreads.$inferInsert
export type InboundEmail = typeof inboundEmails.$inferSelect
export type NewInboundEmail = typeof inboundEmails.$inferInsert
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
export type ProjectMember = typeof projectMembers.$inferSelect
export type NewProjectMember = typeof projectMembers.$inferInsert
export type ProjectAccessInvitation =
  typeof projectAccessInvitations.$inferSelect
export type NewProjectAccessInvitation =
  typeof projectAccessInvitations.$inferInsert

// Agent memory tables for ElizaOS
export const agentConversations = sqliteTable("agent_conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  lastMessageAt: text("last_message_at").notNull(),
  createdAt: text("created_at").notNull(),
})

export const agentMemories = sqliteTable("agent_memories", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => agentConversations.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  embedding: text("embedding"), // JSON array of floats for vector search
  metadata: text("metadata"), // JSON object for action results, ui specs, etc.
  createdAt: text("created_at").notNull(),
})

export type AgentConversation = typeof agentConversations.$inferSelect
export type NewAgentConversation = typeof agentConversations.$inferInsert
export type AgentMemory = typeof agentMemories.$inferSelect
export type NewAgentMemory = typeof agentMemories.$inferInsert

// Feedback interview table for UX research
export const feedbackInterviews = sqliteTable("feedback_interviews", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  userName: text("user_name").notNull(),
  userRole: text("user_role").notNull(),
  responses: text("responses").notNull(),
  summary: text("summary").notNull(),
  painPoints: text("pain_points"),
  featureRequests: text("feature_requests"),
  overallSentiment: text("overall_sentiment").notNull(),
  githubIssueUrl: text("github_issue_url"),
  conversationId: text("conversation_id"),
  createdAt: text("created_at").notNull(),
})

export type FeedbackInterview = typeof feedbackInterviews.$inferSelect
export type NewFeedbackInterview = typeof feedbackInterviews.$inferInsert

// Slab persistent memory
export const slabMemories = sqliteTable("slab_memories", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  memoryType: text("memory_type").notNull(), // preference | workflow | fact | decision
  tags: text("tags"), // comma-separated, lowercase
  importance: real("importance").notNull().default(0.7),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  accessCount: integer("access_count").notNull().default(0),
  lastAccessedAt: text("last_accessed_at"),
  createdAt: text("created_at").notNull(),
})

export type SlabMemory = typeof slabMemories.$inferSelect
export type NewSlabMemory = typeof slabMemories.$inferInsert

// Push notification tokens for native app
export const pushTokens = sqliteTable("push_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  platform: text("platform").notNull(), // "ios" | "android"
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export type PushToken = typeof pushTokens.$inferSelect
export type NewPushToken = typeof pushTokens.$inferInsert
