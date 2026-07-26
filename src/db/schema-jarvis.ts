import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

export const feedbackDeskItems = sqliteTable(
  "feedback_desk_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id"),
    source: text("source").notNull(),
    sourceId: text("source_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("new"),
    priority: text("priority").notNull().default("normal"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    reporterName: text("reporter_name"),
    reporterEmail: text("reporter_email"),
    channelId: text("channel_id"),
    messageId: text("message_id"),
    threadId: text("thread_id"),
    githubIssueUrl: text("github_issue_url"),
    metadata: text("metadata"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("feedback_desk_source_id_unique").on(
      table.source,
      table.sourceId,
    ),
    index("feedback_desk_status_idx").on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
  ],
)

export const jarvisBridgeEvents = sqliteTable(
  "jarvis_bridge_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id"),
    direction: text("direction").notNull(),
    source: text("source").notNull(),
    eventType: text("event_type").notNull(),
    status: text("status").notNull().default("pending"),
    idempotencyKey: text("idempotency_key").notNull(),
    feedbackDeskItemId: text("feedback_desk_item_id"),
    payload: text("payload").notNull(),
    result: text("result"),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: text("available_at").notNull(),
    claimToken: text("claim_token"),
    claimedAt: text("claimed_at"),
    completedAt: text("completed_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("jarvis_bridge_idempotency_unique").on(
      table.idempotencyKey,
    ),
    index("jarvis_bridge_delivery_idx").on(
      table.direction,
      table.status,
      table.availableAt,
    ),
    index("jarvis_bridge_claim_idx").on(table.claimToken),
  ],
)

export type FeedbackDeskItem =
  typeof feedbackDeskItems.$inferSelect
export type NewFeedbackDeskItem =
  typeof feedbackDeskItems.$inferInsert
export type JarvisBridgeEvent =
  typeof jarvisBridgeEvents.$inferSelect
export type NewJarvisBridgeEvent =
  typeof jarvisBridgeEvents.$inferInsert
