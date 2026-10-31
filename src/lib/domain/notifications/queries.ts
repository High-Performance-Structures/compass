/**
 * Reads of the notification tables that other modules share. Writes live in
 * store.ts.
 */
import { and, eq, isNull, lt, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"

import { notificationEvents } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"

export type UnrecoveredEventFilter = {
  readonly organizationId: string
  readonly sourceType: string
  readonly eventType: string
  /** Matches `source_id LIKE '<prefix>%'`. */
  readonly sourceIdPrefix: string
  readonly createdBefore: string
  readonly limit: number
}

/**
 * Failure events that have no `<id>:recovered` follow-up yet. The filter
 * leads with organization_id, source_type, event_type and a created_at range,
 * so SQLite searches notification_events_org_source_idx (migration 0274) and
 * looks each recovery row up by primary key; the source_id prefix is checked
 * only on those index rows. A test pins the query plan.
 */
export function unrecoveredNotificationEventsQuery(db: Db, filter: UnrecoveredEventFilter) {
  const recovery = alias(notificationEvents, "recovery")
  return db
    .select({
      id: notificationEvents.id,
      sourceId: notificationEvents.sourceId,
    })
    .from(notificationEvents)
    .leftJoin(recovery, eq(recovery.id, sql`${notificationEvents.id} || ':recovered'`))
    .where(
      and(
        eq(notificationEvents.organizationId, filter.organizationId),
        eq(notificationEvents.sourceType, filter.sourceType),
        eq(notificationEvents.eventType, filter.eventType),
        sql`${notificationEvents.sourceId} LIKE ${filter.sourceIdPrefix + "%"}`,
        lt(notificationEvents.createdAt, filter.createdBefore),
        isNull(recovery.id)
      )
    )
    .limit(filter.limit)
}

export async function unrecoveredNotificationEvents(
  db: Db,
  filter: UnrecoveredEventFilter
): Promise<ReadonlyArray<{ readonly id: string; readonly sourceId: string | null }>> {
  return unrecoveredNotificationEventsQuery(db, filter)
}
