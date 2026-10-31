/**
 * The work calendar's writes: Compass calendar events, their attendees, and
 * the organization calendar settings (architecture standard, section 1).
 * Google sync (src/lib/google/calendar/sync.ts) still updates synced event
 * fields itself. No auth logic here; callers resolve access first.
 */
import { and, eq, inArray, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import { organizationCalendarSettings, workCalendarEventAttendees, workCalendarEvents } from "@/db/schema"
import { chunkD1Rows, chunkD1Values } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

import type { WorkCalendarEventAttendee } from "./types"

type NewWorkCalendarEvent = typeof workCalendarEvents.$inferInsert

/** Remembers the inferred H-Office project as the organization's default. */
export async function saveDefaultCalendarProject(
  db: Db,
  input: { readonly organizationId: string; readonly projectId: string; readonly now: string },
): Promise<void> {
  await db
    .insert(organizationCalendarSettings)
    .values({
      organizationId: input.organizationId,
      defaultProjectId: input.projectId,
      timeZone: "America/Denver",
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: organizationCalendarSettings.organizationId,
      set: { defaultProjectId: input.projectId, updatedAt: input.now },
    })
}

export async function insertWorkCalendarEvent(db: Db, values: NewWorkCalendarEvent): Promise<void> {
  await db.insert(workCalendarEvents).values(values)
}

type OpenEventVersion = {
  readonly eventId: string
  readonly organizationId: string
  readonly expectedVersion: number
}

function openEventAtVersion(input: OpenEventVersion): SQL | undefined {
  return and(
    eq(workCalendarEvents.id, input.eventId),
    eq(workCalendarEvents.organizationId, input.organizationId),
    eq(workCalendarEvents.status, "open"),
    eq(workCalendarEvents.version, input.expectedVersion),
  )
}

/** Rewrites an open event still at the expected version; false when it moved on. */
export async function updateOpenWorkCalendarEvent(
  db: Db,
  input: OpenEventVersion,
  values: Partial<NewWorkCalendarEvent>,
): Promise<boolean> {
  const rows = await db
    .update(workCalendarEvents)
    .set(values)
    .where(openEventAtVersion(input))
    .returning({ id: workCalendarEvents.id })
  return rows.length > 0
}

/** Cancels an open event still at the expected version; false when it moved on. */
export async function cancelOpenWorkCalendarEvent(
  db: Db,
  input: OpenEventVersion & { readonly userId: string; readonly now: string },
): Promise<boolean> {
  const rows = await db
    .update(workCalendarEvents)
    .set({
      status: "cancelled",
      version: input.expectedVersion + 1,
      updatedBy: input.userId,
      cancelledBy: input.userId,
      cancelledAt: input.now,
      updatedAt: input.now,
    })
    .where(openEventAtVersion(input))
    .returning({ id: workCalendarEvents.id })
  return rows.length > 0
}

/**
 * Adds new attendees and removes dropped ones in one batch. Retained
 * attendees keep their response state; adds run before removals.
 */
export async function syncEventAttendees(
  db: Db,
  input: {
    readonly eventId: string
    readonly previous: readonly WorkCalendarEventAttendee[]
    readonly next: readonly WorkCalendarEventAttendee[]
    readonly now: string
  },
): Promise<void> {
  const previousIds = new Set(input.previous.map((attendee) => attendee.userId))
  const nextIds = new Set(input.next.map((attendee) => attendee.userId))
  const added = input.next
    .filter((attendee) => !previousIds.has(attendee.userId))
    .map((attendee) => ({
      id: crypto.randomUUID(),
      eventId: input.eventId,
      userId: attendee.userId,
      responseStatus: "needs_action",
      createdAt: input.now,
      updatedAt: input.now,
    }))
  const removedIds = input.previous.map((attendee) => attendee.userId).filter((userId) => !nextIds.has(userId))

  const statements: BatchItem<"sqlite">[] = [
    ...chunkD1Rows(added).map((rows) => db.insert(workCalendarEventAttendees).values(rows).onConflictDoNothing()),
    ...chunkD1Values(removedIds).map((userIds) =>
      db
        .delete(workCalendarEventAttendees)
        .where(
          and(eq(workCalendarEventAttendees.eventId, input.eventId), inArray(workCalendarEventAttendees.userId, userIds)),
        ),
    ),
  ]
  const [first, ...rest] = statements
  if (first) await db.batch([first, ...rest])
}
