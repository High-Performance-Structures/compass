/**
 * The work calendar's pure assembler: turns the rows the loaders read into
 * calendar entries. No database or network access; `getWorkCalendar` loads
 * the rows and calls `assembleWorkCalendarEntries`.
 */
import { calendarDetailLevel } from "@/lib/google/calendar/sync-policy"
import { projectAudienceSectionHref } from "@/lib/project-audience-preview-routes"
import { selectProjectAudienceScheduleItems } from "@/lib/project-audience-schedule-visibility"
import { isProjectTodoRecordType } from "@/lib/project-todos"
import { linkedScheduleTaskId, linkedTodoSourceLabel } from "@/lib/schedule/linked-todos"
import { summarizeOwnerScheduleByPhase } from "@/lib/schedule/owner-visibility"
import { activePublishedScheduleSnapshot } from "@/lib/schedule/publications"
import {
  dateKeyInTimeZone,
  inclusiveEndDateFromExclusive,
  isWorkCalendarEventType,
  isWorkCalendarEventVisibility,
  projectPurchaseOrderHref,
  projectRfiHref,
  projectTodoHref,
  scheduleItemHref,
} from "@/lib/work-calendar"
import { expandWorkCalendarRecurrence, isWorkCalendarRecurrence } from "@/lib/work-calendar-recurrence"

import {
  canChangeLinkedGoogleEvent,
  eventHref,
  groupByProject,
  intersectsCalendarWindow,
  isClosedStatus,
  localTimeInZone,
  operationKind,
  operationSourceLabel,
  projectLabel,
  userDisplayName,
} from "./rules"
import type {
  AttendeeRow,
  CalendarEventRow,
  CalendarProjectRow,
  LinkedEventRow,
  OperationRow,
  PersonalGoogleEventRow,
  RfiRow,
  WorkCalendarEntry,
  WorkCalendarEventAttendee,
  WorkingTaskRow,
} from "./types"

export type CalendarViewer = {
  readonly userId: string
  readonly role: string
  readonly canManageEvents: boolean
  readonly canUseManagedGoogleCalendar: boolean
  /** Staff see the working schedule; others see the published one. */
  readonly canViewWorkingSchedule: boolean
}

export type CalendarRange = {
  readonly today: string
  readonly rangeStart: string
  readonly rangeEnd: string
}

type ProjectAudience = "owner" | "sub_vendor"

/** Members outside the company see the schedule published to their audience. */
export function projectAudience(projectRole: string | undefined): ProjectAudience | null {
  return projectRole === "client" || projectRole === "owner"
    ? "owner"
    : projectRole === "subcontractor" || projectRole === "supplier"
      ? "sub_vendor"
      : null
}

type ScheduleRow = Omit<WorkingTaskRow, "projectId">

/** The published schedule rows an owner or sub/vendor may see. */
function publishedScheduleRows(
  project: CalendarProjectRow,
  audience: ProjectAudience | null,
  snapshotData: string | null,
): readonly ScheduleRow[] {
  const snapshot = activePublishedScheduleSnapshot(project.schedulePublished, snapshotData)
  const publishedItems = snapshot && audience ? selectProjectAudienceScheduleItems(snapshot.tasks, audience) : []
  return audience === "owner" && project.ownerScheduleView === "phases"
    ? summarizeOwnerScheduleByPhase(
        publishedItems.map((item) => ({ ...item, endDate: item.endDateCalculated })),
      ).map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        startDate: item.startDate,
        endDate: item.endDate,
        assignedTo: item.assignedTo,
        isCriticalPath: false,
      }))
    : publishedItems.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        startDate: item.startDate,
        endDate: item.endDateCalculated,
        assignedTo: item.assignedTo,
        isCriticalPath: item.isCriticalPath,
      }))
}

/**
 * A legacy calendar-event to-do, kept visible until reconciliation promotes
 * it (rows created between the additive migration and the new deployment).
 */
