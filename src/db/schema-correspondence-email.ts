import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

import { correspondence, correspondenceMessages } from "./schema-correspondence"
import { projects, users } from "./schema"

export const correspondenceEmailThreads = sqliteTable(
  "correspondence_email_threads",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id").notNull().references(() => projects.id),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => correspondence.id),
    replyToken: text("reply_token").notNull(),
    replyToAddress: text("reply_to_address").notNull(),
    anchorMessageId: text("anchor_message_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("correspondence_email_thread_conversation_unique").on(
      table.conversationId
    ),
    uniqueIndex("correspondence_email_thread_token_unique").on(
      table.replyToken
    ),
    uniqueIndex("correspondence_email_thread_anchor_unique").on(
      table.anchorMessageId
    ),
    index("correspondence_email_thread_project_idx").on(
      table.organizationId,
      table.projectId
    ),
  ]
)

export const correspondenceEmailDeliveries = sqliteTable(
  "correspondence_email_deliveries",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id").notNull().references(() => projects.id),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => correspondence.id),
    messageId: text("message_id")
      .notNull()
      .references(() => correspondenceMessages.id),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => users.id),
    recipientEmail: text("recipient_email").notNull(),
    provider: text("provider").notNull().default("gmail"),
    status: text("status").notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    attemptCount: integer("attempt_count").notNull().default(0),
    queuedAt: text("queued_at").notNull(),
    acceptedAt: text("accepted_at"),
    failedAt: text("failed_at"),
    error: text("error"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("correspondence_email_delivery_unique").on(
      table.messageId,
      table.recipientUserId,
      table.provider
    ),
    index("correspondence_email_delivery_dispatch_idx").on(
      table.status,
      table.queuedAt
    ),
  ]
)

export const correspondenceEmailEvents = sqliteTable(
  "correspondence_email_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id").references(() => projects.id),
    conversationId: text("conversation_id").references(() => correspondence.id),
    messageId: text("message_id").references(() => correspondenceMessages.id),
    senderAddress: text("sender_address"),
    status: text("status").notNull(),
    holdReason: text("hold_reason"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("correspondence_email_event_provider_unique").on(
      table.provider,
      table.providerEventId
    ),
    index("correspondence_email_event_project_idx").on(
      table.organizationId,
      table.projectId,
      table.createdAt
    ),
  ]
)
