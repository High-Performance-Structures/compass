import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm"
import type { getDb } from "@/db"
import { notificationEvents, notificationRecipients } from "@/db/schema"
import { messages } from "@/db/schema-conversations"

type Db = ReturnType<typeof getDb>

// D1 caps bound parameters per statement; explicit id lists stay well below it.
const ID_CHUNK = 50

/**
 * Marks the viewer's own bell notifications read for records they have just
 * seen, so a message is handled once (in the conversation) instead of again
 * in the bell. Only the viewer's notification rows are touched.
 */
async function markSourceNotificationsRead(
  db: Db,
  userId: string,
  sourceType: string,
  sourceIds: SQL | readonly string[],
): Promise<void> {
  const now = new Date().toISOString()
  const update = (ids: SQL | readonly string[]): Promise<unknown> =>
    db
      .update(notificationRecipients)
      .set({ readAt: now })
      .where(
        and(
          eq(notificationRecipients.userId, userId),
          isNull(notificationRecipients.readAt),
          inArray(
            notificationRecipients.eventId,
            db
              .select({ id: notificationEvents.id })
              .from(notificationEvents)
              .where(
                and(
                  eq(notificationEvents.sourceType, sourceType),
                  Array.isArray(ids)
                    ? inArray(notificationEvents.sourceId, [...ids])
                    : sql`${notificationEvents.sourceId} IN ${ids}`,
                ),
              ),
          ),
        ),
      )
  if (!Array.isArray(sourceIds)) {
    await update(sourceIds)
    return
  }
  for (let start = 0; start < sourceIds.length; start += ID_CHUNK) {
    const chunk = sourceIds.slice(start, start + ID_CHUNK)
    if (chunk.length > 0) await update(chunk)
  }
}

/**
 * A channel was read up to `cutoff` (the newest message on screen): clear
 * notifications for its top-level messages up to then. Thread replies clear
 * when the thread itself is opened.
 */
export async function markChannelNotificationsRead(
  db: Db,
  userId: string,
  channelId: string,
  cutoff: string,
): Promise<void> {
  await markSourceNotificationsRead(
    db,
    userId,
    "message",
    sql`(SELECT ${messages.id} FROM ${messages} WHERE ${messages.channelId} = ${channelId} AND ${messages.threadId} IS NULL AND ${messages.createdAt} <= ${cutoff})`,
  )
}

/** A thread was opened: clear notifications for its parent and replies. */
export async function markThreadNotificationsRead(
  db: Db,
  userId: string,
  parentMessageId: string,
): Promise<void> {
  await markSourceNotificationsRead(
    db,
    userId,
    "message",
    sql`(SELECT ${messages.id} FROM ${messages} WHERE ${messages.id} = ${parentMessageId} OR ${messages.threadId} = ${parentMessageId})`,
  )
}

/** Project messages the viewer has opened. */
export async function markCorrespondenceNotificationsRead(
  db: Db,
  userId: string,
  messageIds: readonly string[],
): Promise<void> {
  await markSourceNotificationsRead(db, userId, "project_correspondence", messageIds)
}
