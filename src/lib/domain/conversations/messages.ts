import { and, desc, eq, inArray, lt, sql } from "drizzle-orm"

import { getDb } from "@/db"
import { users } from "@/db/schema"
import { messageAttachments, messageReactions, messages } from "@/db/schema-conversations"
import { getCurrentUser } from "@/lib/auth"
import { getConversationChannelAccess } from "@/lib/conversations/channel-access-server"
import { conversationRequestViewer } from "@/lib/conversations/preview-viewer"
import { getCloudflareContext } from "@/lib/db"

/*
 * Conversation message reads shared by the chat actions and the screens that
 * embed a conversation (field mode, the project conversation panel). Access
 * is the viewer's channel membership, as in the chat itself.
 */

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

export async function getAttachmentsByMessage(
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
      attachmentId: messageAttachments.id,
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
      storageUrl: `/api/conversations/attachments/${encodeURIComponent(row.attachmentId)}`,
    })
    attachments.set(row.messageId, existing)
  }
  return attachments
}

export async function getReactionsByMessage(
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

/** A channel's top-level messages, newest first, for the signed-in member. */
export async function readChannelMessages(
  channelId: string,
  options?: { limit?: number; cursor?: string }
) {
  try {
    const user = await conversationRequestViewer(await getCurrentUser())
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const channel = await getConversationChannelAccess({
      db,
      user,
      channelId,
    })
    if (!channel) {
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
