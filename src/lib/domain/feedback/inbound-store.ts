/**
 * The only code that inserts, updates, or deletes the staff Message Desk and
 * GoTo inbound tables: staff_message_records, staff_message_events,
 * goto_inbound_events and goto_inbound_settings (architecture standard,
 * section 1). Callers pass the WHERE fences (organization, status, claim)
 * unchanged; builders are returned unexecuted so chains and batches stay as
 * they were. No auth here.
 */
import type { SQL } from "drizzle-orm"
import type { SQLiteInsertValue, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import {
  gotoInboundEvents,
  gotoInboundSettings,
  staffMessageEvents,
  staffMessageRecords,
} from "@/db/schema"
import { STAFF_MESSAGE_STATUSES } from "@/lib/domain/feedback/statuses"
import type { Db } from "@/lib/server/action-context"
import { assertListFields } from "@/lib/shared/statuses"

// ---------------------------------------------------------------------------
// staffMessageRecords: Message Desk records
// ---------------------------------------------------------------------------

function staffMessageRecordsInsert(db: Db, values: SQLiteInsertValue<typeof staffMessageRecords>) {
  assertListFields("staff_message_records", values, { status: STAFF_MESSAGE_STATUSES })
  return db.insert(staffMessageRecords).values(values)
}
function staffMessageRecordsUpdate(db: Db, changes: SQLiteUpdateSetSource<typeof staffMessageRecords>, where: SQL | undefined) {
  assertListFields("staff_message_records", changes, { status: STAFF_MESSAGE_STATUSES })
  return db.update(staffMessageRecords).set(changes).where(where)
}

/** Unexecuted insert: chain `.onConflict…()` / `.returning()`, then await or batch it. */
export function insertStaffMessageRecords(db: Db, values: SQLiteInsertValue<typeof staffMessageRecords>): ReturnType<typeof staffMessageRecordsInsert> {
  return staffMessageRecordsInsert(db, values)
}

/** Unexecuted update fenced by the caller's `where` (claim token, version, status). */
export function updateStaffMessageRecords(db: Db, changes: SQLiteUpdateSetSource<typeof staffMessageRecords>, where: SQL | undefined): ReturnType<typeof staffMessageRecordsUpdate> {
  return staffMessageRecordsUpdate(db, changes, where)
}

// ---------------------------------------------------------------------------
// staffMessageEvents: Message Desk history events
// ---------------------------------------------------------------------------

function staffMessageEventsInsert(db: Db, values: SQLiteInsertValue<typeof staffMessageEvents>) {
  assertListFields("staff_message_events", values, { fromStatus: STAFF_MESSAGE_STATUSES, toStatus: STAFF_MESSAGE_STATUSES })
  return db.insert(staffMessageEvents).values(values)
}

/** Unexecuted insert: chain `.onConflict…()` / `.returning()`, then await or batch it. */
export function insertStaffMessageEvents(db: Db, values: SQLiteInsertValue<typeof staffMessageEvents>): ReturnType<typeof staffMessageEventsInsert> {
  return staffMessageEventsInsert(db, values)
}

// ---------------------------------------------------------------------------
// gotoInboundEvents: GoTo inbound text events
// ---------------------------------------------------------------------------

function gotoInboundEventsInsert(db: Db, values: SQLiteInsertValue<typeof gotoInboundEvents>) {
  return db.insert(gotoInboundEvents).values(values)
}
function gotoInboundEventsUpdate(db: Db, changes: SQLiteUpdateSetSource<typeof gotoInboundEvents>, where: SQL | undefined) {
  return db.update(gotoInboundEvents).set(changes).where(where)
}

/** Unexecuted insert: chain `.onConflict…()` / `.returning()`, then await or batch it. */
export function insertGotoInboundEvents(db: Db, values: SQLiteInsertValue<typeof gotoInboundEvents>): ReturnType<typeof gotoInboundEventsInsert> {
  return gotoInboundEventsInsert(db, values)
}

/** Unexecuted update fenced by the caller's `where` (claim token, version, status). */
export function updateGotoInboundEvents(db: Db, changes: SQLiteUpdateSetSource<typeof gotoInboundEvents>, where: SQL | undefined): ReturnType<typeof gotoInboundEventsUpdate> {
  return gotoInboundEventsUpdate(db, changes, where)
}

// ---------------------------------------------------------------------------
// gotoInboundSettings: GoTo inbound webhook settings
// ---------------------------------------------------------------------------

function gotoInboundSettingsInsert(db: Db, values: SQLiteInsertValue<typeof gotoInboundSettings>) {
  return db.insert(gotoInboundSettings).values(values)
}

/** Unexecuted insert: chain `.onConflict…()` / `.returning()`, then await or batch it. */
export function insertGotoInboundSettings(db: Db, values: SQLiteInsertValue<typeof gotoInboundSettings>): ReturnType<typeof gotoInboundSettingsInsert> {
  return gotoInboundSettingsInsert(db, values)
}

