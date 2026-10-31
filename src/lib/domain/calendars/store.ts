/**
 * The only code that writes the calendar tables (architecture standard,
 * section 1): Google Calendar connections and selections, the Compass-made
 * project and personal calendars, and work calendar events. No auth logic
 * here; callers resolve access first.
 *
 * Project calendars are still stored three ways (projects.google_calendar_id,
 * compass_project_calendars and google_project_calendars). This module owns
 * the compass_project_calendars writes only; unifying them is separate work.
 */
import { eq, inArray } from "drizzle-orm"

import {
  compassProjectCalendars,
  googleCalendarConnections,
  googleCalendarSelections,
  myCompassCalendars,
} from "@/db/schema"
import { chunkD1Rows, chunkD1Values } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

type NewGoogleCalendarConnection = typeof googleCalendarConnections.$inferInsert
type GoogleCalendarSelectionValues = Partial<typeof googleCalendarSelections.$inferInsert>
type CompassProjectCalendarValues = Partial<typeof compassProjectCalendars.$inferInsert>
type MyCompassCalendarValues = Partial<typeof myCompassCalendars.$inferInsert>

// ---------------------------------------------------------------------------
// Google Calendar connections
// ---------------------------------------------------------------------------

/**
 * Saves a person's Google Calendar grant. One connection per person per
 * organization; reconnecting refreshes the account, token and scopes.
 */
export async function upsertGoogleCalendarConnection(
  db: Db,
  values: NewGoogleCalendarConnection
): Promise<void> {
  await db
    .insert(googleCalendarConnections)
    .values(values)
    .onConflictDoUpdate({
      target: [googleCalendarConnections.organizationId, googleCalendarConnections.userId],
      set: {
        googleAccountId: values.googleAccountId,
        googleAccountEmail: values.googleAccountEmail,
        refreshTokenEncrypted: values.refreshTokenEncrypted,
        grantedScopes: values.grantedScopes,
        status: values.status,
        connectedAt: values.connectedAt,
        lastError: null,
        updatedAt: values.updatedAt,
      },
    })
    .run()
}

export async function updateGoogleCalendarConnection(
  db: Db,
  connectionId: string,
  values: Partial<NewGoogleCalendarConnection>
): Promise<void> {
  await db
    .update(googleCalendarConnections)
    .set(values)
    .where(eq(googleCalendarConnections.id, connectionId))
}

export async function deleteGoogleCalendarConnection(db: Db, connectionId: string): Promise<void> {
  await db.delete(googleCalendarConnections).where(eq(googleCalendarConnections.id, connectionId)).run()
}

// ---------------------------------------------------------------------------
// Google Calendar selections
// ---------------------------------------------------------------------------

type GoogleCalendarListEntry = {
  readonly id: string
  readonly summary: string
  readonly description: string | null
  readonly timeZone: string | null
  readonly backgroundColor: string | null
  readonly accessRole: string
  readonly primary: boolean
}

/**
 * Records the calendars a connected account can see. New calendars start
 * unselected; known ones only refresh their Google details, so a person's
 * import and export choices are kept. One batch for the whole list.
 */
export async function upsertGoogleCalendarSelections(
  db: Db,
  input: {
    readonly connectionId: string
    readonly calendars: readonly GoogleCalendarListEntry[]
    readonly now: string
  }
): Promise<void> {
  const { connectionId, now } = input
  const statements = input.calendars.map((calendar) =>
    db
      .insert(googleCalendarSelections)
      .values({
        id: crypto.randomUUID(),
        connectionId,
        googleCalendarId: calendar.id,
        summary: calendar.summary,
        description: calendar.description,
        timeZone: calendar.timeZone,
        backgroundColor: calendar.backgroundColor,
        accessRole: calendar.accessRole,
        isPrimary: calendar.primary,
        selected: false,
        importEvents: false,
        exportCompassEvents: false,
        isCompassDestination: false,
        calendarScope: "personal",
        internalVisibility: "busy",
        internalCanCreate: false,
        internalCanEdit: false,
        internalCanDelete: false,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [googleCalendarSelections.connectionId, googleCalendarSelections.googleCalendarId],
        set: {
          summary: calendar.summary,
          description: calendar.description,
          timeZone: calendar.timeZone,
          backgroundColor: calendar.backgroundColor,
          accessRole: calendar.accessRole,
          isPrimary: calendar.primary,
          updatedAt: now,
        },
      })
  )
  const [first, ...rest] = statements
  if (!first) return
  await db.batch([first, ...rest])
}