function legacyCalendarEventEntry(
  project: CalendarProjectRow,
  operation: OperationRow,
  startDate: string,
  endDate: string,
): WorkCalendarEntry {
  return {
    id: operation.id,
    kind: "event",
    projectId: project.id,
    projectLabel: projectLabel(project),
    projectName: project.name,
    title: operation.title,
    status: operation.status,
    priority: operation.priority,
    startDate,
    endDate,
    assignedTo: operation.assigneeName,
    companyName: operation.companyName,
    sourceLabel: "Legacy calendar event",
    href: eventHref(operation.id),
    eventDetails: {
      masterEventId: operation.id,
      eventType: "other",
      visibility: "organization",
      description: null,
      startDate,
      endDate,
      startTime: "",
      endTime: "",
      startsAt: null,
      endsAt: null,
      allDay: true,
      timeZone: "UTC",
      location: null,
      meetingUrl: null,
      recurrence: "none",
      recurrenceUntil: null,
      attendees: [],
      version: 0,
      managed: false,
    },
  }
}

function operationEntries(
  project: CalendarProjectRow,
  operations: readonly OperationRow[],
  scheduleTaskById: ReadonlyMap<string, ScheduleRow>,
  dedicatedEventIds: ReadonlySet<string>,
  range: CalendarRange,
): readonly WorkCalendarEntry[] {
  const entries: WorkCalendarEntry[] = []
  const scheduleTaskIds = new Set(scheduleTaskById.keys())
  const label = projectLabel(project)
  for (const operation of operations) {
    const startDate = operation.startDate ?? operation.dueDate
    const endDate = operation.dueDate ?? operation.startDate
    if (operation.sourceRecordType === "calendar_event") {
      if (dedicatedEventIds.has(operation.id)) continue
      if (!startDate || !endDate) continue
      if (!intersectsCalendarWindow(startDate, endDate, range.rangeStart, range.rangeEnd, range.today)) continue
      entries.push(legacyCalendarEventEntry(project, operation, startDate, endDate))
      continue
    }
    if (isClosedStatus(operation.status)) continue
    const relatedScheduleTaskId = linkedScheduleTaskId(operation, scheduleTaskIds)
    const relatedScheduleTask = relatedScheduleTaskId ? scheduleTaskById.get(relatedScheduleTaskId) ?? null : null
    if (!startDate || !endDate) continue
    if (!intersectsCalendarWindow(startDate, endDate, range.rangeStart, range.rangeEnd, range.today)) continue

    entries.push({
      id: operation.id,
      kind: operationKind(operation.sourceRecordType),
      projectId: project.id,
      projectLabel: label,
      projectName: project.name,
      title: operation.title,
      status: operation.status,
      priority: operation.priority,
      startDate,
      endDate,
      assignedTo: operation.assigneeName,
      companyName: operation.companyName,
      sourceLabel: relatedScheduleTask
        ? linkedTodoSourceLabel(relatedScheduleTask.title, operation.sourceRecordNumber)
        : operationSourceLabel(operation.sourceRecordType, operation.sourceRecordNumber),
      href:
        operation.sourceRecordType === "purchase_order"
          ? projectPurchaseOrderHref(project.id, operation.id)
          : isProjectTodoRecordType(operation.sourceRecordType)
            ? projectTodoHref(project.id, operation.id)
            : `/dashboard/projects/${project.id}`,
      eventDetails: null,
    })
  }
  return entries
}

export type ProjectSourceRows = {
  readonly projects: readonly CalendarProjectRow[]
  /** Membership role per project; only read for viewers outside the staff. */
  readonly projectRoles: ReadonlyMap<string, string>
  /** Latest publication snapshot per project, for owner and sub/vendor viewers. */
  readonly publishedSnapshots: ReadonlyMap<string, string | null>
  readonly workingTasks: readonly WorkingTaskRow[]
  readonly rfis: readonly RfiRow[]
  readonly operations: readonly OperationRow[]
  readonly dedicatedEventIds: ReadonlySet<string>
}

