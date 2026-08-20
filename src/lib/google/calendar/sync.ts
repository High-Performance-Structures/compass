import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import {
  googleCalendarConnections,
  googleCalendarEntityLinks,
  googleCalendarEvents,
  googleCalendarSelections,
  users,
  workCalendarEventAttendees,
  workCalendarEvents,
} from "@/db/schema"
import { decrypt } from "@/lib/crypto"
import {
  getGoogleCalendarOAuthConfig,
  googleCalendarTokenSalt,
} from "@/lib/google/calendar/config"
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  listGoogleCalendarEvents,
  updateGoogleCalendarEvent,
  type GoogleCalendarEventWrite,
  type GoogleCalendarEventItem,
} from "@/lib/google/calendar/client"
import { refreshGoogleAccessToken } from "@/lib/google/calendar/oauth"
import { googleEventIdForCompass } from "@/lib/google/calendar/sync-policy"

type Database = ReturnType<typeof getDb>

export type GoogleCalendarSyncResult = {
  readonly imported: number
  readonly updated: number
  readonly conflicts: number
}

type SelectionWithConnection = {
  readonly selectionId: string
  readonly connectionId: string
  readonly calendarId: string
  readonly calendarScope: string
  readonly internalVisibility: string
  readonly connectionUserId: string
  readonly refreshTokenEncrypted: string
}

function syncWindow(): { readonly timeMin: string; readonly timeMax: string } {
  const now = new Date()
  const timeMin = new Date(now)
  timeMin.setUTCDate(timeMin.getUTCDate() - 90)
  const timeMax = new Date(now)
  timeMax.setUTCFullYear(timeMax.getUTCFullYear() + 2)
  return {
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
  }
}

async function accessTokenForConnection(
  env: object,
  connection: Pick<
    SelectionWithConnection,
    "connectionUserId" | "refreshTokenEncrypted"
  >,
): Promise<string> {
  const configuration = getGoogleCalendarOAuthConfig(env)
  if (!configuration.configured) {
    throw new Error("Google Calendar OAuth is not configured.")
  }
  const refreshToken = await decrypt(
    connection.refreshTokenEncrypted,
    configuration.config.tokenEncryptionKey,
    googleCalendarTokenSalt(connection.connectionUserId),
  )
  const token = await refreshGoogleAccessToken(
    configuration.config,
    refreshToken,
  )
  return token.accessToken
}

