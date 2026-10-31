/**
 * Validates a calendar event mutation against the organization's projects,
 * members and Google destinations. Messages are shown to the user as is.
 */
import { canWriteGoogleCalendar } from "@/lib/google/calendar/policy"
import type { Db } from "@/lib/server/action-context"

import {
  loadActiveMemberAttendees,
  loadCalendarSettings,
  loadGoogleDestination,
  loadOrganizationProjects,
} from "./loaders"
import { normalizedAttendeeIds, resolveEventProject, validateEventFields } from "./rules"
import { saveDefaultCalendarProject } from "./store"
import type { ValidatedEventInput, WorkCalendarEventAttendee, WorkCalendarEventMutationInput } from "./types"

async function validateAttendees(
  db: Db,
  organizationId: string,
  attendeeUserIds: readonly string[],
): Promise<readonly WorkCalendarEventAttendee[]> {
  const normalizedIds = normalizedAttendeeIds(attendeeUserIds)
  if (normalizedIds.length === 0) return []
  const attendees = await loadActiveMemberAttendees(db, organizationId, normalizedIds)
  if (attendees.length !== normalizedIds.length) {
    throw new Error("One or more attendees are not active members of this organization")
  }
  return attendees
}

/**
 * Throws with the user-facing message on invalid input. When no project is
 * given and the organization's single H-Office project is inferred, it is
 * saved as the calendar default (before the field checks, as before).
 */
export async function validateEventInput(
  db: Db,
  organizationId: string,
  input: WorkCalendarEventMutationInput,
): Promise<ValidatedEventInput> {
  const projectRows = await loadOrganizationProjects(db, organizationId)
  const settings = await loadCalendarSettings(db, organizationId)
  const resolved = resolveEventProject(input, projectRows, settings?.defaultProjectId)
  if (resolved.rememberAsDefault) {
    await saveDefaultCalendarProject(db, {
      organizationId,
      projectId: resolved.project.id,
      now: new Date().toISOString(),
    })
  }
  const fields = validateEventFields(input)
  return {
    project: resolved.project,
    ...fields,
    attendees: await validateAttendees(db, organizationId, input.attendeeUserIds),
  }
}

export type GoogleCalendarDestinationChoice = {
  readonly selectionId: string
  readonly calendarScope: string
  readonly internalVisibility: string
}

/** The chosen Google destination, or null when none was chosen; throws when unusable. */
export async function validateGoogleCalendarDestination(input: {
  readonly db: Db
  readonly organizationId: string
  readonly userId: string
  readonly selectionId: string | null
}): Promise<GoogleCalendarDestinationChoice | null> {
  const selectionId = input.selectionId?.trim() ?? ""
  if (!selectionId) return null
  const destination = await loadGoogleDestination(input.db, input.organizationId, selectionId)
  if (
    !destination ||
    !destination.selected ||
    !destination.exportCompassEvents ||
    !destination.isCompassDestination ||
    !canWriteGoogleCalendar(destination.accessRole)
  ) {
    throw new Error("The selected Google Calendar destination is unavailable.")
  }
  const canCreate =
    destination.calendarScope === "organization"
      ? destination.internalCanCreate
      : destination.ownerUserId === input.userId
  if (!canCreate) {
    throw new Error("You cannot create events in this Google calendar.")
  }
  return {
    selectionId: destination.id,
    calendarScope: destination.calendarScope,
    internalVisibility: destination.internalVisibility,
  }
}
