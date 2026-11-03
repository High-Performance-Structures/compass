/**
 * The only code that inserts, updates, or deletes the Feedback Desk and
 * Jarvis bridge tables: feedback_desk_items, jarvis_bridge_events,
 * feedback_service_health and feedback_maintenance_runs (architecture
 * standard, section 1).
 *
 * The bridge's correctness rests on fenced writes: claim tokens, expected
 * versions and status checks in the WHERE clause. Those fences are built by
 * the bridge and desk code that owns the lifecycle and passed in unchanged;
 * this module owns the write itself. Builders are returned unexecuted so a
 * caller can add `.returning()` / `.onConflict…()` or put several writes in
 * one D1 batch exactly as before. No auth here.
 */
import type { SQL } from "drizzle-orm"
import type { SQLiteInsertValue, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import {
  feedbackDeskItems,
  feedbackMaintenanceRuns,
  feedbackServiceHealth,
  jarvisBridgeEvents,
} from "@/db/schema-jarvis"
import { FEEDBACK_DESK_STATUSES } from "@/lib/domain/feedback/statuses"
import type { Db } from "@/lib/server/action-context"
import { assertListFields } from "@/lib/shared/statuses"

// ---------------------------------------------------------------------------
// feedbackDeskItems: Feedback Desk items
// ---------------------------------------------------------------------------

function feedbackDeskItemsInsert(db: Db, values: SQLiteInsertValue<typeof feedbackDeskItems>) {
  assertListFields("feedback_desk_items", values, { status: FEEDBACK_DESK_STATUSES })
  return db.insert(feedbackDeskItems).values(values)
}
function feedbackDeskItemsUpdate(db: Db, changes: SQLiteUpdateSetSource<typeof feedbackDeskItems>, where: SQL | undefined) {
  assertListFields("feedback_desk_items", changes, { status: FEEDBACK_DESK_STATUSES })
  return db.update(feedbackDeskItems).set(changes).where(where)
}

/** Unexecuted insert: chain `.onConflict…()` / `.returning()`, then await or batch it. */
export function insertFeedbackDeskItems(db: Db, values: SQLiteInsertValue<typeof feedbackDeskItems>): ReturnType<typeof feedbackDeskItemsInsert> {
  return feedbackDeskItemsInsert(db, values)
}

/** Unexecuted update fenced by the caller's `where` (claim token, version, status). */
export function updateFeedbackDeskItems(db: Db, changes: SQLiteUpdateSetSource<typeof feedbackDeskItems>, where: SQL | undefined): ReturnType<typeof feedbackDeskItemsUpdate> {
  return feedbackDeskItemsUpdate(db, changes, where)
}

/** `INSERT … SELECT` for an outbox event that must exist only if a fenced row does. */
export function insertJarvisBridgeEventsFrom(db: Db, select: SQL): ReturnType<typeof jarvisBridgeEventsInsertSelect> {
  return jarvisBridgeEventsInsertSelect(db, select)
}
function jarvisBridgeEventsInsertSelect(db: Db, select: SQL) {
  return db.insert(jarvisBridgeEvents).select(select)
}

// ---------------------------------------------------------------------------
// jarvisBridgeEvents: Jarvis bridge outbox events
// ---------------------------------------------------------------------------

function jarvisBridgeEventsInsert(db: Db, values: SQLiteInsertValue<typeof jarvisBridgeEvents>) {
  return db.insert(jarvisBridgeEvents).values(values)
}
function jarvisBridgeEventsUpdate(db: Db, changes: SQLiteUpdateSetSource<typeof jarvisBridgeEvents>, where: SQL | undefined) {
  return db.update(jarvisBridgeEvents).set(changes).where(where)
}

/** Unexecuted insert: chain `.onConflict…()` / `.returning()`, then await or batch it. */
export function insertJarvisBridgeEvents(db: Db, values: SQLiteInsertValue<typeof jarvisBridgeEvents>): ReturnType<typeof jarvisBridgeEventsInsert> {
  return jarvisBridgeEventsInsert(db, values)
}

/** Unexecuted update fenced by the caller's `where` (claim token, version, status). */
export function updateJarvisBridgeEvents(db: Db, changes: SQLiteUpdateSetSource<typeof jarvisBridgeEvents>, where: SQL | undefined): ReturnType<typeof jarvisBridgeEventsUpdate> {
  return jarvisBridgeEventsUpdate(db, changes, where)
}

// ---------------------------------------------------------------------------
// feedbackServiceHealth: service health heartbeats
// ---------------------------------------------------------------------------

function feedbackServiceHealthInsert(db: Db, values: SQLiteInsertValue<typeof feedbackServiceHealth>) {
  return db.insert(feedbackServiceHealth).values(values)
}

/** Unexecuted insert: chain `.onConflict…()` / `.returning()`, then await or batch it. */
export function insertFeedbackServiceHealth(db: Db, values: SQLiteInsertValue<typeof feedbackServiceHealth>): ReturnType<typeof feedbackServiceHealthInsert> {
  return feedbackServiceHealthInsert(db, values)
}

// ---------------------------------------------------------------------------
// feedbackMaintenanceRuns: maintenance run records
// ---------------------------------------------------------------------------

function feedbackMaintenanceRunsInsert(db: Db, values: SQLiteInsertValue<typeof feedbackMaintenanceRuns>) {
  return db.insert(feedbackMaintenanceRuns).values(values)
}
function feedbackMaintenanceRunsUpdate(db: Db, changes: SQLiteUpdateSetSource<typeof feedbackMaintenanceRuns>, where: SQL | undefined) {
  return db.update(feedbackMaintenanceRuns).set(changes).where(where)
}

/** Unexecuted insert: chain `.onConflict…()` / `.returning()`, then await or batch it. */
export function insertFeedbackMaintenanceRuns(db: Db, values: SQLiteInsertValue<typeof feedbackMaintenanceRuns>): ReturnType<typeof feedbackMaintenanceRunsInsert> {
  return feedbackMaintenanceRunsInsert(db, values)
}

/** Unexecuted update fenced by the caller's `where` (claim token, version, status). */
export function updateFeedbackMaintenanceRuns(db: Db, changes: SQLiteUpdateSetSource<typeof feedbackMaintenanceRuns>, where: SQL | undefined): ReturnType<typeof feedbackMaintenanceRunsUpdate> {
  return feedbackMaintenanceRunsUpdate(db, changes, where)
}

