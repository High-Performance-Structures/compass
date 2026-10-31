import { describe, expect, it } from "vitest"

import {
  expectedShape,
  recordingD1,
  rowsOf,
  runRecorded,
  sqliteWith,
  statementShape,
} from "@/lib/domain/__tests__/recording-d1"
import {
  insertInternalNotificationEventWhereStatement,
  insertNotificationRecipientWhereStatement,
  settleNotificationRecipientsWhereStatement,
} from "@/lib/domain/notifications/store"

/*
 * The Sage Square alerts and reminders wrote these rows with raw SQL. The
 * reminder and creator events used to inline their event type, source type
 * and priority as SQL literals; they are bind values now, so those inserts
 * are checked by running old and new statements and comparing the rows.
 */
const d1 = recordingD1()
const now = "2026-10-31T08:00:00.000Z"
const SCHEMA = `
  CREATE TABLE notification_events (id TEXT PRIMARY KEY, organization_id TEXT, project_id TEXT, event_type TEXT,
    source_type TEXT, source_id TEXT, title TEXT, body TEXT, href TEXT, priority TEXT, audience TEXT, created_at TEXT);
  CREATE TABLE notification_recipients (id TEXT PRIMARY KEY, event_id TEXT, user_id TEXT, in_app INTEGER, email INTEGER,
    sms INTEGER, push INTEGER, created_at TEXT, read_at TEXT, dismissed_at TEXT);
  CREATE TABLE sage_square_payment_operations (id TEXT PRIMARY KEY, organization_id TEXT, operation_type TEXT,
    status TEXT, receipt_reminder_count INTEGER);
  INSERT INTO sage_square_payment_operations VALUES ('op1', 'org-1', 'post_square_receipt', 'manual_action_required', 0);
`
const AWAITING_ENTRY = `operation_type = 'post_square_receipt' AND status = 'manual_action_required'`
const stillOpen = `EXISTS (SELECT 1 FROM sage_square_payment_operations WHERE id = ? AND ${AWAITING_ENTRY} AND receipt_reminder_count = ?)`

function previousReminderEvent(sqlite: ReturnType<typeof sqliteWith>, eventId: string, count: number): void {
  sqlite.prepare(`INSERT INTO notification_events
        (id, organization_id, project_id, event_type, source_type, source_id, title, body, href, priority, audience, created_at)
        SELECT ?, ?, ?, 'sage.square_payment.receipt_reminder', 'sage_square_payment', ?, ?, ?, ?, 'high', 'internal', ?
        WHERE ${stillOpen} ON CONFLICT(id) DO NOTHING`)
    .run(eventId, "org-1", "p1", "op1", "t", "b", "/h", now, "op1", count)
}

function newReminderEvent(eventId: string, count: number): unknown {
  return insertInternalNotificationEventWhereStatement(d1, {
    id: eventId, organizationId: "org-1", projectId: "p1", eventType: "sage.square_payment.receipt_reminder",
    sourceType: "sage_square_payment", sourceId: "op1", title: "t", body: "b", href: "/h", priority: "high", createdAt: now,
  }, { sql: stillOpen, binds: ["op1", count] })
}

describe("guarded notification statements", () => {
  it("stores a reminder event only while the receipt is open, idempotently, as before", () => {
    const before = sqliteWith(SCHEMA)
    const after = sqliteWith(SCHEMA)
    for (const [eventId, count] of [["e1", 0], ["e1", 0], ["e2", 5]] as const) {
      previousReminderEvent(before, eventId, count)
      runRecorded(after, [newReminderEvent(eventId, count)])
    }
    expect(rowsOf(after, "notification_events")).toEqual(rowsOf(before, "notification_events"))
    expect(rowsOf(after, "notification_events")).toHaveLength(1)
  })

  it("stores a creator alert event exactly as the literal statement did", () => {
    const before = sqliteWith(SCHEMA)
    const after = sqliteWith(SCHEMA)
    const deliverable = "SELECT 1 FROM sage_square_payment_operations WHERE id = ? AND organization_id = ?"
    before.prepare(`INSERT INTO notification_events
    (id, organization_id, project_id, event_type, source_type, source_id, title, body, href, priority, audience, created_at)
    SELECT ?, ?, ?, ?, 'sage_square_payment', ?, ?, ?, ?, ?, 'internal', ?
    WHERE EXISTS (${deliverable}) ON CONFLICT(id) DO NOTHING`)
      .run("e1", "org-1", "p1", "sage.square_payment.received", "op1", "t", "b", "/h", "normal", now, "op1", "org-1")
    runRecorded(after, [insertInternalNotificationEventWhereStatement(d1, {
      id: "e1", organizationId: "org-1", projectId: "p1", eventType: "sage.square_payment.received",
      sourceType: "sage_square_payment", sourceId: "op1", title: "t", body: "b", href: "/h", priority: "normal", createdAt: now,
    }, { sql: `EXISTS (${deliverable})`, binds: ["op1", "org-1"] })])
    expect(rowsOf(after, "notification_events")).toEqual(rowsOf(before, "notification_events"))
  })

  it("inserts recipients with the same SQL and binds as before", () => {
    const guard = { sql: "EXISTS (SELECT 1 FROM notification_events WHERE id = ?)", binds: ["e1"] }
    expect(statementShape(insertNotificationRecipientWhereStatement(d1, { id: "e1:u1", eventId: "e1", userId: "u1", createdAt: now }, guard)))
      .toEqual(expectedShape(
        `INSERT INTO notification_recipients (id, event_id, user_id, in_app, email, sms, push, created_at)
        SELECT ?, ?, ?, 1, 0, 0, 0, ? WHERE EXISTS (SELECT 1 FROM notification_events WHERE id = ?) ON CONFLICT(id) DO NOTHING`,
        ["e1:u1", "e1", "u1", now, "e1"],
      ))
  })

  it("settles recipients with the same SQL and binds as before", () => {
    const where = { sql: "event_id IN (SELECT id FROM notification_events WHERE event_type = ? AND source_type = ? AND source_id = ?)", binds: ["t", "s", "x"] }
    expect(statementShape(settleNotificationRecipientsWhereStatement(d1, { markRead: true, now, where }))).toEqual(expectedShape(
      `UPDATE notification_recipients
     SET read_at = COALESCE(read_at, ?),
         dismissed_at = COALESCE(dismissed_at, ?)
     WHERE event_id IN (SELECT id FROM notification_events WHERE event_type = ? AND source_type = ? AND source_id = ?)`,
      [now, now, "t", "s", "x"],
    ))
    expect(statementShape(settleNotificationRecipientsWhereStatement(d1, { markRead: false, now, where }))).toEqual(expectedShape(
      `UPDATE notification_recipients SET dismissed_at = COALESCE(dismissed_at, ?)
        WHERE event_id IN (SELECT id FROM notification_events WHERE event_type = ? AND source_type = ? AND source_id = ?)`,
      [now, "t", "s", "x"],
    ))
  })
})
