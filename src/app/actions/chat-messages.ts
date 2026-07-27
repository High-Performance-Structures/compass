"use server"

import { getCloudflareContext } from "@/lib/db"
import {
  eq,
  and,
  desc,
  lt,
  sql,
  like,
  ne,
  or,
  inArray,
} from "drizzle-orm"
import { marked } from "marked"
import { getDb } from "@/db"
import {
  messages,
  messageAttachments,
  messageReactions,
  channelMembers,
  channelReadState,
  messageMentions,
  channels,
  userPresence,
  type NewMessage,
  type NewMessageReaction,
  type NewMessageMention,
} from "@/db/schema-conversations"
import { users, organizationMembers } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import {
  canUseAskCompass,
  requirePermission,
} from "@/lib/permissions"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { revalidatePath } from "next/cache"
import { enqueueFeedbackDeskItem } from "@/lib/jarvis/feedback-desk"
import {
  createNotificationEvent,
  notifyChannelMessage,
} from "@/lib/notifications/events"

const MAX_MESSAGE_LENGTH = 4000
const EMOJI_REGEX = /^[\p{Emoji}\u200d\uFE0F]+$/u

type MessageAttachmentItem = {
  readonly id: string
  readonly fileName: string
  readonly mimeType: string
  readonly fileSize: number
  readonly storageUrl: string
}

type MessageReactionItem = {
  readonly emoji: string
  readonly count: number
  readonly reactedByCurrentUser: boolean
}

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true,
})

// Simple HTML sanitizer that works in edge runtime (no JSDOM dependency)
// This strips dangerous tags and attributes while preserving safe markdown output
const ALLOWED_TAGS = new Set([
  "p", "br", "strong", "em", "u", "s", "del", "code", "pre",
  "blockquote", "ul", "ol", "li", "a", "img", "h1", "h2", "h3",
  "h4", "h5", "h6", "hr", "table", "thead", "tbody", "tr", "th", "td",
  "span", "div",
])

const ALLOWED_ATTR = new Set(["href", "src", "alt", "title", "class", "id", "target", "rel", "data-type", "data-id", "data-mention-type"])

// Regex to strip script tags and event handlers
const DANGEROUS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi,
  /on\w+\s*=/gi, // Event handlers like onclick=
  /javascript:/gi,
  /data:/gi,
  /vbscript:/gi,
]

function sanitizeHtml(html: string): string {
  let sanitized = html

  // Remove dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    sanitized = sanitized.replace(pattern, "")
  }

  // Simple tag filtering - remove tags not in allowed list
  // This is a basic implementation; for production consider a proper sanitizer
  sanitized = sanitized.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (match, tagName) => {
    if (ALLOWED_TAGS.has(tagName.toLowerCase())) {
      // For allowed tags, filter attributes
      return match.replace(/([\w-]+)\s*=\s*["'][^"']*["']/gi, (attrMatch, attrName) => {
        if (ALLOWED_ATTR.has(attrName.toLowerCase())) {
          // Only allow safe URL schemes in href/src
          if (attrName.toLowerCase() === "href" || attrName.toLowerCase() === "src") {
            const value = attrMatch.match(/=["']([^"']*)["']/i)?.[1] ?? ""
            if (/^(https?:|mailto:|\/|#)/i.test(value) || !value.includes(":")) {
              return attrMatch
            }
            return ""
          }
          return attrMatch
        }
        return ""
      })
    }
    return "" // Remove disallowed tags
  })

  return sanitized
}

async function renderMarkdown(content: string): Promise<string> {
  const html = await marked(content)
  return sanitizeHtml(html)
}

async function getAttachmentsByMessage(
  db: ReturnType<typeof getDb>,
  messageIds: readonly string[]
): Promise<ReadonlyMap<string, readonly MessageAttachmentItem[]>> {
  if (messageIds.length === 0) return new Map()

  const rows = await db
    .select({
      id: messageAttachments.id,
      messageId: messageAttachments.messageId,
      fileName: messageAttachments.fileName,
      mimeType: messageAttachments.mimeType,
      fileSize: messageAttachments.fileSize,
      storageUrl: messageAttachments.r2Path,
    })
    .from(messageAttachments)
    .where(inArray(messageAttachments.messageId, messageIds))

  const attachments = new Map<string, MessageAttachmentItem[]>()
  for (const row of rows) {
    const existing = attachments.get(row.messageId) ?? []
    existing.push({
      id: row.id,
      fileName: row.fileName,
      mimeType: row.mimeType,
      fileSize: row.fileSize,
      storageUrl: row.storageUrl,
    })
    attachments.set(row.messageId, existing)
  }
  return attachments
}