async function selectionWithConnection(
  db: Database,
  selectionId: string,
): Promise<SelectionWithConnection | null> {
  return db
    .select({
      selectionId: googleCalendarSelections.id,
      connectionId: googleCalendarSelections.connectionId,
      calendarId: googleCalendarSelections.googleCalendarId,
      calendarScope: googleCalendarSelections.calendarScope,
      internalVisibility: googleCalendarSelections.internalVisibility,
      connectionUserId: googleCalendarConnections.userId,
      refreshTokenEncrypted:
        googleCalendarConnections.refreshTokenEncrypted,
    })
    .from(googleCalendarSelections)
    .innerJoin(
      googleCalendarConnections,
      eq(
        googleCalendarConnections.id,
        googleCalendarSelections.connectionId,
      ),
    )
    .where(eq(googleCalendarSelections.id, selectionId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

function localVisibility(
  selection: SelectionWithConnection,
  event: GoogleCalendarEventItem,
): "organization" | "busy" | "private" {
  if (event.visibility === "private") return "private"
  return selection.internalVisibility === "details" ? "organization" : "busy"
}

async function cachePersonalEvent(
  db: Database,
  selection: SelectionWithConnection,
  event: GoogleCalendarEventItem,
  now: string,
): Promise<"imported" | "updated"> {
  const existing = await db
    .select({ id: googleCalendarEvents.id })
    .from(googleCalendarEvents)
    .where(
      and(
        eq(googleCalendarEvents.selectionId, selection.selectionId),
        eq(googleCalendarEvents.googleEventId, event.id),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  const values = {
    googleICalUid: event.iCalUID,
    recurringEventId: event.recurringEventId,
    status: event.status,
    title: event.summary,
    description: event.description,
    location: event.location,
    htmlLink: event.htmlLink,
    meetingUrl: event.meetingUrl,
    startDate: event.startDate,
    endDateExclusive: event.endDateExclusive,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: event.allDay,
    timeZone: event.timeZone,
    visibility: event.visibility,
    transparency: event.transparency,
    organizerEmail: event.organizerEmail,
    googleEtag: event.etag,
    googleUpdatedAt: event.updatedAt,
    updatedAt: now,
  }

  if (existing) {
    await db
      .update(googleCalendarEvents)
      .set(values)
      .where(eq(googleCalendarEvents.id, existing.id))
    return "updated"
  }

  await db.insert(googleCalendarEvents).values({
    id: crypto.randomUUID(),
    selectionId: selection.selectionId,
    googleEventId: event.id,
    ...values,
    createdAt: now,
  })
  return "imported"
}

async function syncOrganizationEvent(
  db: Database,
  selection: SelectionWithConnection,
  event: GoogleCalendarEventItem,
  now: string,
): Promise<"imported" | "updated" | "conflict"> {
  const link = await db
    .select({
      id: googleCalendarEntityLinks.id,
      sourceId: googleCalendarEntityLinks.sourceId,
      googleEtag: googleCalendarEntityLinks.googleEtag,
      compassVersion: googleCalendarEntityLinks.compassVersion,
    })
    .from(googleCalendarEntityLinks)
    .where(
      and(
        eq(googleCalendarEntityLinks.connectionId, selection.connectionId),
        eq(googleCalendarEntityLinks.googleCalendarId, selection.calendarId),
        eq(googleCalendarEntityLinks.googleEventId, event.id),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (link) {
    const local = await db
      .select({
        id: workCalendarEvents.id,
        version: workCalendarEvents.version,
      })
      .from(workCalendarEvents)
      .where(eq(workCalendarEvents.id, link.sourceId))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!local) {
      await db
        .delete(googleCalendarEntityLinks)
        .where(eq(googleCalendarEntityLinks.id, link.id))
      return syncOrganizationEvent(db, selection, event, now)
    }
    if (link.googleEtag === event.etag) return "updated"
    if (
      link.compassVersion !== null &&
      local.version !== link.compassVersion
    ) {
      await db
        .update(googleCalendarEntityLinks)
        .set({
          syncStatus: "conflict",
          lastError: "This event changed in both Compass and Google Calendar.",
          updatedAt: now,
        })
        .where(eq(googleCalendarEntityLinks.id, link.id))
      return "conflict"
    }

    const nextVersion = local.version + 1
    await db
      .update(workCalendarEvents)
      .set({
        title: event.summary,
        eventType: event.meetingUrl ? "meeting" : "other",
        visibility: localVisibility(selection, event),
        description: event.description,
        startDate: event.startDate,
        endDateExclusive: event.endDateExclusive,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: event.allDay,
        timeZone: event.timeZone ?? "UTC",
        location: event.location,
        meetingUrl: event.meetingUrl,
        recurrence: "none",
        recurrenceUntil: null,
        status: event.status === "cancelled" ? "cancelled" : "open",
        version: nextVersion,
        updatedBy: selection.connectionUserId,
        cancelledBy:
          event.status === "cancelled" ? selection.connectionUserId : null,
        cancelledAt: event.status === "cancelled" ? now : null,
        updatedAt: now,
      })
      .where(eq(workCalendarEvents.id, local.id))
    await db
      .update(googleCalendarEntityLinks)
      .set({
        googleICalUid: event.iCalUID,
        syncStatus: "synced",
        googleEtag: event.etag,
        googleUpdatedAt: event.updatedAt,
        compassVersion: nextVersion,
        lastSyncedAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(googleCalendarEntityLinks.id, link.id))
    return "updated"
  }

  if (event.status === "cancelled") return "updated"
  const localId = crypto.randomUUID()
  await db.insert(workCalendarEvents).values({
    id: localId,
    organizationId: await organizationIdForConnection(
      db,
      selection.connectionId,
    ),
    projectId: null,
    title: event.summary,
    eventType: event.meetingUrl ? "meeting" : "other",
    visibility: localVisibility(selection, event),
    description: event.description,
    startDate: event.startDate,
    endDateExclusive: event.endDateExclusive,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: event.allDay,
    timeZone: event.timeZone ?? "UTC",
    location: event.location,
    meetingUrl: event.meetingUrl,
    recurrence: "none",
    recurrenceUntil: null,
    status: "open",
    version: 1,
    createdBy: selection.connectionUserId,
    updatedBy: selection.connectionUserId,
    cancelledBy: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(googleCalendarEntityLinks).values({
    id: crypto.randomUUID(),
    connectionId: selection.connectionId,
    googleCalendarId: selection.calendarId,
    googleEventId: event.id,
    googleICalUid: event.iCalUID,
    sourceType: "work_calendar_event",
    sourceId: localId,
    syncDirection: "two_way",
    syncStatus: "synced",
    googleEtag: event.etag,
    googleUpdatedAt: event.updatedAt,
    compassVersion: 1,
    lastSyncedAt: now,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  })
  return "imported"
}

async function organizationIdForConnection(
  db: Database,
  connectionId: string,
): Promise<string> {
  const row = await db
    .select({ organizationId: googleCalendarConnections.organizationId })
    .from(googleCalendarConnections)
    .where(eq(googleCalendarConnections.id, connectionId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!row) throw new Error("Google Calendar connection was not found.")
  return row.organizationId
}

export async function syncGoogleCalendarSelection(
  db: Database,
  env: object,
  selectionId: string,
): Promise<GoogleCalendarSyncResult> {
  const selection = await selectionWithConnection(db, selectionId)
  if (!selection) throw new Error("Google Calendar selection was not found.")
  const accessToken = await accessTokenForConnection(env, selection)
  const events = await listGoogleCalendarEvents(
    accessToken,
    selection.calendarId,
    syncWindow(),
  )
  const now = new Date().toISOString()
  let imported = 0
  let updated = 0
  let conflicts = 0

  try {
    for (const event of events) {
      const outcome =
        selection.calendarScope === "organization"
          ? await syncOrganizationEvent(db, selection, event, now)
          : await cachePersonalEvent(db, selection, event, now)
      if (outcome === "imported") imported += 1
      else if (outcome === "conflict") conflicts += 1
      else updated += 1
    }
    if (selection.calendarScope === "organization") {
      const compassChanges = await db
        .select({
          eventId: workCalendarEvents.id,
          eventStatus: workCalendarEvents.status,
          eventVersion: workCalendarEvents.version,
          linkedVersion: googleCalendarEntityLinks.compassVersion,
          syncStatus: googleCalendarEntityLinks.syncStatus,
        })
        .from(googleCalendarEntityLinks)
        .innerJoin(
          workCalendarEvents,
          eq(workCalendarEvents.id, googleCalendarEntityLinks.sourceId),
        )
        .where(
          and(
            eq(googleCalendarEntityLinks.connectionId, selection.connectionId),
            eq(googleCalendarEntityLinks.googleCalendarId, selection.calendarId),
            eq(googleCalendarEntityLinks.sourceType, "work_calendar_event"),
          ),
        )
      for (const change of compassChanges) {
        if (
          change.syncStatus === "conflict" ||
          change.linkedVersion === change.eventVersion
        ) {
          continue
        }
        if (change.eventStatus === "cancelled") {
          await deleteLinkedWorkCalendarEventFromGoogle(db, env, change.eventId)
        } else {
          await publishWorkCalendarEventToGoogle(
            db,
            env,
            change.eventId,
            selection.selectionId,
          )
        }
        updated += 1
      }
    }
    await db
      .update(googleCalendarSelections)
      .set({ lastSyncedAt: now, lastError: null, updatedAt: now })
      .where(eq(googleCalendarSelections.id, selection.selectionId))
    await db
      .update(googleCalendarConnections)
      .set({ lastSyncedAt: now, lastError: null, updatedAt: now })
      .where(eq(googleCalendarConnections.id, selection.connectionId))
    return { imported, updated, conflicts }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Google Calendar sync failed."
    await db
      .update(googleCalendarSelections)
      .set({ lastError: message, updatedAt: now })
      .where(eq(googleCalendarSelections.id, selection.selectionId))
    await db
      .update(googleCalendarConnections)
      .set({ lastError: message, updatedAt: now })
      .where(eq(googleCalendarConnections.id, selection.connectionId))
    throw error
  }
}

export async function googleCalendarAccessToken(
  db: Database,
  env: object,
  selectionId: string,
): Promise<{
  readonly accessToken: string
  readonly selection: SelectionWithConnection
}> {
  const selection = await selectionWithConnection(db, selectionId)
  if (!selection) throw new Error("Google Calendar selection was not found.")
  return {
    accessToken: await accessTokenForConnection(env, selection),
    selection,
  }
}

function googleRecurrence(input: {
  readonly recurrence: string
  readonly recurrenceUntil: string | null
}): readonly string[] {
  if (input.recurrence === "none") return []
  const frequency = input.recurrence.toUpperCase()
  const until = input.recurrenceUntil?.replaceAll("-", "")
  return [
    `RRULE:FREQ=${frequency}${until ? `;UNTIL=${until}T235959Z` : ""}`,
  ]
}

export async function publishWorkCalendarEventToGoogle(
  db: Database,
  env: object,
  eventId: string,
  selectionId: string,
): Promise<void> {
  const token = await googleCalendarAccessToken(db, env, selectionId)
  const event = await db
    .select()
    .from(workCalendarEvents)
    .where(eq(workCalendarEvents.id, eventId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!event) throw new Error("Work Calendar event was not found.")
  const attendeeRows = await db
    .select({ email: users.email })
    .from(workCalendarEventAttendees)
    .innerJoin(users, eq(users.id, workCalendarEventAttendees.userId))
    .where(eq(workCalendarEventAttendees.eventId, eventId))
  const input: GoogleCalendarEventWrite = {
    summary: event.title,
    description: event.description,
    location: event.location,
    startDate: event.startDate,
    endDateExclusive: event.endDateExclusive,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timeZone: event.timeZone,
    visibility: event.visibility === "private" ? "private" : "default",
    recurrence: googleRecurrence(event),
    attendeeEmails: attendeeRows.map((attendee) => attendee.email),
  }
  const link = await db
    .select({
      id: googleCalendarEntityLinks.id,
      googleEventId: googleCalendarEntityLinks.googleEventId,
    })
    .from(googleCalendarEntityLinks)
    .where(
      and(
        eq(googleCalendarEntityLinks.connectionId, token.selection.connectionId),
        eq(googleCalendarEntityLinks.googleCalendarId, token.selection.calendarId),
        eq(googleCalendarEntityLinks.sourceType, "work_calendar_event"),
        eq(googleCalendarEntityLinks.sourceId, eventId),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  const googleEvent = link
    ? await updateGoogleCalendarEvent(
        token.accessToken,
        token.selection.calendarId,
        link.googleEventId,
        input,
      )
    : await createGoogleCalendarEvent(
        token.accessToken,
        token.selection.calendarId,
        {
          ...input,
          id: await googleEventIdForCompass(
            "work_calendar_event",
            eventId,
            token.selection.connectionId,
          ),
        },
      )
  const now = new Date().toISOString()
  if (link) {
    await db
      .update(googleCalendarEntityLinks)
      .set({
        googleICalUid: googleEvent.iCalUID,
        googleEtag: googleEvent.etag,
        googleUpdatedAt: googleEvent.updatedAt,
        compassVersion: event.version,
        syncStatus: "synced",
        lastSyncedAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(googleCalendarEntityLinks.id, link.id))
    return
  }
  await db.insert(googleCalendarEntityLinks).values({
    id: crypto.randomUUID(),
    connectionId: token.selection.connectionId,
    googleCalendarId: token.selection.calendarId,
    googleEventId: googleEvent.id,
    googleICalUid: googleEvent.iCalUID,
    sourceType: "work_calendar_event",
    sourceId: eventId,
    syncDirection: "two_way",
    syncStatus: "synced",
    googleEtag: googleEvent.etag,
    googleUpdatedAt: googleEvent.updatedAt,
    compassVersion: event.version,
    lastSyncedAt: now,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  })
}

export async function deleteLinkedWorkCalendarEventFromGoogle(
  db: Database,
  env: object,
  eventId: string,
): Promise<void> {
  const linked = await db
    .select({
      linkId: googleCalendarEntityLinks.id,
      googleEventId: googleCalendarEntityLinks.googleEventId,
      selectionId: googleCalendarSelections.id,
    })
    .from(googleCalendarEntityLinks)
    .innerJoin(
      googleCalendarSelections,
      and(
        eq(
          googleCalendarSelections.connectionId,
          googleCalendarEntityLinks.connectionId,
        ),
        eq(
          googleCalendarSelections.googleCalendarId,
          googleCalendarEntityLinks.googleCalendarId,
        ),
      ),
    )
    .where(
      and(
        eq(googleCalendarEntityLinks.sourceType, "work_calendar_event"),
        eq(googleCalendarEntityLinks.sourceId, eventId),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!linked) return
  const token = await googleCalendarAccessToken(db, env, linked.selectionId)
  await deleteGoogleCalendarEvent(
    token.accessToken,
    token.selection.calendarId,
    linked.googleEventId,
  )
  const now = new Date().toISOString()
  await db
    .update(googleCalendarEntityLinks)
    .set({
      syncStatus: "synced",
      googleEtag: null,
      lastSyncedAt: now,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(googleCalendarEntityLinks.id, linked.linkId))
}
