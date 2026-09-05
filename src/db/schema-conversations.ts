import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
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
  audience: text("audience").notNull().default("organization"),
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
  // Updated only by real user input, not by connection heartbeats.
  lastActiveAt: text("last_active_at"),
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

export const voiceParticipants = sqliteTable(
  "voice_participants",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name"),
    isMuted: integer("is_muted", { mode: "boolean" }).notNull().default(false),
    isDeafened: integer("is_deafened", { mode: "boolean" })
      .notNull()
      .default(false),
    joinedAt: text("joined_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [
    index("voice_participants_channel_idx").on(table.channelId),
    index("voice_participants_user_idx").on(table.userId),
    index("voice_participants_seen_idx").on(table.channelId, table.lastSeenAt),
  ]
)

export const voiceSignals = sqliteTable(
  "voice_signals",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    senderUserId: text("sender_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetUserId: text("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    signalType: text("signal_type").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("voice_signals_target_idx").on(table.channelId, table.targetUserId),
    index("voice_signals_created_idx").on(table.channelId, table.createdAt),
  ]
)

export const voiceRealtimeKitMeetings = sqliteTable(
  "voice_realtimekit_meetings",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    meetingId: text("meeting_id").notNull(),
    meetingTitle: text("meeting_title").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("voice_realtimekit_meetings_channel_idx").on(table.channelId),
    uniqueIndex("voice_realtimekit_meetings_meeting_idx").on(table.meetingId),
  ]
)

// listening rooms synchronize intent and provider links; audio stays with each
// listener's music service and never passes through Compass.
export const listeningRooms = sqliteTable(
  "listening_rooms",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    hostUserId: text("host_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playbackState: text("playback_state").notNull().default("paused"),
    currentTrackId: text("current_track_id"),
    anchorPositionMs: integer("anchor_position_ms").notNull().default(0),
    playbackStartedAt: text("playback_started_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("listening_rooms_channel_idx").on(table.channelId),
    index("listening_rooms_host_idx").on(table.hostUserId),
  ]
)

export const listeningQueueItems = sqliteTable(
  "listening_queue_items",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => listeningRooms.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    artist: text("artist"),
    durationMs: integer("duration_ms"),
    sortOrder: integer("sort_order").notNull(),
    addedBy: text("added_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playedAt: text("played_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("listening_queue_items_room_order_idx").on(
      table.roomId,
      table.sortOrder
    ),
    index("listening_queue_items_room_idx").on(table.roomId),
  ]
)

export const listeningTrackLinks = sqliteTable(
  "listening_track_links",
  {
    id: text("id").primaryKey(),
    queueItemId: text("queue_item_id")
      .notNull()
      .references(() => listeningQueueItems.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    url: text("url").notNull(),
    addedBy: text("added_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("listening_track_links_item_provider_idx").on(
      table.queueItemId,
      table.provider
    ),
  ]
)

export const listeningRoomParticipants = sqliteTable(
  "listening_room_participants",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => listeningRooms.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    preferredProvider: text("preferred_provider"),
    joinedAt: text("joined_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("listening_room_participants_room_user_idx").on(
      table.roomId,
      table.userId
    ),
    index("listening_room_participants_user_idx").on(table.userId),
  ]
)

// Saved playlists are shared within an organization. Deletes are soft so an
// accidentally removed team playlist can be recovered from the audit record.
export const listeningPlaylists = sqliteTable(
  "listening_playlists",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deletedAt: text("deleted_at"),
    deletedBy: text("deleted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("listening_playlists_org_active_idx").on(
      table.organizationId,
      table.deletedAt,
      table.updatedAt
    ),
    index("listening_playlists_creator_idx").on(table.createdBy),
  ]
)

export const listeningPlaylistItems = sqliteTable(
  "listening_playlist_items",
  {
    id: text("id").primaryKey(),
    playlistId: text("playlist_id")
      .notNull()
      .references(() => listeningPlaylists.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    artist: text("artist"),
    durationMs: integer("duration_ms"),
    sortOrder: integer("sort_order").notNull(),
    addedBy: text("added_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("listening_playlist_items_playlist_order_idx").on(
      table.playlistId,
      table.sortOrder
    ),
  ]
)

export const listeningPlaylistTrackLinks = sqliteTable(
  "listening_playlist_track_links",
  {
    id: text("id").primaryKey(),
    playlistItemId: text("playlist_item_id")
      .notNull()
      .references(() => listeningPlaylistItems.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    url: text("url").notNull(),
    addedBy: text("added_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("listening_playlist_track_links_item_provider_idx").on(
      table.playlistItemId,
      table.provider
    ),
  ]
)

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
export type VoiceParticipant = typeof voiceParticipants.$inferSelect
export type NewVoiceParticipant = typeof voiceParticipants.$inferInsert
export type VoiceSignal = typeof voiceSignals.$inferSelect
export type NewVoiceSignal = typeof voiceSignals.$inferInsert
export type VoiceRealtimeKitMeeting =
  typeof voiceRealtimeKitMeetings.$inferSelect
export type NewVoiceRealtimeKitMeeting =
  typeof voiceRealtimeKitMeetings.$inferInsert
export type ListeningRoom = typeof listeningRooms.$inferSelect
export type NewListeningRoom = typeof listeningRooms.$inferInsert
export type ListeningQueueItem = typeof listeningQueueItems.$inferSelect
export type NewListeningQueueItem = typeof listeningQueueItems.$inferInsert
export type ListeningTrackLink = typeof listeningTrackLinks.$inferSelect
export type NewListeningTrackLink = typeof listeningTrackLinks.$inferInsert
export type ListeningRoomParticipant =
  typeof listeningRoomParticipants.$inferSelect
export type NewListeningRoomParticipant =
  typeof listeningRoomParticipants.$inferInsert
export type ListeningPlaylist = typeof listeningPlaylists.$inferSelect
export type NewListeningPlaylist = typeof listeningPlaylists.$inferInsert
export type ListeningPlaylistItem = typeof listeningPlaylistItems.$inferSelect
export type NewListeningPlaylistItem = typeof listeningPlaylistItems.$inferInsert
export type ListeningPlaylistTrackLink =
  typeof listeningPlaylistTrackLinks.$inferSelect
export type NewListeningPlaylistTrackLink =
  typeof listeningPlaylistTrackLinks.$inferInsert