async function getReactionsByMessage(
  db: ReturnType<typeof getDb>,
  messageIds: readonly string[],
  currentUserId: string
): Promise<ReadonlyMap<string, readonly MessageReactionItem[]>> {
  if (messageIds.length === 0) return new Map()

  const rows = await db
    .select({
      messageId: messageReactions.messageId,
      userId: messageReactions.userId,
      emoji: messageReactions.emoji,
    })
    .from(messageReactions)
    .where(inArray(messageReactions.messageId, messageIds))

  const counts = new Map<
    string,
    Map<string, { count: number; reactedByCurrentUser: boolean }>
  >()
  for (const row of rows) {
    const messageCounts = counts.get(row.messageId) ?? new Map()
    const reaction = messageCounts.get(row.emoji) ?? {
      count: 0,
      reactedByCurrentUser: false,
    }
    messageCounts.set(row.emoji, {
      count: reaction.count + 1,
      reactedByCurrentUser:
        reaction.reactedByCurrentUser || row.userId === currentUserId,
    })
    counts.set(row.messageId, messageCounts)
  }

  const reactions = new Map<string, MessageReactionItem[]>()
  for (const [messageId, messageCounts] of counts) {
    reactions.set(
      messageId,
      Array.from(messageCounts.entries()).map(([emoji, reaction]) => ({
        emoji,
        count: reaction.count,
        reactedByCurrentUser: reaction.reactedByCurrentUser,
      }))
    )
  }
  return reactions
}

export async function searchMentionableUsers(
  query: string
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const organizationId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const searchPattern = `%${query}%`
    const results = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .innerJoin(
        organizationMembers,
        eq(organizationMembers.userId, users.id)
      )
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          or(
            like(users.displayName, searchPattern),
            like(users.email, searchPattern),
            like(users.firstName, searchPattern),
            like(users.lastName, searchPattern)
          )
        )
      )
      .limit(10)

    const data = results.map((u) => ({
      ...u,
      type: "user" as const,
    }))

    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to search users",
    }
  }
}

type MentionInput = {
  mentionType: "user" | "channel" | "here" | "agent"
  targetId: string | null
}

type Db = ReturnType<typeof getDb>

type ConversationNotificationRecipient = {
  readonly userId: string
  readonly email: string
  readonly notifyLevel: string
}

async function getChannelNotificationMembers(
  db: Db,
  channelId: string,
  senderId: string
): Promise<readonly ConversationNotificationRecipient[]> {
  return db
    .select({
      userId: users.id,
      email: users.email,
      notifyLevel: channelMembers.notifyLevel,
    })
    .from(channelMembers)
    .innerJoin(users, eq(users.id, channelMembers.userId))
    .where(
      and(
        eq(channelMembers.channelId, channelId),
        eq(users.isActive, true)
      )
    )
    .then((rows) =>
      rows.filter(
        (row) =>
          row.userId !== senderId && row.notifyLevel !== "none"
      )
    )
}

async function resolveMentionNotificationRecipients(
  db: Db,
  channelId: string,
  senderId: string,
  mentions: readonly MentionInput[]
): Promise<readonly { readonly userId: string; readonly email: string }[]> {
  const members = await getChannelNotificationMembers(
    db,
    channelId,
    senderId
  )
  const onlineRows = mentions.some(
    (mention) => mention.mentionType === "here"
  )
    ? await db
        .select({ userId: userPresence.userId })
        .from(userPresence)
        .where(eq(userPresence.status, "online"))
    : []
  const onlineUserIds = new Set(onlineRows.map((row) => row.userId))
  const recipients = new Map<
    string,
    { readonly userId: string; readonly email: string }
  >()

  for (const mention of mentions) {
    if (mention.mentionType === "user" && mention.targetId) {
      const member = members.find(
        (row) => row.userId === mention.targetId
      )
      if (member) {
        recipients.set(member.userId, {
          userId: member.userId,
          email: member.email,
        })
      }
      continue
    }
    if (mention.mentionType === "channel") {
      for (const member of members) {
        recipients.set(member.userId, {
          userId: member.userId,
          email: member.email,
        })
      }
      continue
    }
    if (mention.mentionType === "here") {
      for (const member of members) {
        if (!onlineUserIds.has(member.userId)) continue
        recipients.set(member.userId, {
          userId: member.userId,
          email: member.email,
        })
      }
    }
  }

  return Array.from(recipients.values())
}

