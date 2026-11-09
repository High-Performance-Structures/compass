/*
 * Notifications and tracked email: notification preferences, events,
 * recipients and deliveries; email reply threads (so replies come back to the
 * record), inbound emails, shared mailbox cooldown state, the Activity feed,
 * and phone push tokens.
 * Written by: src/lib/domain/notifications/ and src/lib/email/.
 */

import {
  index,
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { organizations, users } from "./schema-identity"
import { projects } from "./schema-projects"

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
  /** A personal time (HH:MM) for the missing daily log reminder, when the company allows it. */
  dailyLogReminderTime: text("daily_log_reminder_time"),
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
},
  (table) => [
    // Declared from drizzle/0041_notifications.sql.
    index("idx_notification_events_org_created").on(table.organizationId, table.createdAt),
    // Declared from drizzle/0041_notifications.sql.
    index("idx_notification_events_project").on(table.projectId),
    // Declared from drizzle/0274_hot_query_indexes.sql.
    index("notification_events_org_source_idx").on(table.organizationId, table.sourceType, table.eventType, table.createdAt),
  ])

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
},
  (table) => [
    // Declared from drizzle/0041_notifications.sql.
    index("idx_notification_recipients_user_created").on(table.userId, table.createdAt),
    // Declared from drizzle/0041_notifications.sql.
    index("idx_notification_recipients_user_read").on(table.userId, table.readAt),
    // Declared from drizzle/0274_hot_query_indexes.sql.
    index("notification_recipients_event_idx").on(table.eventId),
  ])

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
},
  (table) => [
    // Declared from drizzle/0041_notifications.sql.
    index("idx_notification_deliveries_user_channel").on(table.userId, table.channel),
    index("notification_deliveries_recipient_id_idx").on(table.recipientId),
    index("notification_deliveries_event_id_idx").on(table.eventId),
  ])

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
    index("email_reply_threads_project_id_idx").on(table.projectId),
    // Declared from drizzle/0281_id_reference_triggers.sql.
    index("email_reply_threads_channel_id_idx").on(table.channelId),
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
    index("inbound_emails_project_id_idx").on(table.projectId),
  ]
)

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

// Shared across Worker instances; never keep mailbox cooldowns in process memory.
export const emailMailboxState = sqliteTable("email_mailbox_state", {
  mailbox: text("mailbox").primaryKey(),
  nextAllowedAt: text("next_allowed_at").notNull(),
  leaseToken: text("lease_token"),
  leaseExpiresAt: text("lease_expires_at").notNull(),
})

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
},
  (table) => [
    index("push_tokens_user_id_idx").on(table.userId),
    uniqueIndex("push_tokens_token_unique").on(table.token),
  ])

export type PushToken = typeof pushTokens.$inferSelect

export type NewPushToken = typeof pushTokens.$inferInsert
