"use server"

import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import {
  attendeesByEvent,
  compassEventEntries,
  personalGoogleEventEntries,
  projectAudience,
  projectSourceEntries,
  sortCalendarEntries,
  type CalendarRange,
  type CalendarViewer,
} from "@/lib/domain/work-calendar/assemble"
import { validateEventInput, validateGoogleCalendarDestination } from "@/lib/domain/work-calendar/event-input"
import {
  loadActiveOrganizationPeople,
  loadCalendarEvents,
  loadCalendarProjects,
  loadCalendarSettings,
  loadConnectedGooglePeople,
  loadEventAttendeeRows,
  loadEventAttendees,
  loadEventForEdit,
  loadGoogleDestinations,
  loadLatestPublicationSnapshots,
  loadLinkedGoogleCalendarPermissions,
  loadLinkedGoogleEvents,
  loadOrganizationProject,
  loadPersonalGoogleEvents,
  loadProjectRoles,
  loadProjectSources,
} from "@/lib/domain/work-calendar/loaders"
import { notifyEventParticipants } from "@/lib/domain/work-calendar/notify"
import {
  calendarWindow,
  canChangeLinkedGoogleEvent,
  configuredDefaultProject,
  eventStartLabel,
  isClosedStatus,
  userDisplayName,
  writableGoogleDestinations,
} from "@/lib/domain/work-calendar/rules"
import {
  cancelOpenWorkCalendarEvent,
  insertWorkCalendarEvent,
  syncEventAttendees,
  updateOpenWorkCalendarEvent,
} from "@/lib/domain/work-calendar/store"
import type {
  WorkCalendarData,
  WorkCalendarEventAttendee,
  WorkCalendarEventMutationInput,
} from "@/lib/domain/work-calendar/types"
import { activeGoogleProjectCalendarSelectionId } from "@/lib/google/calendar/project-routing"
import {
  deleteLinkedWorkCalendarEventFromGoogle,
  publishWorkCalendarEventToGoogle,
} from "@/lib/google/calendar/sync"
import { requireOrg } from "@/lib/org-scope"
import { canFeature } from "@/lib/permission-enforcement"
import { can, canManageWorkCalendarEvents, requirePermission } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"
import { dateKeyInTimeZone, isValidDateKey, resolveHOfficeProjectId, type WorkCalendarEventVisibility } from "@/lib/work-calendar"

type WorkCalendarEventMutationResult =
  | { readonly success: true; readonly id: string; readonly warning?: string }
  | { readonly success: false; readonly error: string }

/*
 * These actions keep their own checks (requireAuth, the static
 * requirePermission role check, requireOrg, then the demo account) in their
 * original order, so failures and messages are unchanged. The shared
 * orgContext checks the organization first, uses feature overrides and also
 * blocks the demo organization, so it does not fit exactly. Only the
 * database handle is resolved here.
 */
async function calendarDatabase(): Promise<{ readonly db: ReturnType<typeof getDb>; readonly env: CloudflareEnv }> {
  const { env } = await getCloudflareContext()
  return { db: getDb(env.DB), env }
}

function canUseManagedGoogleCalendarRole(role: string): boolean {
  return isInternalStaffRole(role) || role === "developer"
}