function messagePreview(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim()
  return normalized.length <= 180
    ? normalized
    : `${normalized.slice(0, 177)}...`
}

export async function sendMessage(data: {
  channelId: string
  content: string
  threadId?: string
  mentions?: Array<MentionInput>
  contentHtml?: string
}) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }

    if (data.content.length > MAX_MESSAGE_LENGTH) {
      return { success: false, error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify user is a member of the channel
    const membership = await db
      .select()
      .from(channelMembers)
      .where(
        and(
          eq(channelMembers.channelId, data.channelId),
          eq(channelMembers.userId, user.id)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!membership) {
      return { success: false, error: "Not a member of this channel" }
    }

    const now = new Date().toISOString()
    const messageId = crypto.randomUUID()

    // Use provided HTML or render markdown to sanitized HTML
    const contentHtml = data.contentHtml
      ? sanitizeHtml(data.contentHtml)
      : await renderMarkdown(data.content)

    const newMessage: NewMessage = {
      id: messageId,
      channelId: data.channelId,
      threadId: data.threadId ?? null,
      userId: user.id,
      content: data.content,
      contentHtml,
      editedAt: null,
      deletedAt: null,
      deletedBy: null,
      isPinned: false,
      replyCount: 0,
      lastReplyAt: null,
      createdAt: now,
    }

    await db.insert(messages).values(newMessage)

    // insert mentions if provided
    if (data.mentions && data.mentions.length > 0) {
      const mentionRows: NewMessageMention[] = data.mentions.map((m) => ({
        id: crypto.randomUUID(),
        messageId,
        mentionType: m.mentionType,
        targetId: m.targetId,
        createdAt: now,
      }))
      await db.insert(messageMentions).values(mentionRows)

      // fire-and-forget notification (don't await, don't block on error)
      const envRecord = env as unknown as Record<string, string>
      const fcmKey = envRecord.FCM_SERVER_KEY
      if (fcmKey) {
        import("@/lib/conversations/notify-mentions")
          .then(({ notifyMentionedUsers }) =>
            notifyMentionedUsers(
              env.DB,
              fcmKey,
              messageId,
              data.channelId,
              user.id,
              user.displayName ?? user.email ?? "Someone",
              data.mentions ?? [],
            )
          )
          .catch(console.error)
      }
    }

    // if this is a thread reply, update parent message
    if (data.threadId) {
      await db
        .update(messages)
        .set({
          replyCount: sql`${messages.replyCount} + 1`,
          lastReplyAt: now,
        })
        .where(eq(messages.id, data.threadId))
    }

    const channel = await db
      .select({
        name: channels.name,
        type: channels.type,
        organizationId: channels.organizationId,
        projectId: channels.projectId,
      })
      .from(channels)
      .where(eq(channels.id, data.channelId))
      .get()

    if (channel && data.mentions && data.mentions.length > 0) {
      try {
        const recipients = await resolveMentionNotificationRecipients(
          db,
          data.channelId,
          user.id,
          data.mentions
        )
        await createNotificationEvent({
          organizationId: channel.organizationId,
          projectId: channel.projectId,
          eventType: "message.mention",
          sourceType: "message",
          sourceId: messageId,
          title: `${user.displayName ?? user.email} mentioned you`,
          body: messagePreview(data.content),
          href: `/dashboard/conversations/${data.channelId}`,
          priority: "normal",
          audience: "mention",
          createdBy: user.id,
          recipients,
          delivery: {
            inApp: false,
            email: true,
            push: false,
          },
        })
      } catch (notificationError) {
        console.error("message_mention_notification_failed", {
          messageId,
          error:
            notificationError instanceof Error
              ? notificationError.message
              : "Unknown error",
        })
      }
    }

    if (channel?.type === "announcement" && !data.threadId) {
      try {
        const recipients = await getChannelNotificationMembers(
          db,
          data.channelId,
          user.id
        )
        await createNotificationEvent({
          organizationId: channel.organizationId,
          projectId: channel.projectId,
          eventType: "announcement.message",
          sourceType: "message",
          sourceId: messageId,
          title: `Announcement in #${channel.name}`,
          body: messagePreview(data.content),
          href: `/dashboard/conversations/${data.channelId}`,
          priority: "high",
          audience: "announcement",
          createdBy: user.id,
          recipients,
          delivery: {
            inApp: false,
            email: true,
            push: false,
          },
        })
      } catch (notificationError) {
        console.error("announcement_notification_failed", {
          messageId,
          error:
            notificationError instanceof Error
              ? notificationError.message
              : "Unknown error",
        })
      }
    }

    const asksCompass =
      canUseAskCompass(user) &&
      (data.mentions?.some(
        (mention) => mention.mentionType === "agent",
      ) ?? false)
    const isFeedbackChannel =
      channel?.name.trim().toLowerCase() === "compass-feedback"

    if (channel && (asksCompass || isFeedbackChannel)) {
      try {
        await enqueueFeedbackDeskItem(db, {
          organizationId: channel.organizationId,
          source: "compass-conversation",
          sourceId: messageId,
          kind: asksCompass ? "assistance" : "general",
          title: asksCompass
            ? `Assistance request from ${user.displayName ?? user.email}`
            : `Compass feedback from ${user.displayName ?? user.email}`,
          description: data.content,
          reporterName: user.displayName,
          reporterEmail: user.email,
          channelId: data.channelId,
          messageId,
          threadId: data.threadId,
          metadata: {
            untrustedUserContent: true,
            channelName: channel.name,
          },
        })
      } catch (error) {
        console.error("conversation_feedback_enqueue_failed", {
          messageId,
          channelId: data.channelId,
          error:
            error instanceof Error
              ? error.message
              : "Unknown error",
        })
      }
    }

    await db
      .update(channelReadState)
      .set({
        unreadCount: sql`${channelReadState.unreadCount} + 1`,
      })
      .where(
        and(
          eq(channelReadState.channelId, data.channelId),
          ne(channelReadState.userId, user.id)
        )
      )

    if (channel) {
      try {
        await notifyChannelMessage({
          organizationId: channel.organizationId,
          projectId: channel.projectId,
          channelId: data.channelId,
          channelName: channel.name,
          messageId,
          threadId: data.threadId ?? null,
          content: data.content,
          sender: user,
          mentions: data.mentions ?? [],
        })
      } catch (error) {
        console.error("channel_message_notification_failed", {
          messageId,
          channelId: data.channelId,
          error:
            error instanceof Error
              ? error.message
              : "Unknown error",
        })
      }
    }

    // update read state for sender (mark as read)
    await db
      .update(channelReadState)
      .set({
        lastReadMessageId: messageId,
        lastReadAt: now,
        unreadCount: 0,
      })
      .where(
        and(
          eq(channelReadState.channelId, data.channelId),
          eq(channelReadState.userId, user.id)
        )
      )

    // fetch the created message with user info
    const messageWithUser = await db
      .select({
        id: messages.id,
        channelId: messages.channelId,
        threadId: messages.threadId,
        content: messages.content,
        contentHtml: messages.contentHtml,
        editedAt: messages.editedAt,
        deletedAt: messages.deletedAt,
        isPinned: messages.isPinned,
        replyCount: messages.replyCount,
        lastReplyAt: messages.lastReplyAt,
        createdAt: messages.createdAt,
        user: {
          id: users.id,
          displayName: users.displayName,
          email: users.email,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(messages)
      .leftJoin(users, eq(users.id, messages.userId))
      .where(eq(messages.id, messageId))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    revalidatePath("/dashboard")
    return {
      success: true,
      data: messageWithUser
        ? { ...messageWithUser, attachments: [], reactions: [] }
        : null,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to send message",
    }
  }
}

export async function deleteMessage(messageId: string) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // fetch the message
    const message = await db
      .select()
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!message) {
      return { success: false, error: "Message not found" }
    }

    // check permission: own message or admin
    if (message.userId !== user.id) {
      try {
        requirePermission(user, "channels", "moderate")
      } catch {
        return { success: false, error: "Cannot delete other users' messages" }
      }
    }

    const now = new Date().toISOString()
    await db
      .update(messages)
      .set({
        deletedAt: now,
        deletedBy: user.id,
      })
      .where(eq(messages.id, messageId))

    revalidatePath("/dashboard")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete message",
    }
  }
}

