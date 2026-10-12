import "server-only"

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import type { getDb } from "@/db"
import { users } from "@/db/schema"
import {
  channelMembers,
  channelReadState,
  channels,
  messages,
} from "@/db/schema-conversations"
import { isInternalStaffRole } from "@/lib/user-roles"

// Read-only conversation lookups for Ask Jarvis. Visibility mirrors
// listChannels in src/app/actions/conversations.ts: channels in the viewer's
// organization that aren't archived; internal staff also see public channels
// they haven't joined; outside users see only channels they belong to.

type Db = ReturnType<typeof getDb>

export interface MessageViewer {
  readonly id: string
  readonly role: string
  readonly organizationId: string
}

export interface VisibleChannel {
  readonly id: string
  readonly name: string
  readonly type: string
  readonly projectId: string | null
  readonly isMember: boolean
  readonly unreadCount: number
  readonly href: string
}

export interface VisibleMessage {
  readonly id: string
  readonly channelId: string
  readonly channelName: string
  readonly author: string
  readonly createdAt: string
  readonly content: string
  readonly href: string
}

const MAX_MESSAGE_CHARACTERS = 600
const MAX_SEARCH_CHARACTERS = 100
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export function conversationHref(channelId: string): string {
  return `/dashboard/conversations/${encodeURIComponent(channelId)}`
}

function visibilityCondition(viewer: MessageViewer): SQL | undefined {
  const internal = isInternalStaffRole(viewer.role)
  return and(
    eq(channels.organizationId, viewer.organizationId),
    sql`${channels.archivedAt} IS NULL`,
    internal
      ? sql`(${channels.isPrivate} = 0 OR ${channelMembers.userId} IS NOT NULL)`
      : and(
          sql`${channelMembers.userId} IS NOT NULL`,
          sql`${channels.id} NOT LIKE 'bt-message-archive-%'`,
        ),
  )
}

export async function listVisibleChannels(
  db: Db,
  viewer: MessageViewer,
): Promise<readonly VisibleChannel[]> {
  const rows = await db
    .select({
      id: channels.id,
      name: channels.name,
      type: channels.type,
      projectId: channels.projectId,
      memberUserId: channelMembers.userId,
      unreadCount: channelReadState.unreadCount,
    })
    .from(channels)
    .leftJoin(
      channelMembers,
      and(
        eq(channelMembers.channelId, channels.id),
        eq(channelMembers.userId, viewer.id),
      ),
    )
    .leftJoin(
      channelReadState,
      and(
        eq(channelReadState.channelId, channels.id),
        eq(channelReadState.userId, viewer.id),
      ),
    )
    .where(visibilityCondition(viewer))
    .orderBy(channels.sortOrder, channels.createdAt)

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    projectId: row.projectId,
    isMember: row.memberUserId !== null,
    unreadCount: row.unreadCount ?? 0,
    href: conversationHref(row.id),
  }))
}

function escapeLikeWildcards(value: string): string {
  return value.replace(/[%_\\]/g, (char) => `\\${char}`)
}

export async function searchVisibleMessages(
  db: Db,
  viewer: MessageViewer,
  options: {
    readonly search?: string
    readonly channelId?: string
    readonly since?: string
    readonly limit?: number
  },
): Promise<
  | { readonly success: true; readonly data: readonly VisibleMessage[] }
  | { readonly success: false; readonly error: string }
> {
  const visible = await listVisibleChannels(db, viewer)
  const visibleIds = visible.map((channel) => channel.id)
  if (options.channelId && !visibleIds.includes(options.channelId)) {
    return { success: false, error: "Conversation not found" }
  }
  const channelIds = options.channelId ? [options.channelId] : visibleIds
  if (channelIds.length === 0) return { success: true, data: [] }

  const conditions: SQL[] = [
    inArray(messages.channelId, channelIds),
    sql`${messages.deletedAt} IS NULL`,
  ]
  const search = options.search?.trim().slice(0, MAX_SEARCH_CHARACTERS)
  if (search) {
    // SQLite honors backslash escapes in LIKE only with an ESCAPE clause.
    const pattern = `%${escapeLikeWildcards(search)}%`
    conditions.push(sql`${messages.content} LIKE ${pattern} ESCAPE '\\'`)
  }
  if (options.since) {
    conditions.push(gte(messages.createdAt, options.since))
  }

  const limit = Math.min(
    Math.max(Math.trunc(options.limit ?? DEFAULT_LIMIT), 1),
    MAX_LIMIT,
  )
  const rows = await db
    .select({
      id: messages.id,
      channelId: messages.channelId,
      channelName: channels.name,
      createdAt: messages.createdAt,
      content: messages.content,
      authorName: users.displayName,
      authorEmail: users.email,
    })
    .from(messages)
    .innerJoin(channels, eq(channels.id, messages.channelId))
    .leftJoin(users, eq(users.id, messages.userId))
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(limit)

  return {
    success: true,
    data: rows.map((row) => ({
      id: row.id,
      channelId: row.channelId,
      channelName: row.channelName,
      author: row.authorName ?? row.authorEmail ?? "Unknown",
      createdAt: row.createdAt,
      content: row.content.slice(0, MAX_MESSAGE_CHARACTERS),
      href: conversationHref(row.channelId),
    })),
  }
}