/** Schedule items, RFIs and to-dos per project, in the original per-project order. */
export function projectSourceEntries(
  viewer: CalendarViewer,
  rows: ProjectSourceRows,
  range: CalendarRange,
): readonly WorkCalendarEntry[] {
  const workingTasksByProject = groupByProject(rows.workingTasks)
  const rfisByProject = groupByProject(rows.rfis)
  const operationsByProject = groupByProject(rows.operations)
  const entries: WorkCalendarEntry[] = []

  for (const project of rows.projects) {
    const label = projectLabel(project)
    const audience = projectAudience(rows.projectRoles.get(project.id))
    const taskRows: readonly ScheduleRow[] = viewer.canViewWorkingSchedule
      ? workingTasksByProject.get(project.id) ?? []
      : publishedScheduleRows(project, audience, rows.publishedSnapshots.get(project.id) ?? null)
    const scheduleTaskById = new Map(taskRows.map((scheduleTask) => [scheduleTask.id, scheduleTask]))

    for (const task of taskRows) {
      if (isClosedStatus(task.status)) continue
      if (!intersectsCalendarWindow(task.startDate, task.endDate, range.rangeStart, range.rangeEnd, range.today)) {
        continue
      }
      entries.push({
        id: task.id,
        kind: "schedule",
        projectId: project.id,
        projectLabel: label,
        projectName: project.name,
        title: task.title,
        status: task.status,
        priority: task.isCriticalPath ? "critical" : "normal",
        startDate: task.startDate,
        endDate: task.endDate,
        assignedTo: task.assignedTo,
        companyName: null,
        sourceLabel: "Project schedule",
        href: viewer.canViewWorkingSchedule
          ? scheduleItemHref(project.id, task.id)
          : projectAudienceSectionHref(project.id, audience === "owner" ? "owner" : "sub-vendor", "schedule"),
        eventDetails: null,
      })
    }

    for (const rfi of rfisByProject.get(project.id) ?? []) {
      if (isClosedStatus(rfi.status) || rfi.status === "complete") continue
      if (
        !rfi.dueDate ||
        !intersectsCalendarWindow(rfi.dueDate, rfi.dueDate, range.rangeStart, range.rangeEnd, range.today)
      ) {
        continue
      }
      entries.push({
        id: rfi.id,
        kind: "rfi",
        projectId: project.id,
        projectLabel: label,
        projectName: project.name,
        title: rfi.subject,
        status: rfi.status,
        priority: rfi.priority,
        startDate: rfi.dueDate,
        endDate: rfi.dueDate,
        assignedTo: rfi.assignedToName,
        companyName: rfi.companyName,
        sourceLabel: `RFI ${rfi.rfiNumber}`,
        href: projectRfiHref(project.id, rfi.id),
        eventDetails: null,
      })
    }

    entries.push(
      ...operationEntries(
        project,
        operationsByProject.get(project.id) ?? [],
        scheduleTaskById,
        rows.dedicatedEventIds,
        range,
      ),
    )
  }
  return entries
}

/** Attendees per event, in query order; emails only for event managers. */
export function attendeesByEvent(
  rows: readonly AttendeeRow[],
  canManageEvents: boolean,
): ReadonlyMap<string, readonly WorkCalendarEventAttendee[]> {
  const byEvent = new Map<string, WorkCalendarEventAttendee[]>()
  for (const attendee of rows) {
    const list = byEvent.get(attendee.eventId) ?? []
    list.push({
      userId: attendee.userId,
      name: userDisplayName(attendee),
      email: canManageEvents ? attendee.email : "",
    })
    byEvent.set(attendee.eventId, list)
  }
  return byEvent
}

/** The first and last calendar day of an event series, or null when unreadable. */
function seriesDates(event: CalendarEventRow): { readonly start: string; readonly end: string } | null {
  const timedStart = event.startsAt !== null ? new Date(event.startsAt) : null
  const timedEnd = event.endsAt !== null ? new Date(event.endsAt) : null
  const timedEndDisplay =
    timedEnd && !Number.isNaN(timedEnd.getTime()) ? new Date(timedEnd.getTime() - 1) : null
  const start = event.allDay
    ? event.startDate
    : timedStart && !Number.isNaN(timedStart.getTime())
      ? dateKeyInTimeZone(timedStart, event.timeZone)
      : null
  const end = event.allDay
    ? event.endDateExclusive
      ? inclusiveEndDateFromExclusive(event.endDateExclusive)
      : null
    : timedEndDisplay
      ? dateKeyInTimeZone(timedEndDisplay, event.timeZone)
      : null
  return start && end ? { start, end } : null
}

export type CompassEventRows = {
  readonly events: readonly CalendarEventRow[]
  readonly projectById: ReadonlyMap<string, CalendarProjectRow>
  readonly attendeesByEventId: ReadonlyMap<string, readonly WorkCalendarEventAttendee[]>
  readonly linkedEventById: ReadonlyMap<string, LinkedEventRow>
}