export async function getMessages(
  channelId: string,
  options?: { limit?: number; cursor?: string }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify user is a member
    const membership = await db
      .select()
      .from(channelMembers)
      .where(
        and(
          eq(channelMembers.channelId, channelId),
          eq(channelMembers.userId, user.id)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!membership) {
      return { success: false, error: "Not a member of this channel" }
    }

    const limit = options?.limit ?? 50
    const cursor = options?.cursor

    const query = db
      .select({
        id: messages.id,
        channelId: messages.channelId,
        threadId: messages.threadId,
        content: messages.content,
        contentHtml: messages.contentHtml,
        editedAt: messages.editedAt,
        deletedAt: messages.deletedAt,
        isPinned: messages.isPinned,
        replyCount: messages.replyCount,
        lastReplyAt: messages.lastReplyAt,
        createdAt: messages.createdAt,
        user: {
          id: users.id,
          displayName: users.displayName,
          email: users.email,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(messages)
      .leftJoin(users, eq(users.id, messages.userId))
      .where(
        and(
          eq(messages.channelId, channelId),
          sql`${messages.threadId} IS NULL`, // only top-level messages
          cursor ? lt(messages.createdAt, cursor) : undefined
        )
      )
      .orderBy(desc(messages.createdAt))
      .limit(limit)

    const results = await query

    // replace deleted content with placeholder
    const attachmentsByMessage = await getAttachmentsByMessage(
      db,
      results.map((message) => message.id)
    )
    const reactionsByMessage = await getReactionsByMessage(
      db,
      results.map((message) => message.id),
      user.id
    )
    const sanitized = results.map((msg) => ({
      ...msg,
      content: msg.deletedAt ? "[Message deleted]" : msg.content,
      contentHtml: msg.deletedAt ? null : msg.contentHtml,
      attachments: msg.deletedAt
        ? []
        : attachmentsByMessage.get(msg.id) ?? [],
      reactions: msg.deletedAt
        ? []
        : reactionsByMessage.get(msg.id) ?? [],
    }))

    return { success: true, data: sanitized }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to get messages",
    }
  }
}

export async function getThreadMessages(
  parentMessageId: string,
  options?: { limit?: number; cursor?: string }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // fetch parent message to get channelId
    const parentMessage = await db
      .select({ channelId: messages.channelId })
      .from(messages)
      .where(eq(messages.id, parentMessageId))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!parentMessage) {
      return { success: false, error: "Parent message not found" }
    }

    // verify user is a member
    const membership = await db
      .select()
      .from(channelMembers)
      .where(
        and(
          eq(channelMembers.channelId, parentMessage.channelId),
          eq(channelMembers.userId, user.id)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!membership) {
      return { success: false, error: "Not a member of this channel" }
    }

    const limit = options?.limit ?? 50
    const cursor = options?.cursor

    const query = db
      .select({
        id: messages.id,
        channelId: messages.channelId,
        threadId: messages.threadId,
        content: messages.content,
        contentHtml: messages.contentHtml,
        editedAt: messages.editedAt,
        deletedAt: messages.deletedAt,
        isPinned: messages.isPinned,
        replyCount: messages.replyCount,
        lastReplyAt: messages.lastReplyAt,
        createdAt: messages.createdAt,
        user: {
          id: users.id,
          displayName: users.displayName,
          email: users.email,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(messages)
      .leftJoin(users, eq(users.id, messages.userId))
      .where(
        and(
          eq(messages.threadId, parentMessageId),
          cursor ? lt(messages.createdAt, cursor) : undefined
        )
      )
      .orderBy(desc(messages.createdAt))
      .limit(limit)

    const results = await query

    // replace deleted content with placeholder
    const attachmentsByMessage = await getAttachmentsByMessage(
      db,
      results.map((message) => message.id)
    )
    const reactionsByMessage = await getReactionsByMessage(
      db,
      results.map((message) => message.id),
      user.id
    )
    const sanitized = results.map((msg) => ({
      ...msg,
      content: msg.deletedAt ? "[Message deleted]" : msg.content,
      contentHtml: msg.deletedAt ? null : msg.contentHtml,
      attachments: msg.deletedAt
        ? []
        : attachmentsByMessage.get(msg.id) ?? [],
      reactions: msg.deletedAt
        ? []
        : reactionsByMessage.get(msg.id) ?? [],
    }))

    return { success: true, data: sanitized }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to get thread messages",
    }
  }
}

export async function addReaction(messageId: string, emoji: string) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }

    if (emoji.length > 10 || !EMOJI_REGEX.test(emoji)) {
      return { success: false, error: "Invalid emoji" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // fetch message to get channelId
    const message = await db
      .select({ channelId: messages.channelId })
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!message) {
      return { success: false, error: "Message not found" }
    }

    // verify user is a member of the channel
    const membership = await db
      .select()
      .from(channelMembers)
      .where(
        and(
          eq(channelMembers.channelId, message.channelId),
          eq(channelMembers.userId, user.id)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!membership) {
      return { success: false, error: "Not a member of this channel" }
    }

    // check if reaction already exists
    const existing = await db
      .select()
      .from(messageReactions)
      .where(
        and(
          eq(messageReactions.messageId, messageId),
          eq(messageReactions.userId, user.id),
          eq(messageReactions.emoji, emoji)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (existing) {
      return { success: false, error: "Already reacted with this emoji" }
    }

    const now = new Date().toISOString()
    const reactionId = crypto.randomUUID()

    const newReaction: NewMessageReaction = {
      id: reactionId,
      messageId,
      userId: user.id,
      emoji,
      createdAt: now,
    }

    await db.insert(messageReactions).values(newReaction)

    revalidatePath("/dashboard")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to add reaction",
    }
  }
}

export async function removeReaction(messageId: string, emoji: string) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }

    if (emoji.length > 10 || !EMOJI_REGEX.test(emoji)) {
      return { success: false, error: "Invalid emoji" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // fetch message to get channelId
    const message = await db
      .select({ channelId: messages.channelId })
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!message) {
      return { success: false, error: "Message not found" }
    }

    // verify user is a member of the channel
    const membership = await db
      .select()
      .from(channelMembers)
      .where(
        and(
          eq(channelMembers.channelId, message.channelId),
          eq(channelMembers.userId, user.id)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!membership) {
      return { success: false, error: "Not a member of this channel" }
    }

    await db
      .delete(messageReactions)
      .where(
        and(
          eq(messageReactions.messageId, messageId),
          eq(messageReactions.userId, user.id),
          eq(messageReactions.emoji, emoji)
        )
      )

    revalidatePath("/dashboard")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to remove reaction",
    }
  }
}

export async function markChannelRead(
  channelId: string,
  lastMessageId: string
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const now = new Date().toISOString()

    // upsert read state
    const existing = await db
      .select()
      .from(channelReadState)
      .where(
        and(
          eq(channelReadState.channelId, channelId),
          eq(channelReadState.userId, user.id)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (existing) {
      await db
        .update(channelReadState)
        .set({
          lastReadMessageId: lastMessageId,
          lastReadAt: now,
          unreadCount: 0,
        })
        .where(eq(channelReadState.id, existing.id))
    } else {
      const readStateId = crypto.randomUUID()
      await db.insert(channelReadState).values({
        id: readStateId,
        userId: user.id,
        channelId,
        lastReadMessageId: lastMessageId,
        lastReadAt: now,
        unreadCount: 0,
      })
    }

    revalidatePath("/dashboard")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to mark channel read",
    }
  }
}
