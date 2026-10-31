/**
 * Work-calendar reads. Every query is scoped to the organization (or to the
 * viewer's own memberships) in SQL; id lists are chunked for D1.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm"

import {
  googleCalendarConnections,
  googleCalendarEntityLinks,
  googleCalendarEvents,
  googleCalendarSelections,
  organizationCalendarSettings,
  organizationMembers,
  projectMembers,
  projectOperations,
  projectRfis,
  projects,
  schedulePublications,
  scheduleTasks,
  users,
  workCalendarEventAttendees,
  workCalendarEvents,
} from "@/db/schema"
import { chunkD1Values } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

import { attendeeFromRow } from "./rules"
import type {
  AttendeeRow,
  CalendarEventRow,
  CalendarProjectRow,
  DestinationRow,
  LinkedEventRow,
  OperationRow,
  PersonalGoogleEventRow,
  ProjectRow,
  RfiRow,
  WorkCalendarEventAttendee,
  WorkingTaskRow,
} from "./types"

type PersonRow = {
  readonly id: string
  readonly email: string
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
}

export async function loadCalendarSettings(
  db: Db,
  organizationId: string,
): Promise<{ readonly defaultProjectId: string | null; readonly timeZone: string } | null> {
  return db
    .select({
      defaultProjectId: organizationCalendarSettings.defaultProjectId,
      timeZone: organizationCalendarSettings.timeZone,
    })
    .from(organizationCalendarSettings)
    .where(eq(organizationCalendarSettings.organizationId, organizationId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

const calendarProjectColumns = {
  id: projects.id,
  name: projects.name,
  projectNumber: projects.projectNumber,
  schedulePublished: projects.schedulePublished,
  ownerScheduleView: projects.ownerScheduleView,
}

/** Staff see every company project; everyone else sees their memberships. */
export async function loadCalendarProjects(
  db: Db,
  input: { readonly organizationId: string; readonly userId: string; readonly allCompanyProjects: boolean },
): Promise<readonly CalendarProjectRow[]> {
  if (input.allCompanyProjects) {
    return db
      .select(calendarProjectColumns)
      .from(projects)
      .where(eq(projects.organizationId, input.organizationId))
      .orderBy(asc(projects.projectNumber), asc(projects.name))
  }
  return db
    .select(calendarProjectColumns)
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(projectMembers.userId, input.userId), eq(projects.organizationId, input.organizationId)))
    .orderBy(asc(projects.projectNumber), asc(projects.name))
}

/** The viewer's role on each project they belong to. */
export async function loadProjectRoles(db: Db, userId: string): Promise<ReadonlyMap<string, string>> {
  const memberships = await db
    .select({ projectId: projectMembers.projectId, role: projectMembers.role })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId))
  const roles = new Map<string, string>()
  for (const membership of memberships) roles.set(membership.projectId, membership.role)
  return roles
}

export async function loadActiveOrganizationPeople(db: Db, organizationId: string): Promise<readonly PersonRow[]> {
  return db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(users.isActive, true)))
    .orderBy(asc(users.displayName), asc(users.email))
}