export async function getWorkCalendar(
  referenceDate?: string,
  options?: {
    readonly eventsOnly?: boolean
    readonly googlePeople?: string
  },
): Promise<WorkCalendarData> {
  const user = await requireAuth()
  requirePermission(user, "schedule", "read")
  const orgId = requireOrg(user)
  const canManageEvents = !isDemoUser(user.id) && canManageWorkCalendarEvents(user)
  const canCreateCompassEvents = canManageEvents && can(user, "schedule", "create")
  const canUseManagedGoogleCalendar = canUseManagedGoogleCalendarRole(user.role)
  const canViewWorkingSchedule = canUseManagedGoogleCalendar
  const canCreateTodos = !isDemoUser(user.id) && (await canFeature(user, "tasks", "update"))

  const { db } = await calendarDatabase()
  const calendarSettings = await loadCalendarSettings(db, orgId)
  const defaultTimeZone = calendarSettings?.timeZone ?? "America/Denver"
  const today = dateKeyInTimeZone(new Date(), defaultTimeZone)
  const calendarDate = referenceDate && isValidDateKey(referenceDate) ? referenceDate : today
  const range: CalendarRange = { today, ...calendarWindow(calendarDate) }

  const projectRows = await loadCalendarProjects(db, {
    organizationId: orgId,
    userId: user.id,
    allCompanyProjects: user.organizationType === "internal" && isInternalStaffRole(user.role),
  })
  const projectRoles: ReadonlyMap<string, string> = canViewWorkingSchedule
    ? new Map()
    : await loadProjectRoles(db, user.id)
  const projectById = new Map(projectRows.map((project) => [project.id, project]))
  const defaultProjectId =
    configuredDefaultProject(calendarSettings?.defaultProjectId, projectRows) ?? resolveHOfficeProjectId(projectRows)

  const [organizationUsers, connectedPeopleRows, destinationRows, eventRows] = await Promise.all([
    canManageEvents || canUseManagedGoogleCalendar ? loadActiveOrganizationPeople(db, orgId) : Promise.resolve([]),
    canUseManagedGoogleCalendar ? loadConnectedGooglePeople(db, orgId) : Promise.resolve([]),
    canUseManagedGoogleCalendar ? loadGoogleDestinations(db, orgId) : Promise.resolve([]),
    loadCalendarEvents(db, orgId),
  ])
  const attendeeOptions = organizationUsers.map((member) => ({
    userId: member.id,
    name: userDisplayName(member),
    email: member.email,
  }))
  const googlePeople = connectedPeopleRows.map((member) => ({
    userId: member.userId,
    name: userDisplayName(member),
  }))
  const requestedPeopleFilter = options?.googlePeople ?? "me"
  const activeGooglePeopleFilter =
    requestedPeopleFilter === "all" ||
    requestedPeopleFilter === "me" ||
    googlePeople.some((person) => person.userId === requestedPeopleFilter)
      ? requestedPeopleFilter
      : "me"
  const googleDestinations = writableGoogleDestinations(destinationRows, user.id)
  const canCreateEvents =
    canCreateCompassEvents || (!isDemoUser(user.id) && canUseManagedGoogleCalendar && googleDestinations.length > 0)

  const viewer: CalendarViewer = {
    userId: user.id,
    role: user.role,
    canManageEvents,
    canUseManagedGoogleCalendar,
    canViewWorkingSchedule,
  }
  const sourceProjects = options?.eventsOnly ? [] : projectRows
  // Each source is loaded once for the whole organization.
  const sources =
    sourceProjects.length > 0
      ? await loadProjectSources(db, orgId, canViewWorkingSchedule)
      : { workingTasks: [], rfis: [], operations: [] }
  const publishedSnapshots = canViewWorkingSchedule
    ? new Map<string, string | null>()
    : await loadLatestPublicationSnapshots(
        db,
        sourceProjects
          .filter((project) => project.schedulePublished && projectAudience(projectRoles.get(project.id)) !== null)
          .map((project) => project.id),
      )
  const eventIds = eventRows.map((event) => event.id)
  const [linkedEventRows, attendeeRows, personalGoogleEvents] = await Promise.all([
    loadLinkedGoogleEvents(db, orgId, eventIds),
    loadEventAttendeeRows(db, eventIds),
    canUseManagedGoogleCalendar ? loadPersonalGoogleEvents(db, orgId) : Promise.resolve([]),
  ])

  const entries = sortCalendarEntries([
    ...projectSourceEntries(
      viewer,
      {
        projects: sourceProjects,
        projectRoles,
        publishedSnapshots,
        ...sources,
        dedicatedEventIds: new Set(eventIds),
      },
      range,
    ),
    ...compassEventEntries(
      viewer,
      {
        events: eventRows,
        projectById,
        attendeesByEventId: attendeesByEvent(attendeeRows, canManageEvents),
        linkedEventById: new Map(linkedEventRows.map((link) => [link.eventId, link])),
      },
      range,
    ),
    ...personalGoogleEventEntries(user.id, personalGoogleEvents, activeGooglePeopleFilter, defaultTimeZone, range),
  ])

  return {
    today,
    entries,
    projects: projectRows,
    attendeeOptions,
    defaultProjectId,
    defaultTimeZone,
    canCreateEvents,
    canCreateTodos,
    canManageEvents,
    googlePeople,
    activeGooglePeopleFilter,
    googleDestinations,
  }
}

