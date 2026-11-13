/**
 * The only code that inserts, updates, or deletes the conversation tables:
 * channels, channel_members, channel_read_state, channel_thread_user_state,
 * messages, message_mentions, message_reactions and message_attachments (architecture standard,
 * section 1). No auth here: callers check channel membership first.
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import {
  channelMembers,
  channelReadState,
  channelThreadUserState,
  channels,
  messageAttachments,
  messageMentions,
  messageReactions,
  messages,
} from "@/db/schema-conversations"
import { chunkD1InsertRows } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

type ChannelInsert = typeof channels.$inferInsert
type MemberInsert = typeof channelMembers.$inferInsert
type ReadStateInsert = typeof channelReadState.$inferInsert
type MessageInsert = typeof messages.$inferInsert
type InsertOptions = { readonly ignoreConflict?: boolean }

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export async function insertChannel(db: Db, row: ChannelInsert): Promise<void> {
  await db.insert(channels).values(row)
}

/**
 * Opens a staff-only imported conversation to its owner or vendor audience.
 * Only when it is still staff-only and imported, so a stale request does nothing.
 */
export async function openImportedChannelAudience(
  db: Db,
  input: { readonly channelId: string; readonly audience: "clients" | "sub_vendors" }
): Promise<void> {
  // updated_at is left alone: sharing history is not new conversation activity.
  await db
    .update(channels)
    .set({ audience: input.audience })
    .where(and(eq(channels.id, input.channelId), eq(channels.audience, "staff"), sql`${channels.sourceSystem} IS NOT NULL`))
}

/** Orders conversation lists by real activity. */
export async function touchChannel(db: Db, channelId: string, updatedAt: string): Promise<void> {
  await db.update(channels).set({ updatedAt }).where(eq(channels.id, channelId))
}

/** Staff closed (a time) or reopened (null) a conversation in the project messages inbox. */
export async function setChannelThreadClosed(db: Db, channelId: string, closedAt: string | null): Promise<void> {
  await db.update(channels).set({ threadClosedAt: closedAt }).where(eq(channels.id, channelId))
}

/** One person's inbox flag change: each set flag is turned on (now) or off (null); others are kept. */
export type ChannelThreadStatePatch = {
  readonly saved?: boolean
  readonly needsReply?: boolean
  readonly archived?: boolean
}

export function upsertChannelThreadStateStatement(
  db: Db,
  input: { readonly organizationId: string; readonly channelId: string; readonly userId: string; readonly patch: ChannelThreadStatePatch; readonly now: string }
): BatchItem<"sqlite"> {
  const flag = (value: boolean): string | null => value ? input.now : null
  const changes = {
    ...(input.patch.saved === undefined ? {} : { savedAt: flag(input.patch.saved) }),
    ...(input.patch.needsReply === undefined ? {} : { needsReplyAt: flag(input.patch.needsReply) }),
    ...(input.patch.archived === undefined ? {} : { archivedAt: flag(input.patch.archived) }),
    updatedAt: input.now,
  }
  return db
    .insert(channelThreadUserState)
    .values({ id: crypto.randomUUID(), organizationId: input.organizationId, channelId: input.channelId, userId: input.userId, ...changes })
    .onConflictDoUpdate({ target: [channelThreadUserState.channelId, channelThreadUserState.userId], set: changes })
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function insertChannelMembers(db: Db, rows: readonly MemberInsert[], options: InsertOptions = {}): Promise<void> {
  // One user can join hundreds of imported conversations at once (access-request
  // approval); split so each statement stays under D1's 100-parameter limit.
  for (const chunk of chunkD1InsertRows(channelMembers, rows)) {
    const insert = db.insert(channelMembers).values(chunk)
    await (options.ignoreConflict ? insert.onConflictDoNothing() : insert).run()
  }
}

export async function setChannelMemberRole(db: Db, channelId: string, userId: string, role: string): Promise<void> {
  await db
    .update(channelMembers)
    .set({ role })
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
    .run()
}

export async function removeChannelMembers(db: Db, channelId: string, userIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) return
  await db
    .delete(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), inArray(channelMembers.userId, [...userIds])))
    .run()
}

// ---------------------------------------------------------------------------
// Read state
// ---------------------------------------------------------------------------

export async function insertReadStates(db: Db, rows: readonly ReadStateInsert[], options: InsertOptions = {}): Promise<void> {
  for (const chunk of chunkD1InsertRows(channelReadState, rows)) {
    const insert = db.insert(channelReadState).values(chunk)
    await (options.ignoreConflict ? insert.onConflictDoNothing() : insert).run()
  }
}

export async function removeReadStates(db: Db, channelId: string, userIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) return
  await db
    .delete(channelReadState)
    .where(and(eq(channelReadState.channelId, channelId), inArray(channelReadState.userId, [...userIds])))
    .run()
}

/** A new message is unread for everyone in the channel except its sender. */
export async function incrementUnreadForOthers(db: Db, channelId: string, senderUserId: string): Promise<void> {
  await db
    .update(channelReadState)
    .set({ unreadCount: sql`${channelReadState.unreadCount} + 1` })
    .where(and(eq(channelReadState.channelId, channelId), ne(channelReadState.userId, senderUserId)))
}

