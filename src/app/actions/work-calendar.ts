"use server"

import { and, asc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  organizationCalendarSettings,
  organizationMembers,
  projectOperations,
  projectRfis,
  projects,
  scheduleTasks,
  users,
  workCalendarEventAttendees,
  workCalendarEvents,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { createNotificationEvent } from "@/lib/notifications/events"
import { eventAttendeeNotificationRecipients } from "@/lib/notifications/audience"
import { requireOrg } from "@/lib/org-scope"
import {
  can,
  canManageWorkCalendarEvents,
  requirePermission,
} from "@/lib/permissions"
import {
  dateKeyInTimeZone,
  inclusiveEndDateFromExclusive,
  normalizeWorkCalendarEventTiming,
  projectTodoHref,
  resolveHOfficeProjectId,
  scheduleItemHref,
} from "@/lib/work-calendar"
import { isProjectTodoRecordType } from "@/lib/project-todos"

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

export type WorkCalendarEventDetails = {
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
  readonly attendees: readonly WorkCalendarEventAttendee[]
  readonly version: number
  readonly managed: boolean
}

type NonEventKind = Exclude<WorkCalendarEntryKind, "event">

export type WorkCalendarEntry =
  | (WorkCalendarEntryBase & {
      readonly kind: NonEventKind
      readonly eventDetails: null
    })
  | (WorkCalendarEntryBase & {
      readonly kind: "event"
      readonly eventDetails: WorkCalendarEventDetails
    })

export type WorkCalendarData = {
  readonly today: string
  readonly entries: readonly WorkCalendarEntry[]
  readonly projects: readonly ProjectRow[]
  readonly attendeeOptions: readonly WorkCalendarEventAttendee[]
  readonly defaultProjectId: string | null
  readonly defaultTimeZone: string
  readonly canCreateEvents: boolean
  readonly canManageEvents: boolean
}

export type ProjectRow = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function projectLabel(project: ProjectRow): string {
  return project.projectNumber ?? project.name
}

function userDisplayName(input: {
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
  readonly email: string
}): string {
  const fullName = [input.firstName, input.lastName]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .trim()
  return input.displayName?.trim() || fullName || input.email
}

function localTimeInZone(
  instant: string | null,
  timeZone: string
): string {
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
    const values = new Map(
      parts.map((part) => [part.type, part.value])
    )
    const hour = values.get("hour")
    const minute = values.get("minute")
    return hour && minute ? `${hour}:${minute}` : ""
  } catch {
    return ""
  }
}