function revalidateEventPaths(projectIds: readonly (string | null)[]): void {
  revalidatePath("/dashboard/schedule")
  revalidatePath("/dashboard")
  const concreteProjectIds = projectIds.filter((projectId): projectId is string => projectId !== null)
  for (const projectId of new Set(concreteProjectIds)) {
    revalidatePath(`/dashboard/projects/${projectId}`)
  }
}

const STALE_EVENT = "This event changed after you opened it. Refresh and try again."

function isExpectedVersion(expectedVersion: number, currentVersion: number): boolean {
  return Number.isInteger(expectedVersion) && expectedVersion >= 1 && currentVersion === expectedVersion
}

export async function createWorkCalendarEvent(
  input: WorkCalendarEventMutationInput,
): Promise<WorkCalendarEventMutationResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "read")
    const orgId = requireOrg(user)
    const { db, env } = await calendarDatabase()
    const calendarDestination = await validateGoogleCalendarDestination({
      db,
      organizationId: orgId,
      userId: user.id,
      selectionId: input.calendarSelectionId,
    })
    const canCreateCompassEvent = canManageWorkCalendarEvents(user) && can(user, "schedule", "create")
    const canCreateManagedGoogleEvent =
      calendarDestination !== null && canUseManagedGoogleCalendarRole(user.role)
    if (!canCreateCompassEvent && !canCreateManagedGoogleEvent) {
      return { success: false, error: "Permission denied" }
    }
    const validated = await validateEventInput(db, orgId, input)
    const projectCalendarSelectionId = calendarDestination
      ? null
      : await activeGoogleProjectCalendarSelectionId(db, orgId, validated.project.id)
    const organizationCalendar = calendarDestination?.calendarScope === "organization"
    const targetProject = organizationCalendar ? null : validated.project
    const targetVisibility: WorkCalendarEventVisibility = organizationCalendar
      ? calendarDestination.internalVisibility === "details"
        ? "organization"
        : "busy"
      : validated.visibility
    const publishSelectionId = calendarDestination?.selectionId ?? projectCalendarSelectionId
    if (validated.createGoogleMeet && !publishSelectionId) {
      return {
        success: false,
        error:
          "Select a writable Google Calendar or enable the project's Google Calendar before adding Google Meet.",
      }
    }
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await insertWorkCalendarEvent(db, {
      id,
      organizationId: orgId,
      projectId: targetProject?.id ?? null,
      title: validated.title,
      eventType: validated.eventType,
      visibility: targetVisibility,
      description: validated.description,
      startDate: validated.startDate,
      endDateExclusive: validated.endDateExclusive,
      startsAt: validated.startsAt,
      endsAt: validated.endsAt,
      allDay: validated.allDay,
      timeZone: validated.timeZone,
      location: validated.location,
      meetingUrl: validated.meetingUrl,
      recurrence: validated.recurrence,
      recurrenceUntil: validated.recurrenceUntil,
      status: "open",
      version: 1,
      createdBy: user.id,
      updatedBy: user.id,
      cancelledBy: null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    })
    await syncEventAttendees(db, { eventId: id, previous: [], next: validated.attendees, now })
    let warning: string | undefined
    if (publishSelectionId) {
      try {
        const published = await publishWorkCalendarEventToGoogle(db, env, id, publishSelectionId, {
          createGoogleMeet: validated.createGoogleMeet,
        })
        if (validated.createGoogleMeet && !published.meetingUrl) {
          warning =
            published.conferenceStatus === "failure"
              ? "Event saved, but Google Calendar could not create the Meet link. Edit the event and try Add Google Meet again."
              : "Event saved and Google Meet creation is still processing. Sync the Google Calendar shortly to retrieve the link."
        }
      } catch (error) {
        warning =
          error instanceof Error
            ? `Saved in Compass, but Google Calendar did not update: ${error.message}`
            : "Saved in Compass, but Google Calendar did not update."
      }
    }
    await notifyEventParticipants({
      organizationId: orgId,
      projectId: targetProject?.id ?? null,
      project: targetProject,
      eventId: id,
      eventTitle: validated.title,
      startLabel: eventStartLabel(validated),
      change: "created",
      actorId: user.id,
      actorName: user.displayName ?? user.email,
      attendees: validated.attendees,
    })

    revalidateEventPaths([targetProject?.id ?? null])
    return { success: true, id, warning }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create calendar event",
    }
  }
}

