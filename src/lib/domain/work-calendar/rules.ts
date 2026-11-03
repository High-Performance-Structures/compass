/**
 * Pure work-calendar rules: labels, windows, visibility and event input
 * validation. No database or network access.
 */
import { canManageOrganizationCalendars, canWriteGoogleCalendar } from "@/lib/google/calendar/policy"
import {
  isValidDateKey,
  isWorkCalendarEventType,
  isWorkCalendarEventVisibility,
  normalizeWorkCalendarEventTiming,
  resolveHOfficeProjectId,
} from "@/lib/work-calendar"
import { isWorkCalendarRecurrence } from "@/lib/work-calendar-recurrence"

import type {
  DestinationRow,
  GoogleCalendarDestination,
  NonEventKind,
  PersonNameRow,
  ProjectRow,
  WorkCalendarEventAttendee,
  WorkCalendarEventMutationInput,
} from "./types"

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** The loaded window: two weeks before the reference date to 45 days after. */
export function calendarWindow(calendarDate: string): { readonly rangeStart: string; readonly rangeEnd: string } {
  const calendarAnchor = new Date(`${calendarDate}T12:00:00Z`)
  return {
    rangeStart: toDateKey(addDays(calendarAnchor, -14)),
    rangeEnd: toDateKey(addDays(calendarAnchor, 45)),
  }
}

export function projectLabel(project: ProjectRow): string {
  return project.projectNumber ?? project.name
}

export function userDisplayName(input: PersonNameRow): string {
  const fullName = [input.firstName, input.lastName]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .trim()
  return input.displayName?.trim() || fullName || input.email
}

export function localTimeInZone(instant: string | null, timeZone: string): string {
  if (!instant) return ""
  const parsed = new Date(instant)
  if (Number.isNaN(parsed.getTime())) return ""
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(parsed)
    const values = new Map(parts.map((part) => [part.type, part.value]))
    const hour = values.get("hour")
    const minute = values.get("minute")
    return hour && minute ? `${hour}:${minute}` : ""
  } catch {
    return ""
  }
}

export function isClosedStatus(status: string): boolean {
  return [
    "closed",
    "complete",
    "completed",
    "inactive",
    "archive",
    "archived",
    "cancelled",
    "void",
  ].includes(status.trim().toLowerCase())
}

export function operationKind(recordType: string): NonEventKind {
  if (recordType === "purchase_order") return "purchase_order"
  return "task"
}

/** "purchase_order" -> "Purchase Order". */
function titleCaseKey(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

export function operationSourceLabel(recordType: string, recordNumber: string | null): string {
  if (recordType === "calendar_event") return "Calendar event"
  if (recordType === "schedule_task") {
    return recordNumber ? `Schedule item follow-up ${recordNumber}` : "Schedule item follow-up"
  }
  const label = titleCaseKey(recordType)
  return recordNumber ? `${label} ${recordNumber}` : label
}

/** Rows grouped by project, keeping their query order within each project. */
export function groupByProject<T extends { readonly projectId: string }>(
  rows: readonly T[],
): ReadonlyMap<string, readonly T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const list = grouped.get(row.projectId)
    if (list) list.push(row)
    else grouped.set(row.projectId, [row])
  }
  return grouped
}

export function intersectsCalendarWindow(
  startDate: string,
  endDate: string,
  rangeStart: string,
  rangeEnd: string,
  today: string,
): boolean {
  return (endDate >= rangeStart && startDate <= rangeEnd) || (endDate >= today && startDate <= today)
}

export function eventHref(eventId: string): string {
  return `/dashboard/schedule?kind=event&item=${encodeURIComponent(eventId)}#work-calendar-${encodeURIComponent(eventId)}`
}

export function eventStartLabel(input: {
  readonly startDate: string | null
  readonly startsAt: string | null
  readonly timeZone: string
}): string {
  if (input.startDate) {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${input.startDate}T12:00:00Z`))
  }
  if (!input.startsAt) return "its scheduled time"

  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: input.timeZone,
      timeZoneName: "short",
    }).format(new Date(input.startsAt))
  } catch {
    return input.startsAt
  }
}

export function canChangeLinkedGoogleEvent(input: {
  readonly role: string
  readonly userId: string
  readonly ownerUserId: string
  readonly calendarScope: string
  readonly allowedForInternalUsers: boolean
}): boolean {
  if (input.ownerUserId === input.userId) return true
  if (input.calendarScope !== "organization") return false
  return input.allowedForInternalUsers || canManageOrganizationCalendars(input.role)
}

/** Writable Compass destinations this viewer may create events in. */
export function writableGoogleDestinations(
  rows: readonly DestinationRow[],
  userId: string,
): readonly GoogleCalendarDestination[] {
  return rows
    .filter((destination) => {
      if (!canWriteGoogleCalendar(destination.accessRole)) return false
      if (destination.calendarScope === "organization") {
        return destination.internalCanCreate
      }
      return destination.ownerUserId === userId
    })
    .map((destination): GoogleCalendarDestination => ({
      selectionId: destination.selectionId,
      label: destination.summary,
      calendarScope: destination.calendarScope === "organization" ? "organization" : "personal",
    }))
}

/** A configured default project only counts while the viewer can see it. */
export function configuredDefaultProject(
  defaultProjectId: string | null | undefined,
  projects: readonly ProjectRow[],
): string | null {
  return defaultProjectId && projects.some((project) => project.id === defaultProjectId)
    ? defaultProjectId
    : null
}

export function attendeeFromRow(row: PersonNameRow & { readonly userId: string }): WorkCalendarEventAttendee {
  return { userId: row.userId, name: userDisplayName(row), email: row.email }
}

// ---- Event input validation

function cleanRequiredText(value: string, label: string, maxLength: number): string {
  const cleaned = value.trim()
  if (cleaned.length === 0) throw new Error(`${label} is required`)
  if (cleaned.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`)
  }
  return cleaned
}