function isClosedStatus(status: string): boolean {
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

function operationKind(recordType: string): NonEventKind {
  if (recordType === "purchase_order") return "purchase_order"
  return "task"
}

function operationSourceLabel(recordType: string, recordNumber: string | null): string {
  if (recordType === "calendar_event") return "Calendar event"
  if (recordType === "schedule_task") {
    return recordNumber
      ? `Schedule item follow-up ${recordNumber}`
      : "Schedule item follow-up"
  }

  const label = recordType
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")

  return recordNumber ? `${label} ${recordNumber}` : label
}

export async function getWorkCalendar(): Promise<WorkCalendarData> {
  const user = await requireAuth()
  requirePermission(user, "schedule", "read")
  const orgId = requireOrg(user)
  const canManageEvents =
    !isDemoUser(user.id) && canManageWorkCalendarEvents(user)
  const canCreateEvents =
    canManageEvents && can(user, "schedule", "create")

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const calendarSettings = await db
    .select({
      defaultProjectId: organizationCalendarSettings.defaultProjectId,
      timeZone: organizationCalendarSettings.timeZone,
    })
    .from(organizationCalendarSettings)
    .where(eq(organizationCalendarSettings.organizationId, orgId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  const defaultTimeZone =
    calendarSettings?.timeZone ?? "America/Denver"
  const today = dateKeyInTimeZone(new Date(), defaultTimeZone)
  const todayAnchor = new Date(`${today}T12:00:00Z`)
  const rangeStart = toDateKey(addDays(todayAnchor, -14))
  const rangeEnd = toDateKey(addDays(todayAnchor, 30))
  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
    })
    .from(projects)
    .where(eq(projects.organizationId, orgId))
    .orderBy(asc(projects.projectNumber), asc(projects.name))
  const projectById = new Map(
    projectRows.map((project) => [project.id, project])
  )
  const configuredDefaultProjectId =
    calendarSettings?.defaultProjectId &&
    projectById.has(calendarSettings.defaultProjectId)
      ? calendarSettings.defaultProjectId
      : null
  const defaultProjectId =
    configuredDefaultProjectId ?? resolveHOfficeProjectId(projectRows)
  const organizationUsers = canManageEvents
    ? await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(
          and(
            eq(organizationMembers.organizationId, orgId),
            eq(users.isActive, true)
          )
        )
        .orderBy(asc(users.displayName), asc(users.email))
    : []
  const attendeeOptions = organizationUsers.map((member) => ({
    userId: member.id,
    name: userDisplayName(member),
    email: member.email,
  }))
  const dedicatedEventIds = new Set(
    (
      await db
        .select({ id: workCalendarEvents.id })
        .from(workCalendarEvents)
        .where(eq(workCalendarEvents.organizationId, orgId))
    ).map((event) => event.id)
  )

  const entries: WorkCalendarEntry[] = []

  for (const project of projectRows) {
    const label = projectLabel(project)

    const taskRows = await db
      .select({
        id: scheduleTasks.id,
        title: scheduleTasks.title,
        status: scheduleTasks.status,
        startDate: scheduleTasks.startDate,
        endDate: scheduleTasks.endDateCalculated,
        assignedTo: scheduleTasks.assignedTo,
        isCriticalPath: scheduleTasks.isCriticalPath,
      })
      .from(scheduleTasks)
      .where(eq(scheduleTasks.projectId, project.id))
      .orderBy(asc(scheduleTasks.startDate), asc(scheduleTasks.sortOrder))

    for (const task of taskRows) {
      if (isClosedStatus(task.status)) continue
      if (task.endDate < rangeStart || task.startDate > rangeEnd) continue

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
        href: scheduleItemHref(project.id, task.id),
        eventDetails: null,
      })
    }

    const rfiRows = await db
      .select({
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
      .where(eq(projectRfis.projectId, project.id))
      .orderBy(asc(projectRfis.dueDate), asc(projectRfis.rfiNumber))

    for (const rfi of rfiRows) {
      if (isClosedStatus(rfi.status) || rfi.status === "complete") continue
      if (!rfi.dueDate || rfi.dueDate < rangeStart || rfi.dueDate > rangeEnd) {
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
        href: `/dashboard/projects/${project.id}/rfis`,
        eventDetails: null,
      })
    }

    const operationRows = await db
      .select({
        id: projectOperations.id,
        sourceRecordType: projectOperations.sourceRecordType,
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
      .where(eq(projectOperations.projectId, project.id))
      .orderBy(asc(projectOperations.dueDate), asc(projectOperations.title))

    for (const operation of operationRows) {
      if (operation.sourceRecordType === "calendar_event") {
        if (dedicatedEventIds.has(operation.id)) continue
        const startDate = operation.startDate ?? operation.dueDate
        const endDate = operation.dueDate ?? operation.startDate
        if (!startDate || !endDate) continue
        if (endDate < rangeStart || startDate > rangeEnd) continue

        // Preserve visibility for a legacy row created in the brief window
        // between the additive schema migration and the new application
        // deployment. A reconciliation pass can promote it without changing
        // the user-visible ID.
        entries.push({
          id: operation.id,
          kind: "event",
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
          sourceLabel: "Legacy calendar event",
          href: eventHref(operation.id),
          eventDetails: {
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
            attendees: [],
            version: 0,
            managed: false,
          },
        })
        continue
      }
      if (isClosedStatus(operation.status)) continue
      const startDate = operation.startDate ?? operation.dueDate
      const endDate = operation.dueDate ?? operation.startDate
      if (!startDate || !endDate) continue
      if (endDate < rangeStart || startDate > rangeEnd) continue

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
        sourceLabel: operationSourceLabel(
          operation.sourceRecordType,
          operation.sourceRecordNumber
        ),
        href:
          operation.sourceRecordType === "purchase_order"
            ? `/dashboard/projects/${project.id}/purchase-orders`
            : isProjectTodoRecordType(operation.sourceRecordType)
                ? projectTodoHref(project.id, operation.id)
                : `/dashboard/projects/${project.id}`,
        eventDetails: null,
      })
    }
  }

  const eventRows = await db
    .select()
    .from(workCalendarEvents)
    .where(eq(workCalendarEvents.organizationId, orgId))
    .orderBy(
      asc(workCalendarEvents.startDate),
      asc(workCalendarEvents.startsAt),
      asc(workCalendarEvents.title)
    )
  const eventIds = eventRows.map((event) => event.id)
  const attendeeRows =
    eventIds.length === 0
      ? []
      : await db
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
          .where(inArray(workCalendarEventAttendees.eventId, eventIds))
          .orderBy(asc(users.displayName), asc(users.email))
  const attendeesByEventId = new Map<
    string,
    WorkCalendarEventAttendee[]
  >()
  for (const attendee of attendeeRows) {
    const eventAttendees = attendeesByEventId.get(attendee.eventId) ?? []
    eventAttendees.push({
      userId: attendee.userId,
      name: userDisplayName(attendee),
      email: canManageEvents ? attendee.email : "",
    })
    attendeesByEventId.set(attendee.eventId, eventAttendees)
  }

  for (const event of eventRows) {
    if (isClosedStatus(event.status)) continue
    const project = event.projectId
      ? projectById.get(event.projectId) ?? null
      : null
    const timedStart =
      event.startsAt !== null ? new Date(event.startsAt) : null
    const timedEnd =
      event.endsAt !== null ? new Date(event.endsAt) : null
    const timedEndDisplay =
      timedEnd && !Number.isNaN(timedEnd.getTime())
        ? new Date(timedEnd.getTime() - 1)
        : null
    const startDate = event.allDay
      ? event.startDate
      : timedStart && !Number.isNaN(timedStart.getTime())
        ? dateKeyInTimeZone(timedStart, event.timeZone)
        : null
    const endDate = event.allDay
      ? event.endDateExclusive
        ? inclusiveEndDateFromExclusive(event.endDateExclusive)
        : null
      : timedEndDisplay
        ? dateKeyInTimeZone(timedEndDisplay, event.timeZone)
        : null
    if (!startDate || !endDate) continue
    if (endDate < rangeStart || startDate > rangeEnd) continue
    const attendees = attendeesByEventId.get(event.id) ?? []

    entries.push({
      id: event.id,
      kind: "event",
      projectId: project?.id ?? null,
      projectLabel: project ? projectLabel(project) : "No project",
      projectName: project?.name ?? "Archived project",
      title: event.title,
      status: event.status,
      priority: "normal",
      startDate,
      endDate,
      assignedTo:
        attendees.length > 0
          ? attendees.map((attendee) => attendee.name).join(", ")
          : null,
      companyName: null,
      sourceLabel: "Calendar event",
      href: `/dashboard/schedule?kind=event&item=${encodeURIComponent(event.id)}#work-calendar-${encodeURIComponent(event.id)}`,
      eventDetails: {
        description: event.description,
        startDate,
        endDate,
        startTime: event.allDay
          ? ""
          : localTimeInZone(event.startsAt, event.timeZone),
        endTime: event.allDay
          ? ""
          : localTimeInZone(event.endsAt, event.timeZone),
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: event.allDay,
        timeZone: event.timeZone,
        location: event.location,
        attendees,
        version: event.version,
        managed: true,
      },
    })
  }

  entries.sort((left, right) => {
    const byDate = left.startDate.localeCompare(right.startDate)
    if (byDate !== 0) return byDate

    const byProject = left.projectLabel.localeCompare(right.projectLabel)
    if (byProject !== 0) return byProject

    return left.title.localeCompare(right.title)
  })

  return {
    today,
    entries,
    projects: projectRows,
    attendeeOptions,
    defaultProjectId,
    defaultTimeZone,
    canCreateEvents,
    canManageEvents,
  }
}