/** Compass calendar events, expanded into occurrences within the window. */
export function compassEventEntries(
  viewer: CalendarViewer,
  rows: CompassEventRows,
  range: CalendarRange,
): readonly WorkCalendarEntry[] {
  const entries: WorkCalendarEntry[] = []
  for (const event of rows.events) {
    if (isClosedStatus(event.status)) continue
    const project = event.projectId ? rows.projectById.get(event.projectId) ?? null : null
    const series = seriesDates(event)
    if (!series) continue
    const attendees = rows.attendeesByEventId.get(event.id) ?? []
    const detailLevel = calendarDetailLevel({
      visibility: isWorkCalendarEventVisibility(event.visibility) ? event.visibility : "organization",
      viewerIsOwner: event.createdBy === viewer.userId,
      viewerIsParticipant: attendees.some((attendee) => attendee.userId === viewer.userId),
      viewerHasProjectAccess: event.projectId === null || rows.projectById.has(event.projectId),
      hasProjectScope: event.projectId !== null,
    })
    if (detailLevel === "hidden") continue
    const showDetails = detailLevel === "full"
    const linkedEvent = rows.linkedEventById.get(event.id) ?? null
    const canEditEvent = linkedEvent
      ? viewer.canUseManagedGoogleCalendar &&
        canChangeLinkedGoogleEvent({
          role: viewer.role,
          userId: viewer.userId,
          ownerUserId: linkedEvent.ownerUserId,
          calendarScope: linkedEvent.calendarScope,
          allowedForInternalUsers: linkedEvent.internalCanEdit,
        })
      : viewer.canManageEvents
    const eventType = isWorkCalendarEventType(event.eventType) ? event.eventType : "other"
    const recurrence = isWorkCalendarRecurrence(event.recurrence) ? event.recurrence : "none"
    const occurrences = [
      ...expandWorkCalendarRecurrence({
        startDate: series.start,
        endDate: series.end,
        recurrence,
        recurrenceUntil: event.recurrenceUntil,
        windowStart: range.rangeStart,
        windowEnd: range.rangeEnd,
      }),
    ]
    if (range.today < range.rangeStart || range.today > range.rangeEnd) {
      for (const occurrence of expandWorkCalendarRecurrence({
        startDate: series.start,
        endDate: series.end,
        recurrence,
        recurrenceUntil: event.recurrenceUntil,
        windowStart: range.today,
        windowEnd: range.today,
      })) {
        if (!occurrences.some((candidate) => candidate.startDate === occurrence.startDate)) {
          occurrences.push(occurrence)
        }
      }
    }
    const startTime = event.allDay ? "" : localTimeInZone(event.startsAt, event.timeZone)
    const endTime = event.allDay ? "" : localTimeInZone(event.endsAt, event.timeZone)
    // Event types are validated keys, so the label keeps the original
    // split/map without dropping empty parts.
    const typeLabel = eventType
      .split("_")
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
      .join(" ")

    for (const occurrence of occurrences) {
      const occurrenceId = recurrence === "none" ? event.id : `${event.id}--${occurrence.startDate}`
      const recurrenceLabel = recurrence === "none" ? "" : ` · Repeats ${recurrence}`

      entries.push({
        id: occurrenceId,
        kind: "event",
        projectId: showDetails ? project?.id ?? null : null,
        projectLabel: showDetails ? (project ? projectLabel(project) : "No project") : "Private",
        projectName: showDetails ? project?.name ?? "Archived project" : "Private",
        title: showDetails ? event.title : "Busy",
        status: event.status,
        priority: "normal",
        startDate: occurrence.startDate,
        endDate: occurrence.endDate,
        assignedTo:
          showDetails && attendees.length > 0 ? attendees.map((attendee) => attendee.name).join(", ") : null,
        companyName: null,
        sourceLabel: showDetails ? `${typeLabel}${recurrenceLabel}` : "Private calendar event",
        href: showDetails
          ? `/dashboard/schedule?kind=event&item=${encodeURIComponent(occurrenceId)}#work-calendar-${encodeURIComponent(occurrenceId)}`
          : "/dashboard/schedule",
        eventDetails: {
          // Busy projections must not leak the underlying category or privacy
          // choice through the client payload.
          masterEventId: event.id,
          eventType: showDetails ? eventType : "other",
          visibility: showDetails
            ? isWorkCalendarEventVisibility(event.visibility)
              ? event.visibility
              : "organization"
            : "busy",
          description: showDetails ? event.description : null,
          startDate: series.start,
          endDate: series.end,
          startTime,
          endTime,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          allDay: event.allDay,
          timeZone: event.timeZone,
          location: showDetails ? event.location : null,
          meetingUrl: showDetails ? event.meetingUrl : null,
          recurrence: showDetails ? recurrence : "none",
          recurrenceUntil: showDetails ? event.recurrenceUntil : null,
          attendees: showDetails ? attendees : [],
          version: event.version,
          managed: showDetails && canEditEvent,
        },
      })
    }
  }
  return entries
}

