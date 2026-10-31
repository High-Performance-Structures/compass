/**
 * The only code that inserts, updates, or deletes the conversation tables:
 * channels, channel_members, channel_read_state, messages, message_mentions,
 * message_reactions and message_attachments (architecture standard,
 * section 1). No auth here: callers check channel membership first.
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm"

import {
  channelMembers,
  channelReadState,
  channels,
  messageAttachments,
  messageMentions,
  messageReactions,
  messages,
} from "@/db/schema-conversations"
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

/** Orders conversation lists by real activity. */
export async function touchChannel(db: Db, channelId: string, updatedAt: string): Promise<void> {
  await db.update(channels).set({ updatedAt }).where(eq(channels.id, channelId))
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function insertChannelMembers(db: Db, rows: readonly MemberInsert[], options: InsertOptions = {}): Promise<void> {
  if (rows.length === 0) return
  const insert = db.insert(channelMembers).values([...rows])
  await (options.ignoreConflict ? insert.onConflictDoNothing() : insert).run()
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
  if (rows.length === 0) return
  const insert = db.insert(channelReadState).values([...rows])
  await (options.ignoreConflict ? insert.onConflictDoNothing() : insert).run()
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
  await db.insert(messageMentions).values([...rows])
}

export async function insertMessageReaction(db: Db, row: typeof messageReactions.$inferInsert): Promise<void> {
  await db.insert(messageReactions).values(row)
}

export async function removeMessageReaction(db: Db, messageId: string, userId: string, emoji: string): Promise<void> {
  await db
    .delete(messageReactions)
    .where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, userId), eq(messageReactions.emoji, emoji)))
}

export async function insertMessageAttachment(db: Db, row: typeof messageAttachments.$inferInsert): Promise<void> {
  await db.insert(messageAttachments).values(row)
}