export async function updateGoogleCalendarSelection(
  db: Db,
  selectionId: string,
  values: GoogleCalendarSelectionValues
): Promise<void> {
  await db
    .update(googleCalendarSelections)
    .set(values)
    .where(eq(googleCalendarSelections.id, selectionId))
}

// ---------------------------------------------------------------------------
// Compass project calendars (compass_project_calendars)
// ---------------------------------------------------------------------------

/** Staff's on/off choice for a job's calendar; null returns to the company setting. */
export async function upsertProjectCalendarChoice(
  db: Db,
  input: {
    readonly projectId: string
    readonly organizationId: string
    readonly enabled: boolean | null
    readonly userId: string
    readonly now: string
  }
): Promise<void> {
  const { projectId, organizationId, enabled, userId, now } = input
  await db
    .insert(compassProjectCalendars)
    .values({ projectId, organizationId, enabled, updatedBy: userId, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: compassProjectCalendars.projectId,
      set: { enabled, updatedBy: userId, lastError: null, updatedAt: now },
    })
}

/** Adds a pending row for each job that should have a calendar but has none yet. */
export async function insertMissingProjectCalendars(
  db: Db,
  input: {
    readonly organizationId: string
    readonly projectIds: readonly string[]
    readonly now: string
  }
): Promise<void> {
  const rows = input.projectIds.map((projectId) => ({
    projectId,
    organizationId: input.organizationId,
    createdAt: input.now,
    updatedAt: input.now,
  }))
  for (const chunk of chunkD1Rows(rows)) {
    await db.insert(compassProjectCalendars).values(chunk).onConflictDoNothing()
  }
}

export async function updateProjectCalendar(
  db: Db,
  projectId: string,
  values: CompassProjectCalendarValues
): Promise<void> {
  await db
    .update(compassProjectCalendars)
    .set(values)
    .where(eq(compassProjectCalendars.projectId, projectId))
}

/** The same values on several jobs' calendar rows (an organization-wide failure). */
export async function updateProjectCalendars(
  db: Db,
  projectIds: readonly string[],
  values: CompassProjectCalendarValues
): Promise<void> {
  for (const chunk of chunkD1Values(projectIds)) {
    await db
      .update(compassProjectCalendars)
      .set(values)
      .where(inArray(compassProjectCalendars.projectId, chunk))
  }
}

// ---------------------------------------------------------------------------
// My Compass calendars (one per person)
// ---------------------------------------------------------------------------

/** Adds a pending row for each person, leaving existing rows alone. */
export async function insertMissingMyCompassCalendars(
  db: Db,
  input: {
    readonly organizationId: string
    readonly userIds: readonly string[]
    readonly now: string
  }
): Promise<void> {
  const rows = input.userIds.map((userId) => ({
    userId,
    organizationId: input.organizationId,
    createdAt: input.now,
    updatedAt: input.now,
  }))
  for (const chunk of chunkD1Rows(rows)) {
    await db.insert(myCompassCalendars).values(chunk).onConflictDoNothing()
  }
}

export async function updateMyCompassCalendar(
  db: Db,
  userId: string,
  values: MyCompassCalendarValues
): Promise<void> {
  await db.update(myCompassCalendars).set(values).where(eq(myCompassCalendars.userId, userId))
}
