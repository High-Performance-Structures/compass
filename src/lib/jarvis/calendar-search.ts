import {
  and,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
} from "drizzle-orm"

import { getDb } from "@/db"
import {
  googleCalendarConnections,
  googleCalendarEntityLinks,
  googleCalendarEvents,
  googleCalendarSelections,
  workCalendarEventAttendees,
  workCalendarEvents,
} from "@/db/schema"
import { calendarDetailLevel } from "@/lib/google/calendar/sync-policy"
import {
  calendarEventHref,
  type JarvisCompassSearchResult,
} from "@/lib/jarvis/search"
import {
  dateKeyInTimeZone,
  inclusiveEndDateFromExclusive,
  isWorkCalendarEventVisibility,
} from "@/lib/work-calendar"
import {
  expandWorkCalendarRecurrence,
  isWorkCalendarRecurrence,
} from "@/lib/work-calendar-recurrence"

type JarvisDb = ReturnType<typeof getDb>

type JarvisCalendarProject = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
}

type JarvisCalendarSearchInput = {
  readonly db: JarvisDb
  readonly organizationId: string
  readonly userId: string
  readonly timeZone: string
  readonly targetDate: string
  readonly projectById: ReadonlyMap<string, JarvisCalendarProject>
  readonly requestedProjectIds: ReadonlySet<string>
  readonly includeUnscopedEvents: boolean
}

type JarvisCalendarSearchResult = {
  readonly results: readonly JarvisCompassSearchResult[]
  readonly complete: boolean
}

function addDateDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function calendarCandidateWindow(targetDate: string): {
  readonly lowerUtc: string
  readonly upperUtc: string
} {
  return {
    lowerUtc: `${addDateDays(targetDate, -1)}T00:00:00.000Z`,
    upperUtc: `${addDateDays(targetDate, 2)}T00:00:00.000Z`,
  }
}

function dateSpanIncludes(
  startDate: string | null,
  endDate: string | null,
  targetDate: string,
): boolean {
  return (
    startDate !== null &&
    endDate !== null &&
    startDate <= targetDate &&
    endDate >= targetDate
  )
}

function cleanSummary(...values: readonly (string | null)[]): string {
  return values
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0)
    .join(" · ")
    .replace(/\s+/g, " ")
    .slice(0, 700)
}

function localTime(instant: string | null, timeZone: string): string | null {
  if (!instant) return null
  const date = new Date(instant)
  if (Number.isNaN(date.getTime())) return null
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date)
  } catch {
    return null
  }
}

function eventDateSpan(input: {
  readonly allDay: boolean
  readonly startDate: string | null
  readonly endDateExclusive: string | null
  readonly startsAt: string | null
  readonly endsAt: string | null
  readonly timeZone: string
}): { readonly startDate: string | null; readonly endDate: string | null } {
  if (input.allDay) {
    return {
      startDate: input.startDate,
      endDate: input.endDateExclusive
        ? inclusiveEndDateFromExclusive(input.endDateExclusive)
        : null,
    }
  }

  const start = input.startsAt ? new Date(input.startsAt) : null
  const end = input.endsAt
    ? new Date(new Date(input.endsAt).getTime() - 1)
    : null
  return {
    startDate:
      start && !Number.isNaN(start.getTime())
        ? dateKeyInTimeZone(start, input.timeZone)
        : null,
    endDate:
      end && !Number.isNaN(end.getTime())
        ? dateKeyInTimeZone(end, input.timeZone)
        : null,
  }
}