export type WorkCalendarEventMutationInput = {
  readonly title: string
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
  readonly attendeeUserIds: readonly string[]
}

type WorkCalendarEventMutationResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

type ValidatedEventInput = {
  readonly project: ProjectRow
  readonly title: string
  readonly description: string | null
  readonly startDate: string | null
  readonly endDateExclusive: string | null
  readonly startsAt: string | null
  readonly endsAt: string | null
  readonly allDay: boolean
  readonly timeZone: string
  readonly location: string | null
  readonly attendees: readonly WorkCalendarEventAttendee[]
}

function cleanRequiredText(
  value: string,
  label: string,
  maxLength: number
): string {
  const cleaned = value.trim()
  if (cleaned.length === 0) throw new Error(`${label} is required`)
  if (cleaned.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`)
  }
  return cleaned
}

function cleanOptionalText(
  value: string | null,
  label: string,
  maxLength: number
): string | null {
  const cleaned = value?.trim() ?? ""
  if (cleaned.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`)
  }
  return cleaned || null
}

async function organizationProjects(
  db: ReturnType<typeof getDb>,
  organizationId: string
): Promise<readonly ProjectRow[]> {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
    })
    .from(projects)
    .where(eq(projects.organizationId, organizationId))
}

async function validateAttendees(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  attendeeUserIds: readonly string[]
): Promise<readonly WorkCalendarEventAttendee[]> {
  const normalizedIds = Array.from(
    new Set(
      attendeeUserIds
        .map((userId) => userId.trim())
        .filter((userId) => userId.length > 0)
    )
  )
  if (normalizedIds.length > 100) {
    throw new Error("An event can include up to 100 attendees")
  }
  if (normalizedIds.length === 0) return []

  const rows = await db
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
        inArray(organizationMembers.userId, normalizedIds)
      )
    )

  if (rows.length !== normalizedIds.length) {
    throw new Error(
      "One or more attendees are not active members of this organization"
    )
  }

  return rows.map((row) => ({
    userId: row.userId,
    name: userDisplayName(row),
    email: row.email,
  }))
}

