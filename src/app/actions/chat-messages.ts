"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { eq, and, desc, lt, sql } from "drizzle-orm"
import { marked } from "marked"
import DOMPurify from "isomorphic-dompurify"
import { getDb } from "@/db"
import {
  messages,
  messageReactions,
  channelMembers,
  channelReadState,
  type NewMessage,
  type NewMessageReaction,
} from "@/db/schema-conversations"
import { users } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"

const MAX_MESSAGE_LENGTH = 4000
const EMOJI_REGEX = /^[\p{Emoji}\u200d]+$/u

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true,
})

async function renderMarkdown(content: string): Promise<string> {
  const html = await marked(content)
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "em",
      "u",
      "s",
      "del",
      "code",
      "pre",
      "blockquote",
      "ul",
      "ol",
      "li",
      "a",
      "img",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "span",
      "div",
    ],
    ALLOWED_ATTR: ["href", "src", "alt", "title", "class", "id", "target", "rel"],
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  })
}

export async function sendMessage(data: {
  channelId: string
  content: string
  threadId?: string
}) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
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

    // Pre-render markdown to sanitized HTML
    const contentHtml = await renderMarkdown(data.content)

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

export async function editMessage(messageId: string, newContent: string) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
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

    // Re-render markdown to sanitized HTML
    const contentHtml = await renderMarkdown(newContent)

    await db
      .update(messages)
      .set({
        content: newContent,
        contentHtml,
        editedAt: now,
      })
      .where(eq(messages.id, messageId))

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
