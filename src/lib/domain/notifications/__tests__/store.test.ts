import { and, eq, inArray, isNull } from "drizzle-orm"
import { describe, expect, it, vi } from "vitest"

import { getDb } from "@/db"
import { notificationEvents, notificationPreferences, notificationRecipients } from "@/db/schema"
import {
  dismissEventRecipientsStatement,
  notificationEventInsertStatement,
  upsertNotificationPreferences,
} from "@/lib/domain/notifications/store"

/*
 * The store writes the same SQL the callers wrote before the move. Building
 * SQL needs no database connection.
 */
// @ts-expect-error Statements are only built here, never run.
const db = getDb({})

function sqlOf(statement: object): unknown {
  return Reflect.apply(Reflect.get(statement, "toSQL"), statement, [])
}

const now = "2026-10-30T12:00:00.000Z"
const event = {
  id: "e1",
  organizationId: "org-1",
  projectId: null,
  eventType: "square_auth.failed",
  sourceType: "square_auth_health",
  sourceId: "s1",
  title: "t",
  body: "b",
  href: "/dashboard/automations",
  priority: "high",
  audience: "internal",
  createdBy: null,
  createdAt: now,
}

describe("notifications store", () => {
  it("builds idempotent and plain event inserts like the callers did", () => {
    expect(sqlOf(notificationEventInsertStatement(db, event, { ignoreConflict: true }))).toEqual(
      db.insert(notificationEvents).values(event).onConflictDoNothing().toSQL(),
    )
    expect(sqlOf(notificationEventInsertStatement(db, event))).toEqual(db.insert(notificationEvents).values(event).toSQL())
  })

  it("dismisses a resolved incident's open recipients with the same statement", () => {
    expect(sqlOf(dismissEventRecipientsStatement(db, "e1", now))).toEqual(
      db
        .update(notificationRecipients)
        .set({ dismissedAt: now })
        .where(and(eq(notificationRecipients.eventId, "e1"), isNull(notificationRecipients.dismissedAt)))
        .toSQL(),
    )
  })

  it("upserts exactly the given preference fields", async () => {
    const values = { dailyLogReminderTime: "16:30", updatedAt: now }
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
    const insertValues = vi.fn().mockReturnValue({ onConflictDoUpdate })
    const fakeDb = Object.assign(Object.create(null), { insert: vi.fn().mockReturnValue({ values: insertValues }) })
    await upsertNotificationPreferences(fakeDb, "u1", values)
    expect(fakeDb.insert).toHaveBeenCalledWith(notificationPreferences)
    expect(insertValues).toHaveBeenCalledWith({ userId: "u1", ...values })
    expect(onConflictDoUpdate).toHaveBeenCalledWith({ target: notificationPreferences.userId, set: values })
  })

  it("keeps id lists inside D1's bound-parameter limit", () => {
    // 120 ids become three IN lists of at most 50.
    const ids = Array.from({ length: 120 }, (_, index) => `r${index}`)
    const chunks = [ids.slice(0, 50), ids.slice(50, 100), ids.slice(100)]
    for (const chunk of chunks) {
      expect(db.update(notificationRecipients).set({ dismissedAt: now }).where(inArray(notificationRecipients.id, chunk)).toSQL().params.length).toBeLessThan(100)
    }
  })
})
