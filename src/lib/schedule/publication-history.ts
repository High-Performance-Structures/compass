import { and, desc, eq, sql } from "drizzle-orm"

import type { getDb } from "@/db"
import { schedulePublications } from "@/db/schema"

type Db = ReturnType<typeof getDb>

export type SchedulePublicationRecord = {
  readonly publishedAt: string
  readonly publishedBy: string | null
  readonly changeReason: string
  readonly snapshotData: string
}

// Migration 0076 seeded every existing project with an empty "Initial
// controlled schedule snapshot." Nobody published those schedules, so a
// publication only counts once it held at least one schedule item.
const holdsScheduleItems = sql`json_array_length(${schedulePublications.snapshotData}, '$.tasks') > 0`

/** The latest publication people actually made, ignoring empty placeholders. */
export async function latestSchedulePublication(
  db: Db,
  projectId: string
): Promise<SchedulePublicationRecord | null> {
  return db
    .select({
      publishedAt: schedulePublications.publishedAt,
      publishedBy: schedulePublications.publishedBy,
      changeReason: schedulePublications.changeReason,
      snapshotData: schedulePublications.snapshotData,
    })
    .from(schedulePublications)
    .where(
      and(eq(schedulePublications.projectId, projectId), holdsScheduleItems)
    )
    .orderBy(desc(schedulePublications.publishedAt))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

/**
 * Shift reasons explain changes to a schedule people have already seen.
 * A schedule that was never published needs none, even after edits move
 * its dates; one published and later moved back to draft still does.
 */
export async function isScheduleShiftReasonRequired(
  db: Db,
  projectId: string
): Promise<boolean> {
  return (await latestSchedulePublication(db, projectId)) !== null
}