async function validateEventInput(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  input: WorkCalendarEventMutationInput
): Promise<ValidatedEventInput> {
  const projectRows = await organizationProjects(db, organizationId)
  const settings = await db
    .select({
      defaultProjectId: organizationCalendarSettings.defaultProjectId,
    })
    .from(organizationCalendarSettings)
    .where(eq(organizationCalendarSettings.organizationId, organizationId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  const configuredDefaultProjectId =
    settings?.defaultProjectId &&
    projectRows.some(
      (project) => project.id === settings.defaultProjectId
    )
      ? settings.defaultProjectId
      : null
  const inferredDefaultProjectId =
    resolveHOfficeProjectId(projectRows)
  const projectId =
    input.projectId?.trim() ||
    configuredDefaultProjectId ||
    inferredDefaultProjectId
  if (!projectId) {
    throw new Error(
      "Select a project. Compass could not resolve one unique H-Office project for this organization."
    )
  }

  const project = projectRows.find((candidate) => candidate.id === projectId)
  if (!project) throw new Error("Project not found")
  if (
    !input.projectId?.trim() &&
    !configuredDefaultProjectId &&
    inferredDefaultProjectId === project.id
  ) {
    const now = new Date().toISOString()
    await db
      .insert(organizationCalendarSettings)
      .values({
        organizationId,
        defaultProjectId: project.id,
        timeZone: "America/Denver",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: organizationCalendarSettings.organizationId,
        set: {
          defaultProjectId: project.id,
          updatedAt: now,
        },
      })
  }

  const timing = normalizeWorkCalendarEventTiming(input)
  if (!timing.success) throw new Error(timing.error)

  return {
    project,
    title: cleanRequiredText(input.title, "Event title", 200),
    description: cleanOptionalText(input.description, "Description", 5_000),
    startDate: timing.startDate,
    endDateExclusive: timing.endDateExclusive,
    startsAt: timing.startsAt,
    endsAt: timing.endsAt,
    allDay: input.allDay,
    timeZone: timing.timeZone,
    location: cleanOptionalText(input.location, "Location", 500),
    attendees: await validateAttendees(
      db,
      organizationId,
      input.attendeeUserIds
    ),
  }
}

async function syncEventAttendees(
  db: ReturnType<typeof getDb>,
  eventId: string,
  previousAttendees: readonly WorkCalendarEventAttendee[],
  nextAttendees: readonly WorkCalendarEventAttendee[],
  now: string
): Promise<void> {
  const previousIds = new Set(
    previousAttendees.map((attendee) => attendee.userId)
  )
  const nextIds = new Set(
    nextAttendees.map((attendee) => attendee.userId)
  )

  // Preserve response state for retained attendees. Adding before removing
  // also avoids clearing the entire attendee list if D1 is interrupted.
  for (const attendee of nextAttendees) {
    if (previousIds.has(attendee.userId)) continue
    await db
      .insert(workCalendarEventAttendees)
      .values({
        id: crypto.randomUUID(),
        eventId,
        userId: attendee.userId,
        responseStatus: "needs_action",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
  }

  const removedIds = previousAttendees
    .map((attendee) => attendee.userId)
    .filter((userId) => !nextIds.has(userId))
  if (removedIds.length > 0) {
    await db
      .delete(workCalendarEventAttendees)
      .where(
        and(
          eq(workCalendarEventAttendees.eventId, eventId),
          inArray(workCalendarEventAttendees.userId, removedIds)
        )
      )
  }
}

async function eventAttendees(
  db: ReturnType<typeof getDb>,
  eventId: string
): Promise<readonly WorkCalendarEventAttendee[]> {
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

  return rows.map((row) => ({
    userId: row.userId,
    name: userDisplayName(row),
    email: row.email,
  }))
}

function eventHref(eventId: string): string {
  return `/dashboard/schedule?kind=event&item=${encodeURIComponent(eventId)}#work-calendar-${encodeURIComponent(eventId)}`
}

function eventStartLabel(input: {
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

async function notifyEventParticipants(input: {
  readonly organizationId: string
  readonly projectId: string | null
  readonly project: ProjectRow | null
  readonly eventId: string
  readonly eventTitle: string
  readonly startLabel: string
  readonly change: "created" | "updated" | "cancelled"
  readonly actorId: string
  readonly actorName: string
  readonly attendees: readonly WorkCalendarEventAttendee[]
}): Promise<void> {
  const recipients = eventAttendeeNotificationRecipients(input.attendees)
  if (recipients.length === 0) return

  const projectName = input.project
    ? input.project.projectNumber
      ? `${input.project.projectNumber} — ${input.project.name}`
      : input.project.name
    : "an archived project"

  try {
    await createNotificationEvent({
      organizationId: input.organizationId,
      projectId: input.projectId,
      eventType: `schedule.event_${input.change}`,
      sourceType: "calendar_event",
      sourceId: input.eventId,
      title: `${input.eventTitle} ${input.change}`,
      body: `${input.actorName} ${input.change} this event for ${projectName} on ${input.startLabel}.`,
      href: eventHref(input.eventId),
      priority: "normal",
      audience: "attendees",
      createdBy: input.actorId,
      recipients,
      delivery: {
        inApp: true,
        email: false,
        push: true,
      },
    })
  } catch (error) {
    // The event mutation is durable even if a downstream notification
    // provider is temporarily unavailable.
    console.error("Failed to notify calendar event attendees:", error)
  }
}

function revalidateEventPaths(
  projectIds: readonly (string | null)[]
): void {
  revalidatePath("/dashboard/schedule")
  revalidatePath("/dashboard")
  const concreteProjectIds = projectIds.filter(
    (projectId): projectId is string => projectId !== null
  )
  for (const projectId of new Set(concreteProjectIds)) {
    revalidatePath(`/dashboard/projects/${projectId}`)
  }
}

export async function createWorkCalendarEvent(
  input: WorkCalendarEventMutationInput
): Promise<WorkCalendarEventMutationResult> {
  try {
    const user = await requireAuth()
    if (!canManageWorkCalendarEvents(user)) {
      return { success: false, error: "Permission denied" }
    }
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "create")
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const validated = await validateEventInput(db, orgId, input)
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await db.insert(workCalendarEvents).values({
      id,
      organizationId: orgId,
      projectId: validated.project.id,
      title: validated.title,
      description: validated.description,
      startDate: validated.startDate,
      endDateExclusive: validated.endDateExclusive,
      startsAt: validated.startsAt,
      endsAt: validated.endsAt,
      allDay: validated.allDay,
      timeZone: validated.timeZone,
      location: validated.location,
      status: "open",
      version: 1,
      createdBy: user.id,
      updatedBy: user.id,
      cancelledBy: null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    })
    await syncEventAttendees(db, id, [], validated.attendees, now)
    await notifyEventParticipants({
      organizationId: orgId,
      projectId: validated.project.id,
      project: validated.project,
      eventId: id,
      eventTitle: validated.title,
      startLabel: eventStartLabel(validated),
      change: "created",
      actorId: user.id,
      actorName: user.displayName ?? user.email,
      attendees: validated.attendees,
    })

    revalidateEventPaths([validated.project.id])
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to create calendar event",
    }
  }
}

export async function updateWorkCalendarEvent(
  eventId: string,
  expectedVersion: number,
  input: WorkCalendarEventMutationInput
): Promise<WorkCalendarEventMutationResult> {
  try {
    const user = await requireAuth()
    if (!canManageWorkCalendarEvents(user)) {
      return { success: false, error: "Permission denied" }
    }
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const existing = await db
      .select({
        id: workCalendarEvents.id,
        projectId: workCalendarEvents.projectId,
        status: workCalendarEvents.status,
        version: workCalendarEvents.version,
      })
      .from(workCalendarEvents)
      .where(
        and(
          eq(workCalendarEvents.id, eventId),
          eq(workCalendarEvents.organizationId, orgId)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!existing) {
      return { success: false, error: "Calendar event not found" }
    }
    if (isClosedStatus(existing.status)) {
      return {
        success: false,
        error: "Cancelled events cannot be edited.",
      }
    }
    if (
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 1 ||
      existing.version !== expectedVersion
    ) {
      return {
        success: false,
        error:
          "This event changed after you opened it. Refresh and try again.",
      }
    }

    const previousAttendees = await eventAttendees(db, eventId)
    const validated = await validateEventInput(db, orgId, input)
    const now = new Date().toISOString()
    const updated = await db
      .update(workCalendarEvents)
      .set({
        projectId: validated.project.id,
        title: validated.title,
        description: validated.description,
        startDate: validated.startDate,
        endDateExclusive: validated.endDateExclusive,
        startsAt: validated.startsAt,
        endsAt: validated.endsAt,
        allDay: validated.allDay,
        timeZone: validated.timeZone,
        location: validated.location,
        version: expectedVersion + 1,
        updatedBy: user.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(workCalendarEvents.id, eventId),
          eq(workCalendarEvents.organizationId, orgId),
          eq(workCalendarEvents.status, "open"),
          eq(workCalendarEvents.version, expectedVersion)
        )
      )
      .returning({ id: workCalendarEvents.id })
      .then((rows) => rows[0] ?? null)
    if (!updated) {
      return {
        success: false,
        error:
          "This event changed after you opened it. Refresh and try again.",
      }
    }
    await syncEventAttendees(
      db,
      eventId,
      previousAttendees,
      validated.attendees,
      now
    )

    const notificationAttendees = new Map<
      string,
      WorkCalendarEventAttendee
    >()
    for (const attendee of [
      ...previousAttendees,
      ...validated.attendees,
    ]) {
      notificationAttendees.set(attendee.userId, attendee)
    }
    await notifyEventParticipants({
      organizationId: orgId,
      projectId: validated.project.id,
      project: validated.project,
      eventId,
      eventTitle: validated.title,
      startLabel: eventStartLabel(validated),
      change: "updated",
      actorId: user.id,
      actorName: user.displayName ?? user.email,
      attendees: Array.from(notificationAttendees.values()),
    })

    revalidateEventPaths([existing.projectId, validated.project.id])
    return { success: true, id: eventId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to update calendar event",
    }
  }
}

export async function cancelWorkCalendarEvent(
  eventId: string,
  expectedVersion: number
): Promise<WorkCalendarEventMutationResult> {
  try {
    const user = await requireAuth()
    if (!canManageWorkCalendarEvents(user)) {
      return { success: false, error: "Permission denied" }
    }
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const existing = await db
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
      .where(
        and(
          eq(workCalendarEvents.id, eventId),
          eq(workCalendarEvents.organizationId, orgId)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!existing) {
      return { success: false, error: "Calendar event not found" }
    }
    if (isClosedStatus(existing.status)) {
      return { success: true, id: eventId }
    }
    if (
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 1 ||
      existing.version !== expectedVersion
    ) {
      return {
        success: false,
        error:
          "This event changed after you opened it. Refresh and try again.",
      }
    }

    const attendees = await eventAttendees(db, eventId)
    const project = existing.projectId
      ? (await organizationProjects(db, orgId)).find(
          (candidate) => candidate.id === existing.projectId
        ) ?? null
      : null
    const now = new Date().toISOString()
    const cancelled = await db
      .update(workCalendarEvents)
      .set({
        status: "cancelled",
        version: expectedVersion + 1,
        updatedBy: user.id,
        cancelledBy: user.id,
        cancelledAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(workCalendarEvents.id, eventId),
          eq(workCalendarEvents.organizationId, orgId),
          eq(workCalendarEvents.status, "open"),
          eq(workCalendarEvents.version, expectedVersion)
        )
      )
      .returning({ id: workCalendarEvents.id })
      .then((rows) => rows[0] ?? null)
    if (!cancelled) {
      return {
        success: false,
        error:
          "This event changed after you opened it. Refresh and try again.",
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
    return { success: true, id: eventId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to cancel calendar event",
    }
  }
}
