import { addDays } from "@/lib/my-compass-calendar/items"
import { scheduleItemHref } from "@/lib/work-calendar"

/** When an event happens: all day across dates, or at set times. */
export type ProjectCalendarTiming =
  | {
      readonly kind: "date"
      /** Inclusive first day, YYYY-MM-DD. */
      readonly startDate: string
      /** Exclusive end day, YYYY-MM-DD (Google's all-day convention). */
      readonly endDateExclusive: string
    }
  | {
      readonly kind: "time"
      readonly startsAt: string
      readonly endsAt: string
      readonly timeZone: string
    }

/** One event Compass keeps on a project's Google calendar. */
export type ProjectCalendarItem = {
  /** "<source>:<record id>"; stable across syncs. */
  readonly key: string
  readonly summary: string
  readonly description: string
  readonly location: string | null
  readonly timing: ProjectCalendarTiming
  /** RRULE lines for repeating Work Calendar events. */
  readonly recurrence: readonly string[]
}

const FOOTER = "Kept up to date by Compass. Change it in Compass; edits made here are replaced."

function link(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`
}

function lines(values: readonly (string | null)[]): string {
  return values.filter((line): line is string => line !== null).join("\n")
}

export function projectCalendarName(project: {
  readonly name: string
  readonly projectNumber: string | null
}): string {
  const label = project.projectNumber?.trim() ? `${project.projectNumber.trim()} ${project.name}` : project.name
  return `Compass – ${label}`.slice(0, 240)
}

export function scheduleTaskItem(input: {
  readonly baseUrl: string
  readonly task: {
    readonly id: string
    readonly projectId: string
    readonly title: string
    readonly startDate: string
    readonly endDate: string
    readonly phase: string
    readonly isMilestone: boolean
    readonly assignedTo: string | null
    readonly status: string
  }
}): ProjectCalendarItem {
  const { task } = input
  const start = task.isMilestone ? task.endDate : task.startDate
  const end = task.endDate < start ? start : task.endDate
  return {
    key: `schedule:${task.id}`,
    summary: `${task.isMilestone ? "Milestone: " : ""}${task.title}`,
    description: lines([
      task.phase ? `Phase: ${task.phase}` : null,
      task.assignedTo ? `Assigned to: ${task.assignedTo}` : null,
      `Status: ${task.status}`,
      "",
      `Open in Compass: ${link(input.baseUrl, scheduleItemHref(task.projectId, task.id))}`,
      "",
      FOOTER,
    ]),
    location: null,
    timing: { kind: "date", startDate: start, endDateExclusive: addDays(end, 1) },
    recurrence: [],
  }
}

function googleRecurrence(recurrence: string, until: string | null): readonly string[] {
  if (recurrence === "none") return []
  const stop = until?.replaceAll("-", "")
  return [`RRULE:FREQ=${recurrence.toUpperCase()}${stop ? `;UNTIL=${stop}T235959Z` : ""}`]
}

export function workEventItem(input: {
  readonly baseUrl: string
  readonly projectId: string
  readonly event: {
    readonly id: string
    readonly title: string
    readonly eventType: string
    readonly description: string | null
    readonly location: string | null
    readonly meetingUrl: string | null
    readonly allDay: boolean
    readonly startDate: string | null
    readonly endDateExclusive: string | null
    readonly startsAt: string | null
    readonly endsAt: string | null
    readonly timeZone: string
    readonly recurrence: string
    readonly recurrenceUntil: string | null
  }
}): ProjectCalendarItem | null {
  const { event } = input
  const timing: ProjectCalendarTiming | null =
    event.allDay && event.startDate
      ? {
          kind: "date",
          startDate: event.startDate,
          endDateExclusive:
            event.endDateExclusive && event.endDateExclusive > event.startDate
              ? event.endDateExclusive
              : addDays(event.startDate, 1),
        }
      : event.startsAt && event.endsAt
        ? { kind: "time", startsAt: event.startsAt, endsAt: event.endsAt, timeZone: event.timeZone }
        : null
  if (!timing) return null
  return {
    key: `event:${event.id}`,
    summary: event.title,
    description: lines([
      event.description?.trim() || null,
      event.meetingUrl ? `Join: ${event.meetingUrl}` : null,
      event.description?.trim() || event.meetingUrl ? "" : null,
      `Open in Compass: ${link(input.baseUrl, "/dashboard/schedule")}`,
      "",
      FOOTER,
    ]),
    location: event.location ?? event.meetingUrl,
    timing,
    recurrence: googleRecurrence(event.recurrence, event.recurrenceUntil),
  }
}

export function clientMeetingItem(input: {
  readonly baseUrl: string
  readonly meeting: {
    readonly id: string
    readonly projectId: string
    readonly title: string
    readonly note: string | null
    readonly startsAt: string
    readonly endsAt: string
    readonly timeZone: string
    readonly meetingUrl: string | null
    readonly organizerEmail: string
  }
}): ProjectCalendarItem {
  const { meeting } = input
  return {
    key: `client-meeting:${meeting.id}`,
    summary: `Meeting: ${meeting.title}`,
    description: lines([
      meeting.note?.trim() || null,
      meeting.meetingUrl ? `Join Google Meet: ${meeting.meetingUrl}` : null,
      `Host: ${meeting.organizerEmail}`,
      "",
      `Open in Compass: ${link(input.baseUrl, `/dashboard/projects/${meeting.projectId}`)}`,
      "",
      FOOTER,
    ]),
    location: meeting.meetingUrl,
    timing: { kind: "time", startsAt: meeting.startsAt, endsAt: meeting.endsAt, timeZone: meeting.timeZone },
    recurrence: [],
  }
}

/** The Google Calendar event body for an item. */
export function projectEventBody(item: ProjectCalendarItem): string {
  const timing =
    item.timing.kind === "date"
      ? { start: { date: item.timing.startDate }, end: { date: item.timing.endDateExclusive } }
      : {
          start: { dateTime: item.timing.startsAt, timeZone: item.timing.timeZone },
          end: { dateTime: item.timing.endsAt, timeZone: item.timing.timeZone },
        }
  return JSON.stringify({
    summary: item.summary,
    description: item.description,
    location: item.location ?? undefined,
    ...timing,
    recurrence: item.recurrence.length > 0 ? item.recurrence : undefined,
    // A shared job calendar shouldn't block anyone's free time or ping them.
    transparency: "transparent",
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: { private: { compassItemKey: item.key } },
  })
}

/** Changes whenever anything Google shows for the item changes. */
export async function projectItemHash(item: ProjectCalendarItem): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(projectEventBody(item)))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

