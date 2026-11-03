/**
 * The only code that inserts, updates, or deletes the notification tables:
 * notification_events, notification_recipients, notification_deliveries, and
 * notification_preferences (architecture standard, section 1). No auth here:
 * callers resolve who is asking first.
 *
 * Functions named `...Statement` return an unexecuted statement so a caller
 * can put it in one atomic batch with another module's write (for example a
 * project message and its in-app notification).
 */
import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import {
  notificationDeliveries,
  notificationEvents,
  notificationPreferences,
  notificationRecipients,
} from "@/db/schema"
import { messages } from "@/db/schema-conversations"
import { chunkD1Values } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

type EventInsert = typeof notificationEvents.$inferInsert
type RecipientInsert = typeof notificationRecipients.$inferInsert
type DeliveryInsert = typeof notificationDeliveries.$inferInsert
type PreferenceValues = Omit<typeof notificationPreferences.$inferInsert, "userId">
type EventChanges = Partial<Pick<EventInsert, "eventType" | "title" | "body" | "href">>

/** `ignoreConflict` makes a deterministic id idempotent across retries. */
type InsertOptions = { readonly ignoreConflict?: boolean }

// ---------------------------------------------------------------------------
// Events, recipients, deliveries
// ---------------------------------------------------------------------------

export function notificationEventInsertStatement(
  db: Db,
  row: EventInsert,
  options: InsertOptions = {}
): BatchItem<"sqlite"> {
  const insert = db.insert(notificationEvents).values(row)
  return options.ignoreConflict ? insert.onConflictDoNothing() : insert
}

export function notificationRecipientInsertStatement(
  db: Db,
  row: RecipientInsert,
  options: InsertOptions = {}
): BatchItem<"sqlite"> {
  const insert = db.insert(notificationRecipients).values(row)
  return options.ignoreConflict ? insert.onConflictDoNothing() : insert
}

export async function insertNotificationEvent(db: Db, row: EventInsert): Promise<void> {
  await db.insert(notificationEvents).values(row)
}

export async function insertNotificationRecipient(db: Db, row: RecipientInsert): Promise<void> {
  await db.insert(notificationRecipients).values(row)
}

export async function insertNotificationDelivery(db: Db, row: DeliveryInsert): Promise<void> {
  await db.insert(notificationDeliveries).values(row)
}

/** Which of one person's notification events a change applies to. */
export type NotificationSourceMatch = {
  readonly organizationId: string
  readonly sourceType: string
  readonly sourceId: string
  readonly createdBy: string
}

/** Rewrites the events a person created for one source record. */
export async function updateNotificationEventsForSource(
  db: Db,
  match: NotificationSourceMatch,
  changes: EventChanges
): Promise<void> {
  await db
    .update(notificationEvents)
    .set(changes)
    .where(
      and(
        eq(notificationEvents.organizationId, match.organizationId),
        eq(notificationEvents.sourceType, match.sourceType),
        eq(notificationEvents.sourceId, match.sourceId),
        eq(notificationEvents.createdBy, match.createdBy),
      ),
    )
    .run()
}

// ---------------------------------------------------------------------------
// Recipient read / dismissed state
// ---------------------------------------------------------------------------

function eventIdsWhere(db: Db, condition: SQL | undefined) {
  return db.select({ id: notificationEvents.id }).from(notificationEvents).where(condition)
}

/** One bell item, only when it is the viewer's and inside `eventScope`. */
export async function markNotificationRecipientRead(
  db: Db,
  input: { readonly recipientId: string; readonly userId: string; readonly eventScope: SQL | undefined; readonly now: string }
): Promise<void> {
  await db
    .update(notificationRecipients)
    .set({ readAt: input.now })
    .where(
      and(
        eq(notificationRecipients.id, input.recipientId),
        eq(notificationRecipients.userId, input.userId),
        inArray(notificationRecipients.eventId, eventIdsWhere(db, input.eventScope))
      )
    )
}

