"use server"

import { getCloudflareContext } from "@/lib/db"
import { eq, and, gt, desc, sql, inArray } from "drizzle-orm"
import { getDb } from "@/db"
import {
  messages,
  typingSessions,
  channelMembers,
  messageAttachments,
  messageReactions,
} from "@/db/schema-conversations"
import { users } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"

type TypingUser = {
  id: string
  displayName: string | null
}

type MessageWithUser = {
  id: string
  channelId: string
  threadId: string | null
  content: string
  contentHtml: string | null
  editedAt: string | null
  deletedAt: string | null
  isPinned: boolean
  replyCount: number
  lastReplyAt: string | null
  createdAt: string
  user: {
    id: string
    displayName: string | null
    email: string
    role: string
    avatarUrl: string | null
  } | null
  attachments: readonly MessageAttachmentData[]
  reactions: readonly MessageReactionData[]
}

type MessageAttachmentData = {
  readonly id: string
  readonly fileName: string
  readonly mimeType: string
  readonly fileSize: number
  readonly storageProvider: string
  readonly driveFileId: string | null
  readonly driveUrl: string | null
  readonly downloadUrl: string | null
  readonly uploadedAt: string
}

type MessageReactionData = {
  readonly emoji: string
  readonly count: number
  readonly reactedByCurrentUser: boolean
}

type ChannelUpdatesResult = {
  messages: MessageWithUser[]
  typingUsers: TypingUser[]
}

const messageSelectFields = {
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
    role: users.role,
    avatarUrl: users.avatarUrl,
  },
} as const

async function attachmentsByMessageId(
  db: ReturnType<typeof getDb>,
  messageIds: readonly string[]
): Promise<Map<string, readonly MessageAttachmentData[]>> {
  const ids = Array.from(new Set(messageIds))
  if (ids.length === 0) return new Map()

  const rows = await db
    .select({
      id: messageAttachments.id,
      messageId: messageAttachments.messageId,
      fileName: messageAttachments.fileName,
      mimeType: messageAttachments.mimeType,
      fileSize: messageAttachments.fileSize,
      storageProvider: messageAttachments.storageProvider,
      driveFileId: messageAttachments.driveFileId,
      driveUrl: messageAttachments.driveUrl,
      downloadUrl: messageAttachments.downloadUrl,
      uploadedAt: messageAttachments.uploadedAt,
    })
    .from(messageAttachments)
    .where(inArray(messageAttachments.messageId, ids))

  const grouped = new Map<string, MessageAttachmentData[]>()
  for (const row of rows) {
    const existing = grouped.get(row.messageId) ?? []
    existing.push({
      id: row.id,
      fileName: row.fileName,
      mimeType: row.mimeType,
      fileSize: row.fileSize,
      storageProvider: row.storageProvider,
      driveFileId: row.driveFileId,
      driveUrl: row.driveUrl,
      downloadUrl: `/api/conversations/attachments/${row.id}`,
      uploadedAt: row.uploadedAt,
    })
    grouped.set(row.messageId, existing)
  }

  return grouped
}

async function reactionsByMessageId(
  db: ReturnType<typeof getDb>,
  messageIds: readonly string[],
  currentUserId: string
): Promise<Map<string, readonly MessageReactionData[]>> {
  const ids = Array.from(new Set(messageIds))
  if (ids.length === 0) return new Map()

  const rows = await db
    .select({
      messageId: messageReactions.messageId,
      emoji: messageReactions.emoji,
      userId: messageReactions.userId,
    })
    .from(messageReactions)
    .where(inArray(messageReactions.messageId, ids))

  const grouped = new Map<
    string,
    Map<string, { count: number; reactedByCurrentUser: boolean }>
  >()

  for (const row of rows) {
    const reactionsForMessage = grouped.get(row.messageId) ?? new Map()
    const current = reactionsForMessage.get(row.emoji) ?? {
      count: 0,
      reactedByCurrentUser: false,
    }
    reactionsForMessage.set(row.emoji, {
      count: current.count + 1,
      reactedByCurrentUser:
        current.reactedByCurrentUser || row.userId === currentUserId,
    })
    grouped.set(row.messageId, reactionsForMessage)
  }

  const result = new Map<string, readonly MessageReactionData[]>()
  for (const [messageId, reactionMap] of grouped.entries()) {
    result.set(
      messageId,
      Array.from(reactionMap.entries()).map(([emoji, summary]) => ({
        emoji,
        count: summary.count,
        reactedByCurrentUser: summary.reactedByCurrentUser,
      }))
    )
  }

  return result
}

