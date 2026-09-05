import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { projects, users } from "./schema"

export const correspondence = sqliteTable("project_correspondence", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  projectId: text("project_id").notNull().references(() => projects.id),
  subject: text("subject").notNull(),
  participantVersion: integer("participant_version").notNull().default(1),
  closed: integer("closed", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (t) => [index("correspondence_project_idx").on(t.organizationId, t.projectId)])

export const correspondenceParticipants = sqliteTable("correspondence_participants", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => correspondence.id),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role", { enum: ["staff", "owner", "sub_vendor"] }).notNull(),
  revokedAt: text("revoked_at"),
}, (t) => [uniqueIndex("correspondence_participant_unique").on(t.conversationId, t.userId)])

export const correspondenceMessages = sqliteTable("correspondence_messages", {
  sequence: integer("sequence").primaryKey({ autoIncrement: true }),
  id: text("id").notNull().unique(),
  conversationId: text("conversation_id").notNull().references(() => correspondence.id),
  authorUserId: text("author_user_id").references(() => users.id),
  authorName: text("author_name").notNull(),
  source: text("source", { enum: ["compass", "buildertrend", "email", "sms"] }).notNull(),
  sourceKey: text("source_key").unique(),
  body: text("body").notNull(),
  sentAt: text("sent_at").notNull(),
  editedAt: text("edited_at"),
  retractedAt: text("retracted_at"),
  requestHash: text("request_hash").notNull(),
}, (t) => [index("correspondence_message_order_idx").on(t.conversationId, t.sequence)])

// One grant per message: historical audiences must never be unioned by thread.
export const correspondenceRecipients = sqliteTable("correspondence_recipients", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull().references(() => correspondenceMessages.id),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["author", "to", "cc"] }).notNull(),
  openedAt: text("opened_at"),
  baseline: integer("baseline", { mode: "boolean" }).notNull().default(false),
}, (t) => [uniqueIndex("correspondence_recipient_unique").on(t.messageId, t.userId), index("correspondence_recipient_user_idx").on(t.userId, t.messageId)])

export const correspondenceState = sqliteTable("correspondence_user_state", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => correspondence.id),
  userId: text("user_id").notNull().references(() => users.id),
  saved: integer("saved", { mode: "boolean" }).notNull().default(false),
  followUp: integer("follow_up", { mode: "boolean" }).notNull().default(false),
  shareReadReceipts: integer("share_read_receipts", { mode: "boolean" }).notNull().default(true),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
}, (t) => [uniqueIndex("correspondence_state_unique").on(t.conversationId, t.userId)])

export const correspondenceDrafts = sqliteTable("correspondence_drafts", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => correspondence.id),
  userId: text("user_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  version: integer("version").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [uniqueIndex("correspondence_draft_unique").on(t.conversationId, t.userId)])

export const correspondenceAttachments = sqliteTable("correspondence_attachments", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  projectId: text("project_id").notNull().references(() => projects.id),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  messageId: text("message_id").references(() => correspondenceMessages.id),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  driveFileId: text("drive_file_id"),
  retiredAt: text("retired_at"),
  createdAt: text("created_at").notNull(),
}, (t) => [index("correspondence_attachments_message_idx").on(t.messageId)])

export const correspondenceRevisions = sqliteTable("correspondence_revisions", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull().references(() => correspondenceMessages.id),
  actorUserId: text("actor_user_id").notNull(),
  previousBody: text("previous_body").notNull(),
  operation: text("operation", { enum: ["edit", "retract"] }).notNull(),
  createdAt: text("created_at").notNull(),
})

export const correspondenceOutbox = sqliteTable("correspondence_outbox", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull().references(() => correspondenceMessages.id),
  recipientUserId: text("recipient_user_id").notNull(),
  transport: text("transport").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [uniqueIndex("correspondence_outbox_unique").on(t.messageId, t.recipientUserId, t.transport)])

// Transaction-scoped assertions make revocation/version races roll back the entire D1 batch.
export const correspondenceWriteGuards = sqliteTable("correspondence_write_guards", {
  id: text("id").primaryKey(),
  allowed: integer("allowed").notNull(),
})

export const correspondenceCompositionDrafts = sqliteTable("correspondence_composition_drafts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  projectId: text("project_id").notNull().references(() => projects.id),
  userId: text("user_id").notNull().references(() => users.id),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  recipientUserIds: text("recipient_user_ids", { mode: "json" }).$type<readonly string[]>().notNull(),
  version: integer("version").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [uniqueIndex("correspondence_composition_draft_unique").on(t.projectId, t.userId)])