export async function markAllNotificationRecipientsRead(
  db: Db,
  input: { readonly userId: string; readonly eventScope: SQL | undefined; readonly now: string }
): Promise<void> {
  await db
    .update(notificationRecipients)
    .set({ readAt: input.now })
    .where(
      and(
        eq(notificationRecipients.userId, input.userId),
        isNull(notificationRecipients.readAt),
        inArray(notificationRecipients.eventId, eventIdsWhere(db, input.eventScope))
      )
    )
}

/** Done / Undo: `dismissed` also marks the rows read; Undo only restores them. */
export async function setNotificationRecipientsDismissed(
  db: Db,
  input: {
    readonly recipientIds: readonly string[]
    readonly userId: string
    readonly dismissed: boolean
    readonly eventScope: SQL | undefined
    readonly now: string
  }
): Promise<void> {
  for (const chunk of chunkD1Values(input.recipientIds)) {
    await db
      .update(notificationRecipients)
      .set(input.dismissed ? { dismissedAt: input.now, readAt: input.now } : { dismissedAt: null })
      .where(
        and(
          inArray(notificationRecipients.id, chunk),
          eq(notificationRecipients.userId, input.userId),
          inArray(notificationRecipients.eventId, eventIdsWhere(db, input.eventScope))
        )
      )
  }
}

/** Clear read: hides every read, still-visible bell item in the scope. */
export async function dismissReadNotificationRecipients(
  db: Db,
  input: { readonly userId: string; readonly eventScope: SQL | undefined; readonly now: string }
): Promise<void> {
  await db
    .update(notificationRecipients)
    .set({ dismissedAt: input.now })
    .where(
      and(
        eq(notificationRecipients.userId, input.userId),
        isNotNull(notificationRecipients.readAt),
        isNull(notificationRecipients.dismissedAt),
        inArray(notificationRecipients.eventId, eventIdsWhere(db, input.eventScope))
      )
    )
}

/** A person opened one of their own notifications from a push or link. */
export async function markOwnNotificationRecipientRead(
  db: Db,
  recipientId: string,
  userId: string,
  now: string
): Promise<void> {
  await db
    .update(notificationRecipients)
    .set({ readAt: now })
    .where(and(eq(notificationRecipients.id, recipientId), eq(notificationRecipients.userId, userId)))
}

/**
 * Dismisses still-open recipient rows by id and returns how many changed.
 */
export async function dismissNotificationRecipients(
  db: Db,
  recipientIds: readonly string[],
  dismissedAt: string
): Promise<number> {
  let resolved = 0
  for (const chunk of chunkD1Values(recipientIds)) {
    const updated = await db
      .update(notificationRecipients)
      .set({ dismissedAt })
      .where(and(inArray(notificationRecipients.id, chunk), isNull(notificationRecipients.dismissedAt)))
      .returning({ id: notificationRecipients.id })
    resolved += updated.length
  }
  return resolved
}

/** Dismisses every open recipient row of one event (an incident resolved). */
export function dismissEventRecipientsStatement(db: Db, eventId: string, dismissedAt: string): BatchItem<"sqlite"> {
  return db
    .update(notificationRecipients)
    .set({ dismissedAt })
    .where(and(eq(notificationRecipients.eventId, eventId), isNull(notificationRecipients.dismissedAt)))
}

/**
 * Marks the viewer's own unread notifications read for source records they
 * have just seen. `sourceIds` is an explicit id list or an `IN` subquery.
 */
