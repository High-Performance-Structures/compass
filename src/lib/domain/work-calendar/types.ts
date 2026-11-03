import type {
  WorkCalendarEventType,
  WorkCalendarEventVisibility,
} from "@/lib/work-calendar"
import type { WorkCalendarRecurrence } from "@/lib/work-calendar-recurrence"

/** The work calendar's read model and inputs (src/app/actions/work-calendar.ts). */

export type WorkCalendarEntryKind =
  | "schedule"
  | "event"
  | "rfi"
  | "purchase_order"
  | "task"

type WorkCalendarEntryBase = {
  readonly id: string
  readonly projectId: string | null
  readonly projectLabel: string
  readonly projectName: string
  readonly title: string
  readonly status: string
  readonly priority: string
  readonly startDate: string
  readonly endDate: string
  readonly assignedTo: string | null
  readonly companyName: string | null
  readonly sourceLabel: string
  readonly href: string
}

export type WorkCalendarEventAttendee = {
  readonly userId: string
  readonly name: string
  readonly email: string
}

type WorkCalendarEventDetails = {
  readonly masterEventId: string
  readonly eventType: WorkCalendarEventType
  readonly visibility: WorkCalendarEventVisibility
  readonly description: string | null
  readonly startDate: string
  readonly endDate: string
  readonly startTime: string
  readonly endTime: string
  readonly startsAt: string | null
  readonly endsAt: string | null
  readonly allDay: boolean
  readonly timeZone: string
  readonly location: string | null
  readonly meetingUrl: string | null
  readonly recurrence: WorkCalendarRecurrence
  readonly recurrenceUntil: string | null
  readonly attendees: readonly WorkCalendarEventAttendee[]
  readonly version: number
  readonly managed: boolean
}

export type NonEventKind = Exclude<WorkCalendarEntryKind, "event">

export type WorkCalendarEntry =
  | (WorkCalendarEntryBase & {
      readonly kind: NonEventKind
      readonly eventDetails: null
    })
  | (WorkCalendarEntryBase & {
      readonly kind: "event"
      readonly eventDetails: WorkCalendarEventDetails
    })

type GoogleCalendarPerson = {
  readonly userId: string
  readonly name: string
}

export type GoogleCalendarDestination = {
  readonly selectionId: string
  readonly label: string
  readonly calendarScope: "personal" | "organization"
}

export type ProjectRow = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
}

export type WorkCalendarData = {
  readonly today: string
  readonly entries: readonly WorkCalendarEntry[]
  readonly projects: readonly ProjectRow[]
  readonly attendeeOptions: readonly WorkCalendarEventAttendee[]
  readonly defaultProjectId: string | null
  readonly defaultTimeZone: string
  readonly canCreateEvents: boolean
  readonly canCreateTodos: boolean
  readonly canManageEvents: boolean
  readonly googlePeople: readonly GoogleCalendarPerson[]
  readonly activeGooglePeopleFilter: string
  readonly googleDestinations: readonly GoogleCalendarDestination[]
}

export type WorkCalendarEventMutationInput = {
  readonly title: string
  readonly eventType: WorkCalendarEventType
  readonly visibility: WorkCalendarEventVisibility
  readonly description: string | null
  readonly projectId: string | null
  readonly allDay: boolean
  readonly startDate: string
  readonly endDate: string
  readonly startTime: string
  readonly endTime: string
  readonly startsAt: string | null
  readonly endsAt: string | null
  readonly timeZone: string
  readonly location: string | null
  readonly meetingUrl: string | null
  readonly createGoogleMeet: boolean
  readonly recurrence: WorkCalendarRecurrence
  readonly recurrenceUntil: string | null
  readonly attendeeUserIds: readonly string[]
  readonly calendarSelectionId: string | null
}

export type ValidatedEventInput = {
  readonly project: ProjectRow
  readonly title: string
  readonly eventType: WorkCalendarEventType
  readonly visibility: WorkCalendarEventVisibility
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
  readonly recurrence: WorkCalendarRecurrence
  readonly recurrenceUntil: string | null
  readonly attendees: readonly WorkCalendarEventAttendee[]
}

// ---- Rows the loaders return and the assembler consumes

export type PersonNameRow = {
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
  readonly email: string
}

/** A calendar project; the two extra fields also reach the client as before. */
export type CalendarProjectRow = ProjectRow & {
  readonly schedulePublished: boolean
  readonly ownerScheduleView: string
}

export type DestinationRow = {
  readonly selectionId: string
  readonly summary: string
  readonly calendarScope: string
  readonly accessRole: string
  readonly ownerUserId: string
  readonly internalCanCreate: boolean
}

export type WorkingTaskRow = {
  readonly projectId: string
  readonly id: string
  readonly title: string
  readonly status: string
  readonly startDate: string
  readonly endDate: string
  readonly assignedTo: string | null
  readonly isCriticalPath: boolean
}

export type RfiRow = {
  readonly projectId: string
  readonly id: string
  readonly rfiNumber: string
  readonly subject: string
  readonly status: string
  readonly priority: string
  readonly dueDate: string | null
  readonly assignedToName: string | null
  readonly companyName: string | null
}

export type OperationRow = {
  readonly projectId: string
  readonly id: string
  readonly sourceRecordType: string
  readonly sourceRecordId: string | null
  readonly sourceRecordNumber: string | null
  readonly title: string
  readonly status: string
  readonly priority: string
  readonly assigneeName: string | null
  readonly companyName: string | null
  readonly startDate: string | null
  readonly dueDate: string | null
}

export type CalendarEventRow = {
  readonly id: string
  readonly projectId: string | null
  readonly title: string
  readonly eventType: string
  readonly visibility: string
  readonly description: string | null
  readonly startDate: string | null
  readonly endDateExclusive: string | null
  readonly startsAt: string | null
  readonly endsAt: string | null
  readonly allDay: boolean
  readonly timeZone: string
  readonly location: string | null
  readonly meetingUrl: string | null
  readonly recurrence: string
  readonly recurrenceUntil: string | null
  readonly status: string
  readonly version: number
  readonly createdBy: string | null
}

export type LinkedEventRow = {
  readonly eventId: string
  readonly ownerUserId: string
  readonly calendarScope: string
  readonly internalCanEdit: boolean
}

export type AttendeeRow = PersonNameRow & {
  readonly eventId: string
  readonly userId: string
}

export type PersonalGoogleEventRow = {
  readonly id: string
  readonly ownerUserId: string
  readonly ownerEmail: string
  readonly ownerDisplayName: string | null
  readonly ownerFirstName: string | null
  readonly ownerLastName: string | null
  readonly calendarName: string
  readonly title: string
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
  readonly visibility: string | null
  readonly transparency: string | null
  readonly status: string
}
