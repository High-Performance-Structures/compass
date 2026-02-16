import {
  sqliteTable,
  text,
  integer,
} from "drizzle-orm/sqlite-core"
import { organizations, projects, users } from "./schema"

// channels - text, voice, announcement channels
export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("text"), // text | voice | announcement
  description: text("description"),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  categoryId: text("category_id").references(() => channelCategories.id, {
    onDelete: "set null",
  }),
  isPrivate: integer("is_private", { mode: "boolean" })
    .notNull()
    .default(false),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

// messages - chat messages with markdown support, threading, pins
// Note: threadId is a self-reference, which TypeScript handles via deferred evaluation
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  threadId: text("thread_id"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  content: text("content").notNull(), // markdown
  contentHtml: text("content_html"), // pre-rendered HTML
  editedAt: text("edited_at"),
  deletedAt: text("deleted_at"),
  deletedBy: text("deleted_by").references(() => users.id),
  isPinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
  replyCount: integer("reply_count").notNull().default(0),
  lastReplyAt: text("last_reply_at"),
  createdAt: text("created_at").notNull(),
})

// message_attachments - files, images, etc
export const messageAttachments = sqliteTable("message_attachments", {
  id: text("id").primaryKey(),
  messageId: text("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  r2Path: text("r2_path").notNull(), // placeholder for now
  width: integer("width"),
  height: integer("height"),
  uploadedAt: text("uploaded_at").notNull(),
})

// message_reactions - emoji reactions
export const messageReactions = sqliteTable("message_reactions", {
  id: text("id").primaryKey(),
  messageId: text("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  emoji: text("emoji").notNull(),
  createdAt: text("created_at").notNull(),
})

// message_mentions - @user, @channel, @here, @agent mentions
export const messageMentions = sqliteTable("message_mentions", {
  id: text("id").primaryKey(),
  messageId: text("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  mentionType: text("mention_type").notNull(), // "user" | "channel" | "here" | "agent"
  targetId: text("target_id"), // userId for user, "compass-agent" for agent, null for channel/here
  createdAt: text("created_at").notNull(),
})

// channel_members - who can access which channels
export const channelMembers = sqliteTable("channel_members", {
  id: text("id").primaryKey(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"), // owner | moderator | member
  notifyLevel: text("notify_level").notNull().default("all"), // all | mentions | none
  joinedAt: text("joined_at").notNull(),
})

// typing_sessions - active typing indicators with TTL
export const typingSessions = sqliteTable("typing_sessions", {
  id: text("id").primaryKey(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  startedAt: text("started_at").notNull(),
  expiresAt: text("expires_at").notNull(), // 5-second TTL
})

// user_presence - online status and activity
export const userPresence = sqliteTable("user_presence", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("offline"), // online | idle | dnd | offline
  statusMessage: text("status_message"),
  lastSeenAt: text("last_seen_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

// channel_categories - organize channels into groups
export const channelCategories = sqliteTable("channel_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  collapsedByDefault: integer("collapsed_by_default", { mode: "boolean" }).default(false),
  createdAt: text("created_at").notNull(),
})

// channel_read_state - unread tracking per user per channel
export const channelReadState = sqliteTable("channel_read_state", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  lastReadMessageId: text("last_read_message_id"),
  lastReadAt: text("last_read_at").notNull(),
  unreadCount: integer("unread_count").notNull().default(0),
})

// type exports
export type Channel = typeof channels.$inferSelect
export type NewChannel = typeof channels.$inferInsert
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type MessageAttachment = typeof messageAttachments.$inferSelect
export type NewMessageAttachment = typeof messageAttachments.$inferInsert
export type MessageReaction = typeof messageReactions.$inferSelect
export type NewMessageReaction = typeof messageReactions.$inferInsert
export type MessageMention = typeof messageMentions.$inferSelect
export type NewMessageMention = typeof messageMentions.$inferInsert
export type ChannelMember = typeof channelMembers.$inferSelect
export type NewChannelMember = typeof channelMembers.$inferInsert
export type ChannelReadState = typeof channelReadState.$inferSelect
export type NewChannelReadState = typeof channelReadState.$inferInsert
export type TypingSession = typeof typingSessions.$inferSelect
export type NewTypingSession = typeof typingSessions.$inferInsert
export type UserPresence = typeof userPresence.$inferSelect
export type NewUserPresence = typeof userPresence.$inferInsert
export type ChannelCategory = typeof channelCategories.$inferSelect
export type NewChannelCategory = typeof channelCategories.$inferInsert