export async function loadConnectedGooglePeople(
  db: Db,
  organizationId: string,
): Promise<readonly (Omit<PersonRow, "id"> & { readonly userId: string })[]> {
  return db
    .select({
      userId: googleCalendarConnections.userId,
      email: users.email,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(googleCalendarConnections)
    .innerJoin(users, eq(users.id, googleCalendarConnections.userId))
    .where(
      and(
        eq(googleCalendarConnections.organizationId, organizationId),
        eq(googleCalendarConnections.status, "connected"),
        eq(users.isActive, true),
      ),
    )
    .orderBy(asc(users.displayName), asc(users.email))
}

export async function loadGoogleDestinations(db: Db, organizationId: string): Promise<readonly DestinationRow[]> {
  return db
    .select({
      selectionId: googleCalendarSelections.id,
      summary: googleCalendarSelections.summary,
      calendarScope: googleCalendarSelections.calendarScope,
      accessRole: googleCalendarSelections.accessRole,
      ownerUserId: googleCalendarConnections.userId,
      internalCanCreate: googleCalendarSelections.internalCanCreate,
    })
    .from(googleCalendarSelections)
    .innerJoin(googleCalendarConnections, eq(googleCalendarConnections.id, googleCalendarSelections.connectionId))
    .where(
      and(
        eq(googleCalendarConnections.organizationId, organizationId),
        eq(googleCalendarSelections.selected, true),
        eq(googleCalendarSelections.exportCompassEvents, true),
        eq(googleCalendarSelections.isCompassDestination, true),
      ),
    )
}

/**
 * Schedule tasks, RFIs and to-dos for the whole organization, loaded once and
 * grouped by project later (querying per project made the calendar wait on
 * thousands of sequential round trips).
 */
export async function loadProjectSources(
  db: Db,
  organizationId: string,
  includeWorkingSchedule: boolean,
): Promise<{
  readonly workingTasks: readonly WorkingTaskRow[]
  readonly rfis: readonly RfiRow[]
  readonly operations: readonly OperationRow[]
}> {
  const [workingTasks, rfis, operations] = await Promise.all([
    includeWorkingSchedule
      ? db
          .select({
            projectId: scheduleTasks.projectId,
            id: scheduleTasks.id,
            title: scheduleTasks.title,
            status: scheduleTasks.status,
            startDate: scheduleTasks.startDate,
            endDate: scheduleTasks.endDateCalculated,
            assignedTo: scheduleTasks.assignedTo,
            isCriticalPath: scheduleTasks.isCriticalPath,
          })
          .from(scheduleTasks)
          .innerJoin(projects, eq(projects.id, scheduleTasks.projectId))
          .where(eq(projects.organizationId, organizationId))
          .orderBy(asc(scheduleTasks.startDate), asc(scheduleTasks.sortOrder))
      : Promise.resolve([]),
    db
      .select({
        projectId: projectRfis.projectId,
        id: projectRfis.id,
        rfiNumber: projectRfis.rfiNumber,
        subject: projectRfis.subject,
        status: projectRfis.status,
        priority: projectRfis.priority,
        dueDate: projectRfis.dueDate,
        assignedToName: projectRfis.assignedToName,
        companyName: projectRfis.companyName,
      })
      .from(projectRfis)
      .innerJoin(projects, eq(projects.id, projectRfis.projectId))
      .where(eq(projects.organizationId, organizationId))
      .orderBy(asc(projectRfis.dueDate), asc(projectRfis.rfiNumber)),
    db
      .select({
        projectId: projectOperations.projectId,
        id: projectOperations.id,
        sourceRecordType: projectOperations.sourceRecordType,
        sourceRecordId: projectOperations.sourceRecordId,
        sourceRecordNumber: projectOperations.sourceRecordNumber,
        title: projectOperations.title,
        status: projectOperations.status,
        priority: projectOperations.priority,
        assigneeName: projectOperations.assigneeName,
        companyName: projectOperations.companyName,
        startDate: projectOperations.startDate,
        dueDate: projectOperations.dueDate,
      })
      .from(projectOperations)
      .innerJoin(projects, eq(projects.id, projectOperations.projectId))
      .where(eq(projects.organizationId, organizationId))
      .orderBy(asc(projectOperations.dueDate), asc(projectOperations.title)),
  ])
  return { workingTasks, rfis, operations }
}

/**
 * The latest schedule publication of each project, read in parallel (one
 * small indexed lookup per project instead of loading every snapshot).
 */
export async function loadLatestPublicationSnapshots(
  db: Db,
  projectIds: readonly string[],
): Promise<ReadonlyMap<string, string | null>> {
  const rows = await Promise.all(
    projectIds.map((projectId) =>
      db
        .select({ snapshotData: schedulePublications.snapshotData })
        .from(schedulePublications)
        .where(eq(schedulePublications.projectId, projectId))
        .orderBy(desc(schedulePublications.publishedAt))
        .limit(1)
        .then((found) => [projectId, found[0]?.snapshotData ?? null] as const),
    ),
  )
  return new Map(rows)
}

export async function loadCalendarEvents(db: Db, organizationId: string): Promise<readonly CalendarEventRow[]> {
  return db
    .select()
    .from(workCalendarEvents)
    .where(eq(workCalendarEvents.organizationId, organizationId))
    .orderBy(asc(workCalendarEvents.startDate), asc(workCalendarEvents.startsAt), asc(workCalendarEvents.title))
}

/** Google links for these Compass events, chunked for D1's parameter limit. */
export async function loadLinkedGoogleEvents(
  db: Db,
  organizationId: string,
  eventIds: readonly string[],
): Promise<readonly LinkedEventRow[]> {
  if (eventIds.length === 0) return []
  const chunks = await Promise.all(
    chunkD1Values(eventIds).map((eventIdChunk) =>
      db
        .select({
          eventId: googleCalendarEntityLinks.sourceId,
          ownerUserId: googleCalendarConnections.userId,
          calendarScope: googleCalendarSelections.calendarScope,
          internalCanEdit: googleCalendarSelections.internalCanEdit,
        })
        .from(googleCalendarEntityLinks)
        .innerJoin(googleCalendarConnections, eq(googleCalendarConnections.id, googleCalendarEntityLinks.connectionId))
        .innerJoin(
          googleCalendarSelections,
          and(
            eq(googleCalendarSelections.connectionId, googleCalendarEntityLinks.connectionId),
            eq(googleCalendarSelections.googleCalendarId, googleCalendarEntityLinks.googleCalendarId),
          ),
        )
        .where(
          and(
            eq(googleCalendarConnections.organizationId, organizationId),
            eq(googleCalendarEntityLinks.sourceType, "work_calendar_event"),
            inArray(googleCalendarEntityLinks.sourceId, eventIdChunk),
          ),
        ),
    ),
  )
  return chunks.flat()
}

export async function loadEventAttendeeRows(db: Db, eventIds: readonly string[]): Promise<readonly AttendeeRow[]> {
  if (eventIds.length === 0) return []
  const chunks = await Promise.all(
    chunkD1Values(eventIds).map((eventIdChunk) =>
      db
        .select({
          eventId: workCalendarEventAttendees.eventId,
          userId: users.id,
          email: users.email,
          displayName: users.displayName,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(workCalendarEventAttendees)
        .innerJoin(users, eq(users.id, workCalendarEventAttendees.userId))
        .where(inArray(workCalendarEventAttendees.eventId, eventIdChunk))
        .orderBy(asc(users.displayName), asc(users.email)),
    ),
  )
  return chunks.flat()
}

export async function loadPersonalGoogleEvents(
  db: Db,
  organizationId: string,
): Promise<readonly PersonalGoogleEventRow[]> {
  return db
    .select({
      id: googleCalendarEvents.id,
      ownerUserId: googleCalendarConnections.userId,
      ownerEmail: users.email,
      ownerDisplayName: users.displayName,
      ownerFirstName: users.firstName,
      ownerLastName: users.lastName,
      calendarName: googleCalendarSelections.summary,
      title: googleCalendarEvents.title,
      description: googleCalendarEvents.description,
      location: googleCalendarEvents.location,
      htmlLink: googleCalendarEvents.htmlLink,
      meetingUrl: googleCalendarEvents.meetingUrl,
      startDate: googleCalendarEvents.startDate,
      endDateExclusive: googleCalendarEvents.endDateExclusive,
      startsAt: googleCalendarEvents.startsAt,
      endsAt: googleCalendarEvents.endsAt,
      allDay: googleCalendarEvents.allDay,
      timeZone: googleCalendarEvents.timeZone,
      visibility: googleCalendarEvents.visibility,
      transparency: googleCalendarEvents.transparency,
      status: googleCalendarEvents.status,
    })
    .from(googleCalendarEvents)
    .innerJoin(googleCalendarSelections, eq(googleCalendarSelections.id, googleCalendarEvents.selectionId))
    .innerJoin(googleCalendarConnections, eq(googleCalendarConnections.id, googleCalendarSelections.connectionId))
    .innerJoin(users, eq(users.id, googleCalendarConnections.userId))
    .where(
      and(
        eq(googleCalendarConnections.organizationId, organizationId),
        eq(googleCalendarSelections.selected, true),
        eq(googleCalendarSelections.importEvents, true),
        eq(googleCalendarSelections.calendarScope, "personal"),
      ),
    )
}

// ---- Mutation reads

export async function loadOrganizationProjects(db: Db, organizationId: string): Promise<readonly ProjectRow[]> {
  return db
    .select({ id: projects.id, name: projects.name, projectNumber: projects.projectNumber })
    .from(projects)
    .where(eq(projects.organizationId, organizationId))
}

export async function loadOrganizationProject(
  db: Db,
  organizationId: string,
  projectId: string,
): Promise<ProjectRow | null> {
  return db
    .select({ id: projects.id, name: projects.name, projectNumber: projects.projectNumber })
    .from(projects)
    .where(and(eq(projects.organizationId, organizationId), eq(projects.id, projectId)))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

/** Active organization members among these ids. */
export async function loadActiveMemberAttendees(
  db: Db,
  organizationId: string,
  userIds: readonly string[],
): Promise<readonly WorkCalendarEventAttendee[]> {
  const chunks = await Promise.all(
    chunkD1Values(userIds).map((userIdChunk) =>
      db
        .select({
          userId: users.id,
          email: users.email,
          displayName: users.displayName,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(users.isActive, true),
            inArray(organizationMembers.userId, userIdChunk),
          ),
        ),
    ),
  )
  return chunks.flat().map(attendeeFromRow)
}

export async function loadEventAttendees(db: Db, eventId: string): Promise<readonly WorkCalendarEventAttendee[]> {
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(workCalendarEventAttendees)
    .innerJoin(users, eq(users.id, workCalendarEventAttendees.userId))
    .where(eq(workCalendarEventAttendees.eventId, eventId))
  return rows.map(attendeeFromRow)
}

export async function loadGoogleDestination(
  db: Db,
  organizationId: string,
  selectionId: string,
): Promise<{
  readonly id: string
  readonly ownerUserId: string
  readonly calendarScope: string
  readonly accessRole: string
  readonly selected: boolean
  readonly exportCompassEvents: boolean
  readonly isCompassDestination: boolean
  readonly internalCanCreate: boolean
  readonly internalVisibility: string
} | null> {
  return db
    .select({
      id: googleCalendarSelections.id,
      ownerUserId: googleCalendarConnections.userId,
      calendarScope: googleCalendarSelections.calendarScope,
      accessRole: googleCalendarSelections.accessRole,
      selected: googleCalendarSelections.selected,
      exportCompassEvents: googleCalendarSelections.exportCompassEvents,
      isCompassDestination: googleCalendarSelections.isCompassDestination,
      internalCanCreate: googleCalendarSelections.internalCanCreate,
      internalVisibility: googleCalendarSelections.internalVisibility,
    })
    .from(googleCalendarSelections)
    .innerJoin(googleCalendarConnections, eq(googleCalendarConnections.id, googleCalendarSelections.connectionId))
    .where(
      and(
        eq(googleCalendarSelections.id, selectionId),
        eq(googleCalendarConnections.organizationId, organizationId),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

export type LinkedGoogleCalendarPermissions = {
  readonly selectionId: string
  readonly ownerUserId: string
  readonly calendarScope: string
  readonly internalCanEdit: boolean
  readonly internalCanDelete: boolean
  readonly internalVisibility: string
}

export async function loadLinkedGoogleCalendarPermissions(
  db: Db,
  organizationId: string,
  eventId: string,
): Promise<LinkedGoogleCalendarPermissions | null> {
  return db
    .select({
      selectionId: googleCalendarSelections.id,
      ownerUserId: googleCalendarConnections.userId,
      calendarScope: googleCalendarSelections.calendarScope,
      internalCanEdit: googleCalendarSelections.internalCanEdit,
      internalCanDelete: googleCalendarSelections.internalCanDelete,
      internalVisibility: googleCalendarSelections.internalVisibility,
    })
    .from(googleCalendarEntityLinks)
    .innerJoin(googleCalendarConnections, eq(googleCalendarConnections.id, googleCalendarEntityLinks.connectionId))
    .innerJoin(
      googleCalendarSelections,
      and(
        eq(googleCalendarSelections.connectionId, googleCalendarEntityLinks.connectionId),
        eq(googleCalendarSelections.googleCalendarId, googleCalendarEntityLinks.googleCalendarId),
      ),
    )
    .where(
      and(
        eq(googleCalendarConnections.organizationId, organizationId),
        eq(googleCalendarEntityLinks.sourceType, "work_calendar_event"),
        eq(googleCalendarEntityLinks.sourceId, eventId),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

export async function loadEventForEdit(
  db: Db,
  organizationId: string,
  eventId: string,
): Promise<{
  readonly id: string
  readonly projectId: string | null
  readonly title: string
  readonly startDate: string | null
  readonly startsAt: string | null
  readonly timeZone: string
  readonly allDay: boolean
  readonly status: string
  readonly version: number
} | null> {
  return db
    .select({
      id: workCalendarEvents.id,
      projectId: workCalendarEvents.projectId,
      title: workCalendarEvents.title,
      startDate: workCalendarEvents.startDate,
      startsAt: workCalendarEvents.startsAt,
      timeZone: workCalendarEvents.timeZone,
      allDay: workCalendarEvents.allDay,
      status: workCalendarEvents.status,
      version: workCalendarEvents.version,
    })
    .from(workCalendarEvents)
    .where(and(eq(workCalendarEvents.id, eventId), eq(workCalendarEvents.organizationId, organizationId)))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}
