"use server"

import { getCloudflareContext } from "@/lib/db"
import { eq, and, desc, lt, sql, like, or } from "drizzle-orm"
import { marked } from "marked"
import { getDb } from "@/db"
import {
  channels,
  messages,
  messageReactions,
  channelMembers,
  channelReadState,
  messageMentions,
  userPresence,
  type NewMessage,
  type NewMessageReaction,
  type NewMessageMention,
} from "@/db/schema-conversations"
import { users, organizationMembers } from "@/db/schema"
import { createNotificationEvent } from "@/lib/notifications/events"
import { getCurrentUser } from "@/lib/auth"
import type { AuthUser } from "@/lib/auth"
import { can, requirePermission } from "@/lib/permissions"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { revalidatePath } from "next/cache"

const MAX_MESSAGE_LENGTH = 4000
const EMOJI_REGEX = /^[\p{Emoji}\u200d]+$/u

type Db = ReturnType<typeof getDb>

async function ensureChannelMembership(
  db: Db,
  user: AuthUser,
  channelId: string
): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
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

  if (membership) return { success: true }

  const channel = await db
    .select({
      id: channels.id,
      organizationId: channels.organizationId,
      isPrivate: channels.isPrivate,
    })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!channel) return { success: false, error: "Channel not found" }
  if (channel.organizationId !== requireOrg(user)) {
    return { success: false, error: "Channel not found" }
  }
  if (channel.isPrivate && !can(user, "channels", "moderate")) {
    return { success: false, error: "Not a member of this channel" }
  }

  const now = new Date().toISOString()
  await db.insert(channelMembers).values({
    id: crypto.randomUUID(),
    channelId,
    userId: user.id,
    role: channel.isPrivate ? "moderator" : "member",
    notifyLevel: channel.isPrivate ? "mentions" : "all",
    joinedAt: now,
  })
  await db.insert(channelReadState).values({
    id: crypto.randomUUID(),
    userId: user.id,
    channelId,
    lastReadMessageId: null,
    lastReadAt: now,
    unreadCount: 0,
  })

  return { success: true }
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
        (row) => row.userId !== senderId && row.notifyLevel !== "none"
      )
    )
}

async function resolveMentionNotificationRecipients(
  db: Db,
  channelId: string,
  senderId: string,
  mentions: readonly MentionInput[]
): Promise<readonly { readonly userId: string; readonly email: string }[]> {
  const members = await getChannelNotificationMembers(db, channelId, senderId)
  const onlineRows = mentions.some((mention) => mention.mentionType === "here")
    ? await db
        .select({ userId: userPresence.userId })
        .from(userPresence)
        .where(eq(userPresence.status, "online"))
    : []
  const onlineUserIds = new Set(onlineRows.map((row) => row.userId))
  const recipients = new Map<string, { readonly userId: string; readonly email: string }>()

  for (const mention of mentions) {
    if (mention.mentionType === "user" && mention.targetId) {
      const member = members.find((row) => row.userId === mention.targetId)
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
  if (normalized.length <= 180) return normalized
  return `${normalized.slice(0, 177)}...`
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

    const membership = await ensureChannelMembership(db, user, data.channelId)
    if (!membership.success) return membership

    const channel = await db
      .select({
        id: channels.id,
        name: channels.name,
        type: channels.type,
        organizationId: channels.organizationId,
        projectId: channels.projectId,
      })
      .from(channels)
      .where(eq(channels.id, data.channelId))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!channel) {
      return { success: false, error: "Channel not found" }
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
        })
      } catch (notificationError) {
        console.error("[chat-messages] mention notification error", notificationError)
      }
    }

    if (channel.type === "announcement" && !data.threadId) {
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
        })
      } catch (notificationError) {
        console.error("[chat-messages] announcement notification error", notificationError)
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
    return { success: true, data: messageWithUser }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to send message",
    }
  }
}

export async function editMessage(
  messageId: string,
  newContent: string,
  options?: {
    mentions?: Array<MentionInput>
    contentHtml?: string
  }
) {
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
        return { success: false, error: "Cannot edit other users' messages" }
      }
    }

    const now = new Date().toISOString()

    // Use provided HTML or re-render markdown to sanitized HTML
    const contentHtml = options?.contentHtml
      ? sanitizeHtml(options.contentHtml)
      : await renderMarkdown(newContent)

    await db
      .update(messages)
      .set({
        content: newContent,
        contentHtml,
        editedAt: now,
      })
      .where(eq(messages.id, messageId))

    // update mentions if provided
    if (options?.mentions !== undefined) {
      // delete existing mentions
      await db
        .delete(messageMentions)
        .where(eq(messageMentions.messageId, messageId))

      // insert new mentions
      if (options.mentions.length > 0) {
        const mentionRows: NewMessageMention[] = options.mentions.map((m) => ({
          id: crypto.randomUUID(),
          messageId,
          mentionType: m.mentionType,
          targetId: m.targetId,
          createdAt: now,
        }))
        await db.insert(messageMentions).values(mentionRows)
      }
      // Note: we do NOT re-notify on edit (MVP requirement)
    }

    revalidatePath("/dashboard")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to edit message",
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

    const membership = await ensureChannelMembership(db, user, channelId)
    if (!membership.success) return membership

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
    const sanitized = results.map((msg) => ({
      ...msg,
      content: msg.deletedAt ? "[Message deleted]" : msg.content,
      contentHtml: msg.deletedAt ? null : msg.contentHtml,
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

    const membership = await ensureChannelMembership(
      db,
      user,
      parentMessage.channelId
    )
    if (!membership.success) return membership

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
    const sanitized = results.map((msg) => ({
      ...msg,
      content: msg.deletedAt ? "[Message deleted]" : msg.content,
      contentHtml: msg.deletedAt ? null : msg.contentHtml,
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

    const membership = await ensureChannelMembership(db, user, message.channelId)
    if (!membership.success) return membership

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

    const membership = await ensureChannelMembership(db, user, message.channelId)
    if (!membership.success) return membership

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
