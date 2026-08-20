const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3"

type JsonRecord = Record<string, unknown>

export type GoogleCalendarListEntry = {
  readonly id: string
  readonly summary: string
  readonly description: string | null
  readonly timeZone: string | null
  readonly backgroundColor: string | null
  readonly accessRole: string
  readonly primary: boolean
  readonly deleted: boolean
}

export type GoogleCalendarEventItem = {
  readonly id: string
  readonly etag: string | null
  readonly iCalUID: string | null
  readonly recurringEventId: string | null
  readonly status: string
  readonly summary: string
  readonly description: string | null
  readonly location: string | null
  readonly htmlLink: string | null
  readonly meetingUrl: string | null
  readonly startDate: string | null
  readonly endDateExclusive: string | null
  readonly startsAt: string | null
  readonly endsAt: string | null
  readonly allDay: boolean
  readonly timeZone: string | null
  readonly visibility: string
  readonly transparency: string
  readonly organizerEmail: string | null
  readonly updatedAt: string | null
}

export type GoogleCalendarEventWrite = {
  readonly id?: string
  readonly summary: string
  readonly description: string | null
  readonly location: string | null
  readonly startDate: string | null
  readonly endDateExclusive: string | null
  readonly startsAt: string | null
  readonly endsAt: string | null
  readonly timeZone: string
  readonly visibility: "default" | "public" | "private"
  readonly recurrence: readonly string[]
  readonly attendeeEmails: readonly string[]
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(record: JsonRecord, key: string): string | null {
  const value = record[key]
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function booleanValue(record: JsonRecord, key: string): boolean {
  return record[key] === true
}

async function responsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function googleError(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback
  const error = payload.error
  if (!isRecord(error)) return fallback
  return stringValue(error, "message") ?? fallback
}

async function googleRequest(
  accessToken: string,
  url: URL,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  })
  const payload = await responsePayload(response)
  if (!response.ok) {
    throw new Error(
      googleError(payload, `Google Calendar request failed (${response.status}).`),
    )
  }
  return payload
}

function parseCalendar(value: unknown): GoogleCalendarListEntry | null {
  if (!isRecord(value)) return null
  const id = stringValue(value, "id")
  const summary = stringValue(value, "summary")
  if (!id || !summary) return null
  return {
    id,
    summary,
    description: stringValue(value, "description"),
    timeZone: stringValue(value, "timeZone"),
    backgroundColor: stringValue(value, "backgroundColor"),
    accessRole: stringValue(value, "accessRole") ?? "reader",
    primary: booleanValue(value, "primary"),
    deleted: booleanValue(value, "deleted"),
  }
}

function endpoint(path: string): URL {
  return new URL(`${GOOGLE_CALENDAR_API}${path}`)
}

export async function listGoogleCalendars(
  accessToken: string,
): Promise<readonly GoogleCalendarListEntry[]> {
  const calendars: GoogleCalendarListEntry[] = []
  let pageToken: string | null = null

  do {
    const url = endpoint("/users/me/calendarList")
    url.searchParams.set("maxResults", "250")
    url.searchParams.set("showDeleted", "false")
    if (pageToken) url.searchParams.set("pageToken", pageToken)
    const payload = await googleRequest(accessToken, url)
    if (!isRecord(payload)) throw new Error("Google returned an invalid calendar list.")
    const items = payload.items
    if (Array.isArray(items)) {
      for (const item of items) {
        const calendar = parseCalendar(item)
        if (calendar && !calendar.deleted) calendars.push(calendar)
      }
    }
    pageToken = stringValue(payload, "nextPageToken")
  } while (pageToken)

  return calendars.sort((left, right) => {
    if (left.primary !== right.primary) return left.primary ? -1 : 1
    return left.summary.localeCompare(right.summary)
  })
}

function nestedDate(record: JsonRecord, key: string): JsonRecord | null {
  const value = record[key]
  return isRecord(value) ? value : null
}

function conferenceMeetingUrl(record: JsonRecord): string | null {
  const hangoutLink = stringValue(record, "hangoutLink")
  if (hangoutLink) return hangoutLink
  const conferenceData = record.conferenceData
  if (!isRecord(conferenceData) || !Array.isArray(conferenceData.entryPoints)) {
    return null
  }
  for (const entryPoint of conferenceData.entryPoints) {
    if (!isRecord(entryPoint)) continue
    if (stringValue(entryPoint, "entryPointType") !== "video") continue
    const uri = stringValue(entryPoint, "uri")
    if (uri) return uri
  }
  return null
}

