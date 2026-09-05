import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"

import { correspondence, correspondenceMessages } from "./schema-correspondence"
import { organizations, projects } from "./schema"

export const correspondenceSourceMessages = sqliteTable("correspondence_source_messages", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  projectId: text("project_id").notNull().references(() => projects.id),
  conversationId: text("conversation_id").notNull().references(() => correspondence.id),
  messageId: text("message_id").notNull().references(() => correspondenceMessages.id),
  sourceAccountId: text("source_account_id").notNull(),
  sourceProjectId: text("source_project_id").notNull(),
  sourceMessageId: text("source_message_id").notNull(),
  sourceSubject: text("source_subject").notNull(),
  sourceSentDisplay: text("source_sent_display").notNull(),
  sourceSentLocal: text("source_sent_local"),
  sourceSentAt: text("source_sent_at"),
  sourceTimezone: text("source_timezone"),
  sourceBodySha256: text("source_body_sha256").notNull(),
  sourceEvidenceJson: text("source_evidence_json").notNull(),
  capturedAt: text("captured_at").notNull(),
}, (table) => [
  uniqueIndex("correspondence_source_messages_message_unique").on(table.messageId),
  uniqueIndex("correspondence_source_messages_source_unique").on(table.sourceAccountId, table.sourceMessageId),
  index("correspondence_source_messages_scope_idx").on(table.organizationId, table.projectId, table.conversationId),
  check("correspondence_source_messages_sha256_check", sql`length(${table.sourceBodySha256}) = 64 AND ${table.sourceBodySha256} NOT GLOB '*[^0-9A-Fa-f]*'`),
  check("correspondence_source_messages_evidence_json_check", sql`json_valid(${table.sourceEvidenceJson}) = 1`),
])

export const correspondenceSourceRecipients = sqliteTable("correspondence_source_recipients", {
  id: text("id").primaryKey(),
  sourceMessageId: text("source_message_id").notNull().references(() => correspondenceSourceMessages.id),
  sourceRecipientKey: text("source_recipient_key").notNull(),
  sourceUserId: text("source_user_id"),
  sourceName: text("source_name").notNull(),
  sourceEmail: text("source_email"),
  kind: text("kind", { enum: ["author", "to", "cc", "bcc"] }).notNull(),
  sourceOrdinal: integer("source_ordinal").notNull(),
  evidenceJson: text("evidence_json").notNull(),
}, (table) => [
  uniqueIndex("correspondence_source_recipients_key_unique").on(table.sourceMessageId, table.sourceRecipientKey),
  uniqueIndex("correspondence_source_recipients_ordinal_unique").on(table.sourceMessageId, table.sourceOrdinal),
  index("correspondence_source_recipients_message_idx").on(table.sourceMessageId, table.sourceOrdinal),
  check("correspondence_source_recipients_ordinal_check", sql`${table.sourceOrdinal} >= 0`),
  check("correspondence_source_recipients_evidence_json_check", sql`json_valid(${table.evidenceJson}) = 1`),
])