export async function updateWorkCalendarEvent(
  eventId: string,
  expectedVersion: number,
  input: WorkCalendarEventMutationInput,
): Promise<WorkCalendarEventMutationResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const canManageCompassEvent = canManageWorkCalendarEvents(user)
    const canUseManagedGoogleCalendar = canUseManagedGoogleCalendarRole(user.role)
    const orgId = requireOrg(user)
    const { db, env } = await calendarDatabase()

    const googleLink = await loadLinkedGoogleCalendarPermissions(db, orgId, eventId)
    if (!canManageCompassEvent && (!googleLink || !canUseManagedGoogleCalendar)) {
      return { success: false, error: "Permission denied" }
    }
    if (
      googleLink &&
      !canChangeLinkedGoogleEvent({
        role: user.role,
        userId: user.id,
        ownerUserId: googleLink.ownerUserId,
        calendarScope: googleLink.calendarScope,
        allowedForInternalUsers: googleLink.internalCanEdit,
      })
    ) {
      return { success: false, error: "You cannot edit events in this Google calendar." }
    }

    const existing = await loadEventForEdit(db, orgId, eventId)
    if (!existing) {
      return { success: false, error: "Calendar event not found" }
    }
    if (isClosedStatus(existing.status)) {
      return { success: false, error: "Cancelled events cannot be edited." }
    }
    if (!isExpectedVersion(expectedVersion, existing.version)) {
      return { success: false, error: STALE_EVENT }
    }

    const previousAttendees = await loadEventAttendees(db, eventId)
    const validated = await validateEventInput(db, orgId, input)
    const organizationCalendar = googleLink?.calendarScope === "organization"
    const targetProject = organizationCalendar ? null : validated.project
    const targetVisibility: WorkCalendarEventVisibility = organizationCalendar
      ? googleLink?.internalVisibility === "details"
        ? "organization"
        : "busy"
      : validated.visibility
    const projectCalendarSelectionId = googleLink
      ? null
      : await activeGoogleProjectCalendarSelectionId(db, orgId, targetProject?.id ?? null)
    const publishSelectionId = googleLink?.selectionId ?? projectCalendarSelectionId
    if (validated.createGoogleMeet && !publishSelectionId) {
      return {
        success: false,
        error: "This event must be linked to a writable Google Calendar before adding Google Meet.",
      }
    }
    const now = new Date().toISOString()
    const updated = await updateOpenWorkCalendarEvent(
      db,
      { eventId, organizationId: orgId, expectedVersion },
      {
        projectId: targetProject?.id ?? null,
        title: validated.title,
        eventType: validated.eventType,
        visibility: targetVisibility,
        description: validated.description,
        startDate: validated.startDate,
        endDateExclusive: validated.endDateExclusive,
        startsAt: validated.startsAt,
        endsAt: validated.endsAt,
        allDay: validated.allDay,
        timeZone: validated.timeZone,
        location: validated.location,
        meetingUrl: validated.meetingUrl,
        recurrence: validated.recurrence,
        recurrenceUntil: validated.recurrenceUntil,
        version: expectedVersion + 1,
        updatedBy: user.id,
        updatedAt: now,
      },
    )
    if (!updated) {
      return { success: false, error: STALE_EVENT }
    }
    await syncEventAttendees(db, { eventId, previous: previousAttendees, next: validated.attendees, now })
    let warning: string | undefined
    if (publishSelectionId) {
      try {
        const published = await publishWorkCalendarEventToGoogle(db, env, eventId, publishSelectionId, {
          createGoogleMeet: validated.createGoogleMeet,
        })
        if (validated.createGoogleMeet && !published.meetingUrl) {
          warning =
            published.conferenceStatus === "failure"
              ? "Event updated, but Google Calendar could not create the Meet link. Edit the event and try Add Google Meet again."
              : "Event updated and Google Meet creation is still processing. Sync the Google Calendar shortly to retrieve the link."
        }
      } catch (error) {
        warning =
          error instanceof Error
            ? `Updated in Compass, but Google Calendar did not update: ${error.message}`
            : "Updated in Compass, but Google Calendar did not update."
      }
    }

    const notificationAttendees = new Map<string, WorkCalendarEventAttendee>()
    for (const attendee of [...previousAttendees, ...validated.attendees]) {
      notificationAttendees.set(attendee.userId, attendee)
    }
    await notifyEventParticipants({
      organizationId: orgId,
      projectId: targetProject?.id ?? null,
      project: targetProject,
      eventId,
      eventTitle: validated.title,
      startLabel: eventStartLabel(validated),
      change: "updated",
      actorId: user.id,
      actorName: user.displayName ?? user.email,
      attendees: Array.from(notificationAttendees.values()),
    })

    revalidateEventPaths([existing.projectId, targetProject?.id ?? null])
    return { success: true, id: eventId, warning }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update calendar event",
    }
  }
}