export function parseGoogleCalendarEvent(
  value: unknown,
): GoogleCalendarEventItem | null {
  if (!isRecord(value)) return null
  const id = stringValue(value, "id")
  if (!id) return null
  const start = nestedDate(value, "start")
  const end = nestedDate(value, "end")
  const startDate = start ? stringValue(start, "date") : null
  const endDateExclusive = end ? stringValue(end, "date") : null
  const startsAt = start ? stringValue(start, "dateTime") : null
  const endsAt = end ? stringValue(end, "dateTime") : null
  const organizer = isRecord(value.organizer) ? value.organizer : null

  return {
    id,
    etag: stringValue(value, "etag"),
    iCalUID: stringValue(value, "iCalUID"),
    recurringEventId: stringValue(value, "recurringEventId"),
    status: stringValue(value, "status") ?? "confirmed",
    summary: stringValue(value, "summary") ?? "Busy",
    description: stringValue(value, "description"),
    location: stringValue(value, "location"),
    htmlLink: stringValue(value, "htmlLink"),
    meetingUrl: conferenceMeetingUrl(value),
    startDate,
    endDateExclusive,
    startsAt,
    endsAt,
    allDay: startDate !== null,
    timeZone:
      (start ? stringValue(start, "timeZone") : null) ??
      (end ? stringValue(end, "timeZone") : null),
    visibility: stringValue(value, "visibility") ?? "default",
    transparency: stringValue(value, "transparency") ?? "opaque",
    organizerEmail: organizer ? stringValue(organizer, "email") : null,
    updatedAt: stringValue(value, "updated"),
  }
}

export async function listGoogleCalendarEvents(
  accessToken: string,
  calendarId: string,
  window: { readonly timeMin: string; readonly timeMax: string },
): Promise<readonly GoogleCalendarEventItem[]> {
  const events: GoogleCalendarEventItem[] = []
  let pageToken: string | null = null

  do {
    const url = endpoint(`/calendars/${encodeURIComponent(calendarId)}/events`)
    url.searchParams.set("maxResults", "2500")
    url.searchParams.set("showDeleted", "true")
    url.searchParams.set("singleEvents", "true")
    url.searchParams.set("timeMin", window.timeMin)
    url.searchParams.set("timeMax", window.timeMax)
    url.searchParams.set("orderBy", "startTime")
    if (pageToken) url.searchParams.set("pageToken", pageToken)
    const payload = await googleRequest(accessToken, url)
    if (!isRecord(payload)) throw new Error("Google returned an invalid event list.")
    const items = payload.items
    if (Array.isArray(items)) {
      for (const item of items) {
        const event = parseGoogleCalendarEvent(item)
        if (event) events.push(event)
      }
    }
    pageToken = stringValue(payload, "nextPageToken")
  } while (pageToken)

  return events
}

function eventBody(input: GoogleCalendarEventWrite): JsonRecord {
  const body: JsonRecord = {
    summary: input.summary,
    visibility: input.visibility,
  }
  if (input.description) body.description = input.description
  if (input.location) body.location = input.location
  if (input.startDate && input.endDateExclusive) {
    body.start = { date: input.startDate }
    body.end = { date: input.endDateExclusive }
  } else if (input.startsAt && input.endsAt) {
    body.start = { dateTime: input.startsAt, timeZone: input.timeZone }
    body.end = { dateTime: input.endsAt, timeZone: input.timeZone }
  }
  if (input.recurrence.length > 0) body.recurrence = [...input.recurrence]
  if (input.attendeeEmails.length > 0) {
    body.attendees = input.attendeeEmails.map((email) => ({ email }))
  }
  if (input.id) body.id = input.id
  return body
}

export async function createGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  input: GoogleCalendarEventWrite,
): Promise<GoogleCalendarEventItem> {
  const url = endpoint(`/calendars/${encodeURIComponent(calendarId)}/events`)
  url.searchParams.set(
    "sendUpdates",
    input.attendeeEmails.length > 0 ? "all" : "none",
  )
  const payload = await googleRequest(accessToken, url, {
    method: "POST",
    body: JSON.stringify(eventBody(input)),
  })
  const event = parseGoogleCalendarEvent(payload)
  if (!event) throw new Error("Google returned an invalid created event.")
  return event
}

export async function updateGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  googleEventId: string,
  input: GoogleCalendarEventWrite,
): Promise<GoogleCalendarEventItem> {
  const url = endpoint(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
  )
  url.searchParams.set(
    "sendUpdates",
    input.attendeeEmails.length > 0 ? "all" : "none",
  )
  const payload = await googleRequest(accessToken, url, {
    method: "PATCH",
    body: JSON.stringify(eventBody(input)),
  })
  const event = parseGoogleCalendarEvent(payload)
  if (!event) throw new Error("Google returned an invalid updated event.")
  return event
}

export async function deleteGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  googleEventId: string,
): Promise<void> {
  const url = endpoint(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
  )
  url.searchParams.set("sendUpdates", "all")
  const response = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (response.status === 404 || response.status === 410) return
  if (!response.ok) {
    const payload = await responsePayload(response)
    throw new Error(
      googleError(payload, `Google Calendar delete failed (${response.status}).`),
    )
  }
}