export async function markSourceNotificationsRead(
  db: Db,
  userId: string,
  sourceType: string,
  sourceIds: SQL | readonly string[]
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
            eventIdsWhere(
              db,
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
  for (const chunk of chunkD1Values(sourceIds)) {
    if (chunk.length > 0) await update(chunk)
  }
}

/** `IN` subquery: a channel's top-level messages up to `cutoff`. */
export function channelMessageIdsUpTo(channelId: string, cutoff: string): SQL {
  return sql`(SELECT ${messages.id} FROM ${messages} WHERE ${messages.channelId} = ${channelId} AND ${messages.threadId} IS NULL AND ${messages.createdAt} <= ${cutoff})`
}

/** `IN` subquery: a thread's parent message and its replies. */
export function threadMessageIds(parentMessageId: string): SQL {
  return sql`(SELECT ${messages.id} FROM ${messages} WHERE ${messages.id} = ${parentMessageId} OR ${messages.threadId} = ${parentMessageId})`
}

/**
 * Marks reminder notifications of one kind read for everyone who received
 * them, once the records they point at are no longer outstanding.
 */
export async function clearReminderNotifications(
  db: Db,
  input: { readonly sourceType: string; readonly eventType: string; readonly sourceIds: readonly string[] }
): Promise<void> {
  const now = new Date().toISOString()
  for (const chunk of chunkD1Values(input.sourceIds)) {
    if (chunk.length === 0) continue
    await db
      .update(notificationRecipients)
      .set({ readAt: now })
      .where(
        and(
          isNull(notificationRecipients.readAt),
          inArray(
            notificationRecipients.eventId,
            eventIdsWhere(
              db,
              and(
                eq(notificationEvents.sourceType, input.sourceType),
                eq(notificationEvents.eventType, input.eventType),
                inArray(notificationEvents.sourceId, chunk),
              ),
            ),
          ),
        ),
      )
  }
}

// ---------------------------------------------------------------------------
// Raw D1 statements gated by the caller's guard (Sage Square alerts)
// ---------------------------------------------------------------------------

/**
 * SQL the caller owns that must hold for the write to apply (for example
 * "the receipt is still open"), with its bind values in order.
 */
export type NotificationWriteGuard = { readonly sql: string; readonly binds: readonly unknown[] }

/** One internal-audience bell event with a deterministic id. */
export type InternalNotificationEventInsert = {
  readonly id: string
  readonly organizationId: string
  readonly projectId: string | null
  readonly eventType: string
  readonly sourceType: string
  readonly sourceId: string
  readonly title: string
  readonly body: string
  readonly href: string
  readonly priority: string
  readonly createdAt: string
}

/** Inserts the event only while `guard` holds; a repeated id is a no-op, so retries are idempotent. */
export function insertInternalNotificationEventWhereStatement(
  database: D1Database,
  event: InternalNotificationEventInsert,
  guard: NotificationWriteGuard
): D1PreparedStatement {
  return database.prepare(`INSERT INTO notification_events
    (id, organization_id, project_id, event_type, source_type, source_id, title, body, href, priority, audience, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'internal', ?
    WHERE ${guard.sql} ON CONFLICT(id) DO NOTHING`)
    .bind(event.id, event.organizationId, event.projectId, event.eventType, event.sourceType, event.sourceId,
      event.title, event.body, event.href, event.priority, event.createdAt, ...guard.binds)
}

/** Inserts one in-app-only recipient only while `guard` holds; a repeated id is a no-op. */
export function insertNotificationRecipientWhereStatement(
  database: D1Database,
  recipient: { readonly id: string; readonly eventId: string; readonly userId: string; readonly createdAt: string },
  guard: NotificationWriteGuard
): D1PreparedStatement {
  return database.prepare(`INSERT INTO notification_recipients (id, event_id, user_id, in_app, email, sms, push, created_at)
      SELECT ?, ?, ?, 1, 0, 0, 0, ? WHERE ${guard.sql} ON CONFLICT(id) DO NOTHING`)
    .bind(recipient.id, recipient.eventId, recipient.userId, recipient.createdAt, ...guard.binds)
}

/**
 * Dismisses (and with `markRead`, also reads) the recipient rows `where`
 * selects. Timestamps already set are kept.
 */
export function settleNotificationRecipientsWhereStatement(
  database: D1Database,
  input: { readonly markRead: boolean; readonly now: string; readonly where: NotificationWriteGuard }
): D1PreparedStatement {
  const read = input.markRead ? "read_at = COALESCE(read_at, ?), " : ""
  return database.prepare(`UPDATE notification_recipients SET ${read}dismissed_at = COALESCE(dismissed_at, ?)
     WHERE ${input.where.sql}`)
    .bind(...(input.markRead ? [input.now, input.now] : [input.now]), ...input.where.binds)
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/** Creates the person's preference row or updates exactly these fields. */
export async function upsertNotificationPreferences(
  db: Db,
  userId: string,
  values: PreferenceValues
): Promise<void> {
  await db
    .insert(notificationPreferences)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: notificationPreferences.userId, set: values })
}