async function compassCalendarResults(
  input: JarvisCalendarSearchInput,
): Promise<JarvisCalendarSearchResult> {
  const window = calendarCandidateWindow(input.targetDate)
  const eventRows = await input.db
    .select()
    .from(workCalendarEvents)
    .where(
      and(
        eq(workCalendarEvents.organizationId, input.organizationId),
        eq(workCalendarEvents.status, "open"),
        or(
          and(
            eq(workCalendarEvents.allDay, true),
            lte(workCalendarEvents.startDate, input.targetDate),
            gt(workCalendarEvents.endDateExclusive, input.targetDate),
          ),
          and(
            eq(workCalendarEvents.allDay, false),
            lt(workCalendarEvents.startsAt, window.upperUtc),
            gt(workCalendarEvents.endsAt, window.lowerUtc),
          ),
          // Compass recurrence is intentionally bounded: create/update requires
          // recurrenceUntil and the shared expander rejects null-ended series.
          and(
            ne(workCalendarEvents.recurrence, "none"),
            gte(workCalendarEvents.recurrenceUntil, input.targetDate),
            or(
              lte(workCalendarEvents.startDate, input.targetDate),
              lt(workCalendarEvents.startsAt, window.upperUtc),
            ),
          ),
        ),
      ),
    )
    .orderBy(workCalendarEvents.startDate, workCalendarEvents.startsAt)
    .limit(201)
  const candidateRows = eventRows.slice(0, 200)
  const candidateIds = candidateRows.map((event) => event.id)
  const attendeeRows =
    candidateIds.length === 0
      ? []
      : await input.db
          .select({ eventId: workCalendarEventAttendees.eventId })
          .from(workCalendarEventAttendees)
          .where(
            and(
              eq(workCalendarEventAttendees.userId, input.userId),
              inArray(workCalendarEventAttendees.eventId, candidateIds),
            ),
          )
  const attendedEventIds = new Set(
    attendeeRows.map((attendee) => attendee.eventId),
  )
  const results: JarvisCompassSearchResult[] = []

  for (const calendarEvent of candidateRows) {
    if (calendarEvent.projectId === null && !input.includeUnscopedEvents) {
      continue
    }
    if (
      calendarEvent.projectId !== null &&
      !input.requestedProjectIds.has(calendarEvent.projectId)
    ) {
      continue
    }
    const eventTimeZone = calendarEvent.timeZone || input.timeZone
    const span = eventDateSpan({
      allDay: calendarEvent.allDay,
      startDate: calendarEvent.startDate,
      endDateExclusive: calendarEvent.endDateExclusive,
      startsAt: calendarEvent.startsAt,
      endsAt: calendarEvent.endsAt,
      timeZone: eventTimeZone,
    })
    if (!span.startDate || !span.endDate) continue

    const detailLevel = calendarDetailLevel({
      visibility: isWorkCalendarEventVisibility(calendarEvent.visibility)
        ? calendarEvent.visibility
        : "organization",
      viewerIsOwner: calendarEvent.createdBy === input.userId,
      viewerIsParticipant: attendedEventIds.has(calendarEvent.id),
      viewerHasProjectAccess:
        calendarEvent.projectId === null ||
        input.projectById.has(calendarEvent.projectId),
      hasProjectScope: calendarEvent.projectId !== null,
    })
    if (detailLevel === "hidden") continue

    const recurrence = isWorkCalendarRecurrence(calendarEvent.recurrence)
      ? calendarEvent.recurrence
      : "none"
    const occurrences = expandWorkCalendarRecurrence({
      startDate: span.startDate,
      endDate: span.endDate,
      recurrence,
      recurrenceUntil: calendarEvent.recurrenceUntil,
      windowStart: input.targetDate,
      windowEnd: input.targetDate,
    })
    const showDetails = detailLevel === "full"
    const project = calendarEvent.projectId
      ? input.projectById.get(calendarEvent.projectId) ?? null
      : null

    for (const occurrence of occurrences) {
      const occurrenceId =
        recurrence === "none"
          ? calendarEvent.id
          : `${calendarEvent.id}--${occurrence.startDate}`
      const startTime = localTime(calendarEvent.startsAt, eventTimeZone)
      const endTime = localTime(calendarEvent.endsAt, eventTimeZone)
      const occurrenceTiming = calendarEvent.allDay
        ? "All day"
        : `${occurrence.startDate}${startTime ? ` ${startTime}` : ""} — ${occurrence.endDate}${endTime ? ` ${endTime}` : ""} (${eventTimeZone})`
      const occurrenceSortDate =
        recurrence === "none"
          ? calendarEvent.startsAt ?? occurrence.startDate
          : `${occurrence.startDate}T${startTime ?? "00:00"}:00`
      results.push({
        kind: "calendar_event",
        title: showDetails ? calendarEvent.title : "Busy",
        summary: showDetails
          ? cleanSummary(
              occurrenceTiming,
              calendarEvent.location,
              calendarEvent.description,
            )
          : "Private calendar event",
        projectName: showDetails
          ? project?.name ?? "Work Calendar"
          : "Private",
        projectNumber: showDetails ? project?.projectNumber ?? null : null,
        date: occurrenceSortDate,
        status: calendarEvent.status,
        href: showDetails
          ? calendarEventHref(occurrenceId)
          : "/dashboard/schedule",
        verified: true,
        lifecycleStage: null,
      })
    }
  }

  return { results, complete: eventRows.length <= 200 }
}

