/*
 * The staff Message Desk (records and their events, GoTo phone calls and
 * texts that feed it) and user feedback (feedback reports and UX interviews).
 * Written by: src/lib/domain/feedback/.
 */

import { sql } from "drizzle-orm"
import {
  index,
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { FEEDBACK_TYPES, STAFF_MESSAGE_STATUSES } from "../lib/domain/feedback/statuses"
import { organizations, users } from "./schema-identity"
import { projects } from "./schema-projects"

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
    /** See STAFF_MESSAGE_STATUSES (migration 0111 adds the CHECK). */
    status: text("status", { enum: STAFF_MESSAGE_STATUSES }).notNull().default("new"),
    statusChangedAt: text("status_changed_at"),
    /** Last status change, note or reassignment; null means use updated_at. */
    lastActivityAt: text("last_activity_at"),
    /** When the assignee was last reminded that this message went stale. */
    staleRemindedAt: text("stale_reminded_at"),
    closedAt: text("closed_at"),
    closedBy: text("closed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("staff_message_records_org_status_updated_idx").on(
      table.organizationId,
      table.status,
      table.updatedAt
    ),
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

/** Status changes, notes and reassignments on a Message Desk record. */
export const staffMessageEvents = sqliteTable(
  "staff_message_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => staffMessageRecords.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name").notNull(),
    eventType: text("event_type").notNull(),
    fromStatus: text("from_status", { enum: STAFF_MESSAGE_STATUSES }),
    toStatus: text("to_status", { enum: STAFF_MESSAGE_STATUSES }),
    fromAssigneeUserId: text("from_assignee_user_id"),
    toAssigneeUserId: text("to_assignee_user_id"),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("staff_message_events_message_idx").on(table.messageId, table.createdAt),
    index("staff_message_events_organization_id_idx").on(table.organizationId),
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
    trashedAt: text("trashed_at"),
    trashedBy: text("trashed_by"),
    providerDeletedAt: text("provider_deleted_at"),
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
    index("goto_inbound_events_org_conversation_idx").on(
      table.organizationId,
      table.conversationId
    ),
    index("goto_inbound_events_project_id_idx").on(table.projectId),
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

export const feedback = sqliteTable("feedback", {
  id: text("id").primaryKey(),
  type: text("type", { enum: FEEDBACK_TYPES }).notNull(),
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

export type Feedback = typeof feedback.$inferSelect

export type NewFeedback = typeof feedback.$inferInsert

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
