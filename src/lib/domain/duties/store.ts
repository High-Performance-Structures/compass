import { and, eq, inArray } from "drizzle-orm"
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import { internalDutyEntries, recurringDuties, recurringDutyCompletions } from "@/db/schema-internal-duties"
import { chunkD1Values } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

/*
 * The duties domain store: the only code that inserts, updates or deletes
 * internal_duty_entries (duty log entries and daily log cost code lines),
 * recurring_duties and recurring_duty_completions (architecture standard,
 * section 1). No access rules here; callers check access first.
 */

type DutyEntryInsert = typeof internalDutyEntries.$inferInsert
type DutyEntryPatch = SQLiteUpdateSetSource<typeof internalDutyEntries>
type RecurringDutyInsert = typeof recurringDuties.$inferInsert
type RecurringDutyPatch = SQLiteUpdateSetSource<typeof recurringDuties>
type CompletionInsert = typeof recurringDutyCompletions.$inferInsert

// ---- internalDutyEntries

export async function insertDutyEntry(db: Db, values: DutyEntryInsert): Promise<void> {
  await db.insert(internalDutyEntries).values(values)
}

/**
 * Inserts entries in one atomic batch, one statement per row so each stays
 * under D1's bound-parameter cap.
 */
export async function insertDutyEntries(db: Db, rows: readonly DutyEntryInsert[]): Promise<void> {
  const [first, ...rest] = rows.map((row) => db.insert(internalDutyEntries).values(row))
  if (first) await db.batch([first, ...rest])
}

export async function updateDutyEntry(db: Db, entryId: string, patch: DutyEntryPatch): Promise<void> {
  await db.update(internalDutyEntries).set(patch).where(eq(internalDutyEntries.id, entryId))
}

/** A daily log moved to another project takes its cost code lines with it. */
export async function moveDailyLogDutyEntries(db: Db, dailyLogId: string, projectId: string, now: string): Promise<void> {
  await db
    .update(internalDutyEntries)
    .set({ projectId, updatedAt: now })
    .where(eq(internalDutyEntries.dailyLogId, dailyLogId))
}

export async function deleteDutyEntry(db: Db, entryId: string): Promise<void> {
  await db.delete(internalDutyEntries).where(eq(internalDutyEntries.id, entryId))
}

/** A daily log's cost code lines on one project, before they are written again. */
export async function deleteDailyLogDutyEntries(db: Db, dailyLogId: string, projectId: string): Promise<void> {
  await db
    .delete(internalDutyEntries)
    .where(and(eq(internalDutyEntries.dailyLogId, dailyLogId), eq(internalDutyEntries.projectId, projectId)))
}

/** The cost code lines of deleted daily logs. */
export async function deleteDutyEntriesForDailyLogs(db: Db, dailyLogIds: readonly string[]): Promise<void> {
  for (const ids of chunkD1Values(dailyLogIds)) {
    await db.delete(internalDutyEntries).where(inArray(internalDutyEntries.dailyLogId, ids))
  }
}

// ---- recurringDuties

export async function insertRecurringDuty(db: Db, values: RecurringDutyInsert): Promise<void> {
  await db.insert(recurringDuties).values(values)
}

export async function updateRecurringDuty(db: Db, dutyId: string, patch: RecurringDutyPatch): Promise<void> {
  await db.update(recurringDuties).set(patch).where(eq(recurringDuties.id, dutyId))
}

export async function deleteRecurringDuty(db: Db, dutyId: string): Promise<void> {
  await db.delete(recurringDuties).where(eq(recurringDuties.id, dutyId))
}

// ---- recurringDutyCompletions

export async function insertRecurringDutyCompletion(db: Db, values: CompletionInsert): Promise<void> {
  await db.insert(recurringDutyCompletions).values(values)
}

export async function deleteRecurringDutyCompletion(db: Db, completionId: string): Promise<void> {
  await db.delete(recurringDutyCompletions).where(eq(recurringDutyCompletions.id, completionId))
}