/** The person has read the channel up to `lastReadMessageId`. */
export async function markChannelReadForUser(
  db: Db,
  input: { readonly channelId: string; readonly userId: string; readonly lastReadMessageId: string; readonly lastReadAt: string }
): Promise<void> {
  const read = { lastReadMessageId: input.lastReadMessageId, lastReadAt: input.lastReadAt, unreadCount: 0 }
  await db
    .update(channelReadState)
    .set(read)
    .where(and(eq(channelReadState.channelId, input.channelId), eq(channelReadState.userId, input.userId)))
}

/** Same as `markChannelReadForUser`, creating the read-state row if missing. */
export async function upsertChannelReadForUser(
  db: Db,
  input: { readonly existingId: string | null; readonly channelId: string; readonly userId: string; readonly lastReadMessageId: string; readonly lastReadAt: string }
): Promise<void> {
  const read = { lastReadMessageId: input.lastReadMessageId, lastReadAt: input.lastReadAt, unreadCount: 0 }
  if (input.existingId) {
    await db.update(channelReadState).set(read).where(eq(channelReadState.id, input.existingId))
    return
  }
  await db
    .insert(channelReadState)
    .values({ id: crypto.randomUUID(), userId: input.userId, channelId: input.channelId, ...read })
    .onConflictDoUpdate({ target: [channelReadState.channelId, channelReadState.userId], set: read })
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function insertMessage(db: Db, row: MessageInsert): Promise<void> {
  await db.insert(messages).values(row)
}

/** Inserts a message once by id; returns the inserted id or nothing. */
export async function insertMessageOnce(db: Db, row: MessageInsert): Promise<ReadonlyArray<{ readonly id: string }>> {
  return db.insert(messages).values(row).onConflictDoNothing({ target: messages.id }).returning({ id: messages.id })
}

/** A reply was posted in this thread. */
export async function recordThreadReply(db: Db, parentMessageId: string, repliedAt: string): Promise<void> {
  await db
    .update(messages)
    .set({ replyCount: sql`${messages.replyCount} + 1`, lastReplyAt: repliedAt })
    .where(eq(messages.id, parentMessageId))
}

export async function updateMessage(
  db: Db,
  messageId: string,
  changes: Partial<Pick<MessageInsert, "content" | "contentHtml" | "editedAt" | "deletedAt" | "deletedBy" | "isPinned">>
): Promise<void> {
  await db.update(messages).set(changes).where(eq(messages.id, messageId))
}

export async function insertMessageMentions(db: Db, rows: readonly (typeof messageMentions.$inferInsert)[]): Promise<void> {
  for (const chunk of chunkD1InsertRows(messageMentions, rows)) {
    await db.insert(messageMentions).values(chunk)
  }
}

export async function insertMessageReaction(db: Db, row: typeof messageReactions.$inferInsert): Promise<void> {
  await db.insert(messageReactions).values(row)
}

export async function removeMessageReaction(db: Db, messageId: string, userId: string, emoji: string): Promise<void> {
  await db
    .delete(messageReactions)
    .where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, userId), eq(messageReactions.emoji, emoji)))
}

/**
 * A directory contact who sent imported messages now has a Compass account:
 * their imported messages move from the importing staff account to theirs.
 * Scoped to one project's imported conversations.
 */
export async function adoptImportedSenderMessages(
  db: Db,
  input: { readonly projectId: string; readonly projectContactId: string; readonly userId: string }
): Promise<void> {
  await db
    .update(messages)
    .set({ userId: input.userId, importedSenderContactId: null })
    .where(
      and(
        eq(messages.importedSenderContactId, input.projectContactId),
        sql`${messages.sourceSystem} IS NOT NULL`,
        sql`${messages.channelId} IN (SELECT c.id FROM channels c WHERE c.project_id = ${input.projectId})`
      )
    )
}

export async function insertMessageAttachment(db: Db, row: typeof messageAttachments.$inferInsert): Promise<void> {
  await db.insert(messageAttachments).values(row)
}

/**
 * Undo a failed project grant: drop the user from every conversation on the
 * project that they joined at `joinedAt` (the grant's timestamp), with the
 * read states created alongside.
 */
export async function removeProjectChannelsJoinedAt(
  db: Db,
  input: { readonly projectId: string; readonly userId: string; readonly joinedAt: string },
): Promise<void> {
  const projectChannels = sql`(SELECT c.id FROM channels c WHERE c.project_id = ${input.projectId})`
  const joined = await db
    .select({ channelId: channelMembers.channelId })
    .from(channelMembers)
    .where(and(
      eq(channelMembers.userId, input.userId),
      eq(channelMembers.joinedAt, input.joinedAt),
      sql`${channelMembers.channelId} IN ${projectChannels}`,
    ))
  const channelIds = joined.map((row) => row.channelId)
  if (channelIds.length === 0) return
  await db.delete(channelReadState)
    .where(and(eq(channelReadState.userId, input.userId), inArray(channelReadState.channelId, channelIds)))
    .run()
  await db.delete(channelMembers)
    .where(and(eq(channelMembers.userId, input.userId), eq(channelMembers.joinedAt, input.joinedAt), sql`${channelMembers.channelId} IN ${projectChannels}`))
    .run()
}
