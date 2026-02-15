"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { eq, and, or, like, sql, gte, lte, desc, inArray } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import { getDb } from "@/db"
import { messages, channels, channelMembers } from "@/db/schema-conversations"
import { users } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"

const MAX_QUERY_LENGTH = 100

function escapeLikeWildcards(str: string): string {
  return str.replace(/[%_]/g, (char) => `\\${char}`)
}

type SearchFilters = {
  channelId?: string
  userId?: string
  startDate?: string
  endDate?: string
}

type SearchResultMessage = {
  id: string
  content: string
  channelId: string
  channelName: string
  createdAt: string
  user: {
    id: string
    displayName: string | null
    avatarUrl: string | null
  }
}

export async function searchMessages(
  query: string,
  filters?: SearchFilters
): Promise<
  | { success: true; data: SearchResultMessage[] }
  | { success: false; error: string }
> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    if (!query || query.trim().length === 0) {
      return { success: false, error: "Search query is required" }
    }

    if (query.length > MAX_QUERY_LENGTH) {
      return { success: false, error: `Search query too long (max ${MAX_QUERY_LENGTH} characters)` }
    }

    const escapedQuery = escapeLikeWildcards(query)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // get all channels user has access to
    const accessibleChannels = await db
      .select({ channelId: channelMembers.channelId })
      .from(channelMembers)
      .where(eq(channelMembers.userId, user.id))

    if (accessibleChannels.length === 0) {
      return { success: true, data: [] }
    }

    const accessibleChannelIds = accessibleChannels.map((c) => c.channelId)

    // build filter conditions
    const conditions: (SQL<unknown> | undefined)[] = [
      inArray(messages.channelId, accessibleChannelIds),
      like(messages.content, `%${escapedQuery}%`),
      sql`${messages.deletedAt} IS NULL`, // exclude deleted messages
    ]

    if (filters?.channelId) {
      // verify user has access to this specific channel
      if (!accessibleChannelIds.includes(filters.channelId)) {
        return { success: false, error: "No access to this channel" }
      }
      conditions.push(eq(messages.channelId, filters.channelId))
    }

    if (filters?.userId) {
      conditions.push(eq(messages.userId, filters.userId))
    }

    if (filters?.startDate) {
      conditions.push(gte(messages.createdAt, filters.startDate))
    }

    if (filters?.endDate) {
      conditions.push(lte(messages.createdAt, filters.endDate))
    }

    const results = await db
      .select({
        id: messages.id,
        content: messages.content,
        channelId: messages.channelId,
        createdAt: messages.createdAt,
        channelName: channels.name,
        userId: messages.userId,
        userDisplayName: users.displayName,
        userAvatarUrl: users.avatarUrl,
      })
      .from(messages)
      .leftJoin(channels, eq(channels.id, messages.channelId))
      .leftJoin(users, eq(users.id, messages.userId))
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt))
      .limit(100)

    const searchResults: SearchResultMessage[] = results.map((row) => ({
      id: row.id,
      content: row.content,
      channelId: row.channelId,
      channelName: row.channelName ?? "Unknown Channel",
      createdAt: row.createdAt,
      user: {
        id: row.userId,
        displayName: row.userDisplayName,
        avatarUrl: row.userAvatarUrl,
      },
    }))

    return { success: true, data: searchResults }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to search messages",
    }
  }
}

export async function getPinnedMessages(
  channelId: string
): Promise<{ success: true; data: unknown[] } | { success: false; error: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify user is a channel member
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

    const pinnedMessages = await db
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
      .where(
        and(
          eq(messages.channelId, channelId),
          eq(messages.isPinned, true),
          sql`${messages.deletedAt} IS NULL`
        )
      )
      .orderBy(desc(messages.createdAt))

    return { success: true, data: pinnedMessages }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to get pinned messages",
    }
  }
}

export async function pinMessage(
  messageId: string
): Promise<{ success: true } | { success: false; error: string }> {
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

    // verify user is a channel member
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

    // check permission: message author or moderator+
    const isAuthor = message.userId === user.id
    const canModerate = (() => {
      try {
        requirePermission(user, "channels", "moderate")
        return true
      } catch {
        return false
      }
    })()

    // also allow if user has moderator role in the channel
    const isChannelModerator =
      membership.role === "moderator" || membership.role === "owner"

    if (!isAuthor && !canModerate && !isChannelModerator) {
      return {
        success: false,
        error: "Must be message author or have moderator permission to pin",
      }
    }

    if (message.isPinned) {
      return { success: false, error: "Message is already pinned" }
    }

    await db.update(messages).set({ isPinned: true }).where(eq(messages.id, messageId))

    revalidatePath("/dashboard")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to pin message",
    }
  }
}

export async function unpinMessage(
  messageId: string
): Promise<{ success: true } | { success: false; error: string }> {
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

    // verify user is a channel member
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

    // check permission: moderator+ required for unpin
    const canModerate = (() => {
      try {
        requirePermission(user, "channels", "moderate")
        return true
      } catch {
        return false
      }
    })()

    const isChannelModerator =
      membership.role === "moderator" || membership.role === "owner"

    if (!canModerate && !isChannelModerator) {
      return {
        success: false,
        error: "Must have moderator permission to unpin messages",
      }
    }

    if (!message.isPinned) {
      return { success: false, error: "Message is not pinned" }
    }

    await db
      .update(messages)
      .set({ isPinned: false })
      .where(eq(messages.id, messageId))

    revalidatePath("/dashboard")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to unpin message",
    }
  }
}