export async function cancelWorkCalendarEvent(
  eventId: string,
  expectedVersion: number,
): Promise<WorkCalendarEventMutationResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const canManageCompassEvent = canManageWorkCalendarEvents(user)
    const canUseManagedGoogleCalendar = canUseManagedGoogleCalendarRole(user.role)
    const orgId = requireOrg(user)
    const { db, env } = await calendarDatabase()

    const googleLink = await loadLinkedGoogleCalendarPermissions(db, orgId, eventId)
    if (!canManageCompassEvent && (!googleLink || !canUseManagedGoogleCalendar)) {
      return { success: false, error: "Permission denied" }
    }
    if (
      googleLink &&
      !canChangeLinkedGoogleEvent({
        role: user.role,
        userId: user.id,
        ownerUserId: googleLink.ownerUserId,
        calendarScope: googleLink.calendarScope,
        allowedForInternalUsers: googleLink.internalCanDelete,
      })
    ) {
      return { success: false, error: "You cannot delete events from this Google calendar." }
    }

    const existing = await loadEventForEdit(db, orgId, eventId)
    if (!existing) {
      return { success: false, error: "Calendar event not found" }
    }
    if (isClosedStatus(existing.status)) {
      return { success: true, id: eventId }
    }
    if (!isExpectedVersion(expectedVersion, existing.version)) {
      return { success: false, error: STALE_EVENT }
    }

    const attendees = await loadEventAttendees(db, eventId)
    const project = existing.projectId ? await loadOrganizationProject(db, orgId, existing.projectId) : null
    const now = new Date().toISOString()
    const cancelled = await cancelOpenWorkCalendarEvent(db, {
      eventId,
      organizationId: orgId,
      expectedVersion,
      userId: user.id,
      now,
    })
    if (!cancelled) {
      return { success: false, error: STALE_EVENT }
    }
    let warning: string | undefined
    if (googleLink) {
      try {
        await deleteLinkedWorkCalendarEventFromGoogle(db, env, eventId)
      } catch (error) {
        warning =
          error instanceof Error
            ? `Cancelled in Compass, but Google Calendar did not update: ${error.message}`
            : "Cancelled in Compass, but Google Calendar did not update."
      }
    }
    await notifyEventParticipants({
      organizationId: orgId,
      projectId: existing.projectId,
      project,
      eventId,
      eventTitle: existing.title,
      startLabel: eventStartLabel(existing),
      change: "cancelled",
      actorId: user.id,
      actorName: user.displayName ?? user.email,
      attendees,
    })

    revalidateEventPaths([existing.projectId])
    return { success: true, id: eventId, warning }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to cancel calendar event",
    }
  }
}
