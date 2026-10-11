import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm"
import type { getDb } from "@/db"
import { staffMessageRecords, users } from "@/db/schema"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { createSystemNotificationEvent } from "@/lib/notifications/create-event"
import {
  staffMessageAging,
  staffMessageStatus,
  type StaffMessageAgingThresholds,
} from "@/lib/staff-message-desk/triage"

export const STALE_REMINDER_EVENT = "staff_message.stale"

type Db = ReturnType<typeof getDb>

/**
 * A message needs a reminder when it is stale and its assignee hasn't been
 * reminded since its last activity (so each stale stretch gets one reminder).
 */
export function staleReminderDue(
  row: {
    readonly status: string
    readonly createdAt: string
    readonly updatedAt: string
    readonly lastActivityAt: string | null
    readonly staleRemindedAt: string | null
  },
  now: Date,
  thresholds: StaffMessageAgingThresholds,
): boolean {
  const lastActivityAt = row.lastActivityAt ?? row.updatedAt
  const aging = staffMessageAging({ status: staffMessageStatus(row.status), createdAt: row.createdAt, lastActivityAt }, now, thresholds)
  if (aging.level !== "stale") return false
  return row.staleRemindedAt === null || row.staleRemindedAt < lastActivityAt
}

/** Open messages for one org with their assignee, for the stale check. */
async function openMessages(db: Db, organizationId: string) {
  return db
    .select({
      id: staffMessageRecords.id,
      subject: staffMessageRecords.subject,
      callerName: staffMessageRecords.callerName,
      status: staffMessageRecords.status,
      createdAt: staffMessageRecords.createdAt,
      updatedAt: staffMessageRecords.updatedAt,
      lastActivityAt: staffMessageRecords.lastActivityAt,
      staleRemindedAt: staffMessageRecords.staleRemindedAt,
      assigneeUserId: staffMessageRecords.assigneeUserId,
      assigneeEmail: users.email,
      assigneeActive: users.isActive,
    })
    .from(staffMessageRecords)
    .innerJoin(users, eq(users.id, staffMessageRecords.assigneeUserId))
    .where(and(eq(staffMessageRecords.organizationId, organizationId), ne(staffMessageRecords.status, "closed")))
}

/**
 * Sends each assignee one urgent reminder when a message of theirs turns
 * stale. A message gets a new reminder only if it goes stale again after
 * someone follows up (its last activity is newer than the last reminder).
 * Honors each company's thresholds and its reminder switch.
 */
export async function sendStaleMessageReminders(db: Db, now: Date = new Date()): Promise<{ readonly reminded: number }> {
  const orgs = await db
    .selectDistinct({ organizationId: staffMessageRecords.organizationId })
    .from(staffMessageRecords)
    .where(
      and(
        ne(staffMessageRecords.status, "closed"),
        or(
          isNull(staffMessageRecords.staleRemindedAt),
          sql`${staffMessageRecords.staleRemindedAt} < coalesce(${staffMessageRecords.lastActivityAt}, ${staffMessageRecords.updatedAt})`,
        ),
      ),
    )
  let reminded = 0
  const nowIso = now.toISOString()
  for (const { organizationId } of orgs) {
    const settings = await readFeatureSettings(db, organizationId, "message-desk")
    if (!settings.remindOnStale) continue
    const rows = await openMessages(db, organizationId)
    const due = rows.filter((row) => row.assigneeActive && staleReminderDue(row, now, settings))
    for (const row of due) {
      await createSystemNotificationEvent({
        organizationId,
        projectId: null,
        eventType: STALE_REMINDER_EVENT,
        sourceType: "staff_message_record",
        sourceId: row.id,
        title: `Follow up: ${row.subject}`,
        body: `${row.callerName}'s message has had no follow-up for ${settings.staleDays} business days.`,
        href: `/dashboard/office-maintenance/message-desk#message-${encodeURIComponent(row.id)}`,
        priority: "urgent",
        audience: "assignee",
        recipients: [{ userId: row.assigneeUserId, email: row.assigneeEmail }],
        delivery: { inApp: true, email: false, push: true },
      })
      reminded += 1
    }
    if (due.length > 0) {
      await db
        .update(staffMessageRecords)
        .set({ staleRemindedAt: nowIso })
        .where(inArray(staffMessageRecords.id, due.map((row) => row.id)))
    }
  }
  return { reminded }
}

/** How many open, stale messages are assigned to this user (for the sidebar). */
export async function countStaleMessagesForUser(db: Db, organizationId: string, userId: string, now: Date = new Date()): Promise<number> {
  const settings = await readFeatureSettings(db, organizationId, "message-desk")
  const rows = await db
    .select({
      status: staffMessageRecords.status,
      createdAt: staffMessageRecords.createdAt,
      updatedAt: staffMessageRecords.updatedAt,
      lastActivityAt: staffMessageRecords.lastActivityAt,
    })
    .from(staffMessageRecords)
    .where(
      and(
        eq(staffMessageRecords.organizationId, organizationId),
        eq(staffMessageRecords.assigneeUserId, userId),
        ne(staffMessageRecords.status, "closed"),
      ),
    )
  return rows.filter(
    (row) =>
      staffMessageAging(
        { status: staffMessageStatus(row.status), createdAt: row.createdAt, lastActivityAt: row.lastActivityAt ?? row.updatedAt },
        now,
        settings,
      ).level === "stale",
  ).length
}
