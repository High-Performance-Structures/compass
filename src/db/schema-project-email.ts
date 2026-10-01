import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

import { correspondence, correspondenceMessages } from "./schema-correspondence"
import { projects, users } from "./schema"

/** One send attempt per project message. An unknown provider outcome is never retried automatically. */
export const projectEmailCampaigns = sqliteTable("project_email_campaigns", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  projectId: text("project_id").notNull().references(() => projects.id),
  conversationId: text("conversation_id").notNull().references(() => correspondence.id),
  messageId: text("message_id").notNull().references(() => correspondenceMessages.id),
  senderUserId: text("sender_user_id").notNull().references(() => users.id),
  requestHash: text("request_hash").notNull(),
  replyThreadId: text("reply_thread_id").notNull(),
  status: text("status", { enum: ["queued", "dispatching", "sent", "failed", "unknown"] }).notNull(),
  provider: text("provider"),
  providerMessageId: text("provider_message_id"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("project_email_campaign_message_unique").on(table.messageId),
  index("project_email_campaign_project_idx").on(table.organizationId, table.projectId),
])

/** Email-only recipients are not correspondence participants and gain no portal access. */
export const projectEmailRecipients = sqliteTable("project_email_recipients", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => projectEmailCampaigns.id),
  email: text("email").notNull(),
  kind: text("kind", { enum: ["to", "cc", "bcc"] }).notNull(),
}, (table) => [
  uniqueIndex("project_email_recipient_unique").on(table.campaignId, table.email),
  index("project_email_recipient_email_idx").on(table.email),
])