export async function getChannelUpdates(
  channelId: string,
  lastMessageId?: string
): Promise<{ success: true; data: ChannelUpdatesResult } | { success: false; error: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify user is a member of the channel
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

    const now = new Date().toISOString()

    // clean up expired typing sessions
    await db
      .delete(typingSessions)
      .where(sql`${typingSessions.expiresAt} < ${now}`)

    // fetch new messages since lastMessageId (or last 20 if no cursor)
    let messagesQuery = db
      .select(messageSelectFields)
      .from(messages)
      .leftJoin(users, eq(users.id, messages.userId))
      .where(eq(messages.channelId, channelId))
      .orderBy(desc(messages.createdAt))

    if (lastMessageId) {
      // find the createdAt of the lastMessageId to use as cursor
      const lastMessage = await db
        .select({ createdAt: messages.createdAt })
        .from(messages)
        .where(eq(messages.id, lastMessageId))
        .limit(1)
        .then((rows) => rows[0] ?? null)

      if (lastMessage) {
        messagesQuery = db
          .select(messageSelectFields)
          .from(messages)
          .leftJoin(users, eq(users.id, messages.userId))
          .where(
            and(
              eq(messages.channelId, channelId),
              gt(messages.createdAt, lastMessage.createdAt)
            )
          )
          .orderBy(desc(messages.createdAt))
      }
    }

    const fetchedMessages = await messagesQuery.limit(lastMessageId ? 100 : 20)
    const attachmentMap = await attachmentsByMessageId(
      db,
      fetchedMessages.map((message) => message.id)
    )
    const reactionMap = await reactionsByMessageId(
      db,
      fetchedMessages.map((message) => message.id),
      user.id
    )

    // replace deleted content with placeholder
    const sanitizedMessages: MessageWithUser[] = fetchedMessages.map((msg) => ({
      ...msg,
      content: msg.deletedAt ? "[Message deleted]" : msg.content,
      contentHtml: msg.deletedAt ? null : msg.contentHtml,
      attachments: msg.deletedAt ? [] : attachmentMap.get(msg.id) ?? [],
      reactions: msg.deletedAt ? [] : reactionMap.get(msg.id) ?? [],
    }))

    // fetch currently typing users (excluding current user)
    const typingUsers = await db
      .select({
        id: users.id,
        displayName: users.displayName,
      })
      .from(typingSessions)
      .leftJoin(users, eq(users.id, typingSessions.userId))
      .where(
        and(
          eq(typingSessions.channelId, channelId),
          gt(typingSessions.expiresAt, now),
          sql`${typingSessions.userId} != ${user.id}`
        )
      )
      .then((rows) => rows as TypingUser[])

    return {
      success: true,
      data: {
        messages: sanitizedMessages,
        typingUsers,
      },
    }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to get channel updates",
    }
  }
}

export async function setTyping(
  channelId: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify user is a member of the channel
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

    const now = new Date()
    const expiresAt = new Date(now.getTime() + 5000).toISOString() // 5-second expiry
    const startedAt = now.toISOString()

    // check if typing session already exists for this user/channel
    const existingSession = await db
      .select()
      .from(typingSessions)
      .where(
        and(
          eq(typingSessions.channelId, channelId),
          eq(typingSessions.userId, user.id)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (existingSession) {
      // update existing session expiry
      await db
        .update(typingSessions)
        .set({ expiresAt })
        .where(eq(typingSessions.id, existingSession.id))
    } else {
      // create new typing session
      const sessionId = crypto.randomUUID()
      await db.insert(typingSessions).values({
        id: sessionId,
        channelId,
        userId: user.id,
        startedAt,
        expiresAt,
      })
    }

    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to set typing status",
    }
  }
}