async function googleCalendarResults(
  input: JarvisCalendarSearchInput,
): Promise<JarvisCalendarSearchResult> {
  if (!input.includeUnscopedEvents) return { results: [], complete: true }

  const window = calendarCandidateWindow(input.targetDate)
  const rows = await input.db
    .select({
      title: googleCalendarEvents.title,
      description: googleCalendarEvents.description,
      location: googleCalendarEvents.location,
      htmlLink: googleCalendarEvents.htmlLink,
      startDate: googleCalendarEvents.startDate,
      endDateExclusive: googleCalendarEvents.endDateExclusive,
      startsAt: googleCalendarEvents.startsAt,
      endsAt: googleCalendarEvents.endsAt,
      allDay: googleCalendarEvents.allDay,
      timeZone: googleCalendarEvents.timeZone,
      status: googleCalendarEvents.status,
      calendarName: googleCalendarSelections.summary,
    })
    .from(googleCalendarEvents)
    .innerJoin(
      googleCalendarSelections,
      eq(googleCalendarSelections.id, googleCalendarEvents.selectionId),
    )
    .innerJoin(
      googleCalendarConnections,
      eq(googleCalendarConnections.id, googleCalendarSelections.connectionId),
    )
    .leftJoin(
      googleCalendarEntityLinks,
      and(
        eq(
          googleCalendarEntityLinks.connectionId,
          googleCalendarConnections.id,
        ),
        eq(
          googleCalendarEntityLinks.googleCalendarId,
          googleCalendarSelections.googleCalendarId,
        ),
        eq(
          googleCalendarEntityLinks.googleEventId,
          googleCalendarEvents.googleEventId,
        ),
        eq(googleCalendarEntityLinks.sourceType, "work_calendar_event"),
      ),
    )
    .where(
      and(
        eq(googleCalendarConnections.organizationId, input.organizationId),
        eq(googleCalendarConnections.userId, input.userId),
        eq(googleCalendarSelections.selected, true),
        eq(googleCalendarSelections.importEvents, true),
        eq(googleCalendarSelections.calendarScope, "personal"),
        isNull(googleCalendarEntityLinks.id),
        or(
          and(
            eq(googleCalendarEvents.allDay, true),
            lte(googleCalendarEvents.startDate, input.targetDate),
            gt(googleCalendarEvents.endDateExclusive, input.targetDate),
          ),
          and(
            eq(googleCalendarEvents.allDay, false),
            lt(googleCalendarEvents.startsAt, window.upperUtc),
            gt(googleCalendarEvents.endsAt, window.lowerUtc),
          ),
        ),
      ),
    )
    .limit(201)

  const results: JarvisCompassSearchResult[] = []
  for (const event of rows.slice(0, 200)) {
    if (event.status === "cancelled") continue
    const span = eventDateSpan({
      allDay: event.allDay,
      startDate: event.startDate,
      endDateExclusive: event.endDateExclusive,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timeZone: event.timeZone ?? input.timeZone,
    })
    if (!dateSpanIncludes(span.startDate, span.endDate, input.targetDate)) {
      continue
    }

    results.push({
      kind: "calendar_event",
      title: event.title,
      summary: cleanSummary(
        event.allDay
          ? "All day"
          : `${event.startsAt ?? ""} — ${event.endsAt ?? ""}`,
        event.location,
        event.description,
      ),
      projectName: event.calendarName,
      projectNumber: null,
      date: event.startsAt ?? event.startDate ?? input.targetDate,
      status: event.status,
      href: event.htmlLink ?? "/dashboard/schedule",
      verified: true,
      lifecycleStage: null,
    })
  }

  return { results, complete: rows.length <= 200 }
}

export async function searchJarvisCalendar(
  input: JarvisCalendarSearchInput,
): Promise<JarvisCalendarSearchResult> {
  const [compassResults, googleResults] = await Promise.all([
    compassCalendarResults(input),
    googleCalendarResults(input),
  ])
  return {
    results: [...compassResults.results, ...googleResults.results],
    complete: compassResults.complete && googleResults.complete,
  }
}