/** Imported personal Google events for the selected people; others see "Busy". */
export function personalGoogleEventEntries(
  viewerUserId: string,
  rows: readonly PersonalGoogleEventRow[],
  peopleFilter: string,
  defaultTimeZone: string,
  range: CalendarRange,
): readonly WorkCalendarEntry[] {
  const entries: WorkCalendarEntry[] = []
  for (const googleEvent of rows) {
    if (googleEvent.status === "cancelled") continue
    const selectedOwner =
      peopleFilter === "all" ||
      (peopleFilter === "me" ? googleEvent.ownerUserId === viewerUserId : googleEvent.ownerUserId === peopleFilter)
    if (!selectedOwner) continue
    const timeZone = googleEvent.timeZone ?? defaultTimeZone
    const startDate = googleEvent.allDay
      ? googleEvent.startDate
      : googleEvent.startsAt
        ? dateKeyInTimeZone(new Date(googleEvent.startsAt), timeZone)
        : null
    const endDate = googleEvent.allDay
      ? googleEvent.endDateExclusive
        ? inclusiveEndDateFromExclusive(googleEvent.endDateExclusive)
        : null
      : googleEvent.endsAt
        ? dateKeyInTimeZone(new Date(new Date(googleEvent.endsAt).getTime() - 1), timeZone)
        : null
    if (
      !startDate ||
      !endDate ||
      !intersectsCalendarWindow(startDate, endDate, range.rangeStart, range.rangeEnd, range.today)
    ) {
      continue
    }
    const fullDetails = googleEvent.ownerUserId === viewerUserId
    const ownerName = userDisplayName({
      displayName: googleEvent.ownerDisplayName,
      firstName: googleEvent.ownerFirstName,
      lastName: googleEvent.ownerLastName,
      email: googleEvent.ownerEmail,
    })
    if (!fullDetails && googleEvent.transparency === "transparent") continue
    const calendarLabel = fullDetails ? googleEvent.calendarName : "Google Calendar"
    entries.push({
      id: `google-${googleEvent.id}`,
      kind: "event",
      projectId: null,
      projectLabel: ownerName,
      projectName: calendarLabel,
      title: fullDetails ? googleEvent.title : "Busy",
      status: "open",
      priority: "normal",
      startDate,
      endDate,
      assignedTo: ownerName,
      companyName: null,
      sourceLabel: `${ownerName} · ${calendarLabel}`,
      href: fullDetails && googleEvent.htmlLink ? googleEvent.htmlLink : "/dashboard/schedule",
      eventDetails: {
        masterEventId: `google-${googleEvent.id}`,
        eventType: fullDetails && googleEvent.meetingUrl ? "meeting" : "other",
        visibility: fullDetails ? "private" : "busy",
        description: fullDetails ? googleEvent.description : null,
        startDate,
        endDate,
        startTime: googleEvent.allDay ? "" : localTimeInZone(googleEvent.startsAt, timeZone),
        endTime: googleEvent.allDay ? "" : localTimeInZone(googleEvent.endsAt, timeZone),
        startsAt: googleEvent.startsAt,
        endsAt: googleEvent.endsAt,
        allDay: googleEvent.allDay,
        timeZone,
        location: fullDetails ? googleEvent.location : null,
        meetingUrl: fullDetails ? googleEvent.meetingUrl : null,
        recurrence: "none",
        recurrenceUntil: null,
        attendees: [],
        version: 0,
        managed: false,
      },
    })
  }
  return entries
}

/** By start date, then project label, then title. */
export function sortCalendarEntries(entries: readonly WorkCalendarEntry[]): readonly WorkCalendarEntry[] {
  return [...entries].sort((left, right) => {
    const byDate = left.startDate.localeCompare(right.startDate)
    if (byDate !== 0) return byDate
    const byProject = left.projectLabel.localeCompare(right.projectLabel)
    if (byProject !== 0) return byProject
    return left.title.localeCompare(right.title)
  })
}