function cleanOptionalText(value: string | null, label: string, maxLength: number): string | null {
  const cleaned = value?.trim() ?? ""
  if (cleaned.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`)
  }
  return cleaned || null
}

export function cleanOptionalUrl(value: string | null, label: string): string | null {
  const cleaned = cleanOptionalText(value, label, 2_000)
  if (!cleaned) return null

  try {
    const parsed = new URL(cleaned)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error()
    }
    return parsed.toString()
  } catch {
    throw new Error(`${label} must be a valid web address`)
  }
}

/** Unique, trimmed attendee ids; at most 100. */
export function normalizedAttendeeIds(attendeeUserIds: readonly string[]): readonly string[] {
  const normalizedIds = Array.from(
    new Set(attendeeUserIds.map((userId) => userId.trim()).filter((userId) => userId.length > 0)),
  )
  if (normalizedIds.length > 100) {
    throw new Error("An event can include up to 100 attendees")
  }
  return normalizedIds
}

export type ResolvedEventProject = {
  readonly project: ProjectRow
  /** True when the inferred H-Office project should be saved as the default. */
  readonly rememberAsDefault: boolean
}

export function resolveEventProject(
  input: Pick<WorkCalendarEventMutationInput, "projectId">,
  projects: readonly ProjectRow[],
  settingsDefaultProjectId: string | null | undefined,
): ResolvedEventProject {
  const configuredDefaultProjectId = configuredDefaultProject(settingsDefaultProjectId, projects)
  const inferredDefaultProjectId = resolveHOfficeProjectId(projects)
  const projectId = input.projectId?.trim() || configuredDefaultProjectId || inferredDefaultProjectId
  if (!projectId) {
    throw new Error(
      "Select a project. Compass could not resolve one unique H-Office project for this organization.",
    )
  }
  const project = projects.find((candidate) => candidate.id === projectId)
  if (!project) throw new Error("Project not found")
  return {
    project,
    rememberAsDefault:
      !input.projectId?.trim() && !configuredDefaultProjectId && inferredDefaultProjectId === project.id,
  }
}

export type ValidatedEventFields = {
  readonly title: string
  readonly eventType: WorkCalendarEventMutationInput["eventType"]
  readonly visibility: WorkCalendarEventMutationInput["visibility"]
  readonly description: string | null
  readonly startDate: string | null
  readonly endDateExclusive: string | null
  readonly startsAt: string | null
  readonly endsAt: string | null
  readonly allDay: boolean
  readonly timeZone: string
  readonly location: string | null
  readonly meetingUrl: string | null
  readonly createGoogleMeet: boolean
  readonly recurrence: WorkCalendarEventMutationInput["recurrence"]
  readonly recurrenceUntil: string | null
}

/** Everything about an event input that needs no database, in the original check order. */
export function validateEventFields(input: WorkCalendarEventMutationInput): ValidatedEventFields {
  const timing = normalizeWorkCalendarEventTiming(input)
  if (!timing.success) throw new Error(timing.error)
  if (!isWorkCalendarEventType(input.eventType)) {
    throw new Error("Select a valid event type")
  }
  if (!isWorkCalendarEventVisibility(input.visibility)) {
    throw new Error("Select a valid event visibility")
  }
  if (!isWorkCalendarRecurrence(input.recurrence)) {
    throw new Error("Select a valid repeat option")
  }
  const recurrenceUntil = input.recurrence === "none" ? null : input.recurrenceUntil?.trim() ?? ""
  if (
    input.recurrence !== "none" &&
    (!recurrenceUntil || !isValidDateKey(recurrenceUntil) || recurrenceUntil < input.startDate)
  ) {
    throw new Error("Repeat-until date must be on or after the first event")
  }
  if (recurrenceUntil) {
    const latest = new Date(`${input.startDate}T12:00:00Z`)
    latest.setUTCFullYear(latest.getUTCFullYear() + 10)
    if (recurrenceUntil > latest.toISOString().slice(0, 10)) {
      throw new Error("A recurring series can span up to 10 years")
    }
  }
  if (typeof input.createGoogleMeet !== "boolean") {
    throw new Error("Select whether Google Meet should be added")
  }
  const meetingUrl = cleanOptionalUrl(input.meetingUrl, "Meeting link")
  if (input.createGoogleMeet && input.eventType !== "meeting") {
    throw new Error("Google Meet can only be added to meeting events")
  }
  if (input.createGoogleMeet && meetingUrl) {
    throw new Error("Clear the meeting link before asking Google to create one")
  }

  return {
    title: cleanRequiredText(input.title, "Event title", 200),
    eventType: input.eventType,
    visibility: input.visibility,
    description: cleanOptionalText(input.description, "Description", 5_000),
    startDate: timing.startDate,
    endDateExclusive: timing.endDateExclusive,
    startsAt: timing.startsAt,
    endsAt: timing.endsAt,
    allDay: input.allDay,
    timeZone: timing.timeZone,
    location: cleanOptionalText(input.location, "Location", 500),
    meetingUrl,
    createGoogleMeet: input.createGoogleMeet === true,
    recurrence: input.recurrence,
    recurrenceUntil: recurrenceUntil || null,
  }
}
