import "server-only"

import { and, eq, gte, inArray, lte, ne } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  morningPlanPreferences,
  myCompassCalendars,
  organizationCalendarSettings,
  organizationMembers,
  projectClientMeetings,
  projectOperations,
  projects,
  scheduleTasks,
  users,
  workCalendarEventAttendees,
  workCalendarEvents,
  workdayExceptions,
} from "@/db/schema"
import { companyTimeZone } from "@/lib/daily-logs/log-followups-server"
import { isDemoUser } from "@/lib/demo"
import { upsertMorningPlanPreferences } from "@/lib/domain/settings/store"
import type { MorningPlanSettings } from "@/lib/feature-settings/registry"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import {
  buildTodaysPlan,
  measureWeekLoad,
  planDigestText,
  shiftDate,
  weekBounds,
  type PlanMeeting,
  type PlanScheduleItem,
  type PlanTodo,
  type TodaysPlan,
  type WeekLoad,
} from "@/lib/morning-plan/plan"
import { assignmentIncludes, personAliases } from "@/lib/my-compass-calendar/items"
import { createSystemNotificationEvent } from "@/lib/notifications/create-event"
import type { ExceptionCategory, ExceptionRecurrence, WorkdayExceptionData, WorkdayExceptionType } from "@/lib/schedule/types"
import { isInternalStaffRole } from "@/lib/user-roles"
import {
  dateKeyInTimeZone,
  inclusiveEndDateFromExclusive,
  projectTodoHref,
  scheduleItemHref,
  timeKeyInTimeZone,
} from "@/lib/work-calendar"
import { expandWorkCalendarRecurrence, isWorkCalendarRecurrence } from "@/lib/work-calendar-recurrence"

type Db = ReturnType<typeof getDb>

const OPEN_PROJECT_STATUSES = ["OPEN", "WARRANTY"] as const
const OPEN_TODO_STATUSES = ["incomplete", "open", "in_progress"] as const
const TODO_RECORD_TYPES = ["todo", "staff_task", "task"] as const
/** How far back overdue work still shows on the plan. */
const OVERDUE_DAYS = 30
/** Nothing is sent before this local hour, whatever the person picked. */
const EARLIEST_SEND_HOUR = 5

export type PlanPerson = {
  readonly id: string
  readonly email: string
  readonly googleEmail: string | null
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
  readonly otherNames: readonly string[]
}

type OrgTask = PlanScheduleItem & { readonly assignedTo: string | null; readonly assignedUserId: string | null }
type OrgTodo = PlanTodo & { readonly assigneeName: string | null }
type OrgMeeting = PlanMeeting & { readonly userIds: ReadonlySet<string>; readonly emails: ReadonlySet<string> }

/** Everything today's plans and this week's workload are built from, loaded once per company. */
export type OrgPlanRows = {
  readonly today: string
  readonly tasks: readonly OrgTask[]
  readonly todos: readonly OrgTodo[]
  readonly meetings: readonly OrgMeeting[]
  readonly exceptions: readonly WorkdayExceptionData[]
}

function chunks<T>(values: readonly T[], size = 80): readonly (readonly T[])[] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, index * size + size))
}

function projectLabel(project: { readonly name: string; readonly projectNumber: string | null }): string {
  return project.projectNumber?.trim() || project.name
}

function parseStrings(value: string | null): readonly string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

function exceptionType(value: string): WorkdayExceptionType {
  return value === "working" ? "working" : "non_working"
}

function exceptionRecurrence(value: string): ExceptionRecurrence {
  return value === "yearly" ? "yearly" : "one_time"
}

const EXCEPTION_CATEGORIES: readonly ExceptionCategory[] = [
  "national_holiday",
  "state_holiday",
  "vacation_day",
  "company_holiday",
  "weather_day",
  "extra_workday",
]

function exceptionCategory(value: string): ExceptionCategory {
  return EXCEPTION_CATEGORIES.find((category) => category === value) ?? "company_holiday"
}

function eventHref(eventId: string): string {
  return `/dashboard/schedule?kind=event&item=${encodeURIComponent(eventId)}#work-calendar-${encodeURIComponent(eventId)}`
}

/** The company's workday calendar: the office calendar project's exceptions. */
async function companyExceptions(db: Db, organizationId: string): Promise<readonly WorkdayExceptionData[]> {
  const [settings] = await db
    .select({ projectId: organizationCalendarSettings.defaultProjectId })
    .from(organizationCalendarSettings)
    .where(eq(organizationCalendarSettings.organizationId, organizationId))
    .limit(1)
  if (!settings?.projectId) return []
  const rows = await db.select().from(workdayExceptions).where(eq(workdayExceptions.projectId, settings.projectId))
  return rows.map((row) => ({
    ...row,
    type: exceptionType(row.type),
    category: exceptionCategory(row.category),
    recurrence: exceptionRecurrence(row.recurrence),
  }))
}

async function loadOrgPlanRows(db: Db, organizationId: string, today: string, timeZone: string): Promise<OrgPlanRows> {
  const from = shiftDate(today, -OVERDUE_DAYS)
  const { start: weekStart, end: weekEnd } = weekBounds(today)
  const earliest = from < weekStart ? from : weekStart
  // Join projects rather than listing ids: D1 allows 100 bound parameters.
  const openProjects = and(eq(projects.organizationId, organizationId), inArray(projects.status, [...OPEN_PROJECT_STATUSES]))

  const [taskRows, todoRows, eventRows, meetingRows, exceptions] = await Promise.all([
    db
      .select({
        id: scheduleTasks.id,
        projectId: scheduleTasks.projectId,
        title: scheduleTasks.title,
        startDate: scheduleTasks.startDate,
        endDate: scheduleTasks.endDateCalculated,
        assignedTo: scheduleTasks.assignedTo,
        assignedUserId: scheduleTasks.assignedUserId,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
      })
      .from(scheduleTasks)
      .innerJoin(projects, eq(projects.id, scheduleTasks.projectId))
      .where(and(openProjects, ne(scheduleTasks.status, "COMPLETE"), lte(scheduleTasks.startDate, weekEnd), gte(scheduleTasks.endDateCalculated, earliest))),
    db
      .select({
        id: projectOperations.id,
        projectId: projectOperations.projectId,
        title: projectOperations.title,
        dueDate: projectOperations.dueDate,
        priority: projectOperations.priority,
        assigneeName: projectOperations.assigneeName,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
      })
      .from(projectOperations)
      .innerJoin(projects, eq(projects.id, projectOperations.projectId))
      .where(
        and(
          openProjects,
          inArray(projectOperations.sourceRecordType, [...TODO_RECORD_TYPES]),
          inArray(projectOperations.status, [...OPEN_TODO_STATUSES]),
          gte(projectOperations.dueDate, earliest),
          lte(projectOperations.dueDate, weekEnd),
        ),
      ),
    db
      .select({
        id: workCalendarEvents.id,
        title: workCalendarEvents.title,
        allDay: workCalendarEvents.allDay,
        startDate: workCalendarEvents.startDate,
        endDateExclusive: workCalendarEvents.endDateExclusive,
        startsAt: workCalendarEvents.startsAt,
        endsAt: workCalendarEvents.endsAt,
        recurrence: workCalendarEvents.recurrence,
        recurrenceUntil: workCalendarEvents.recurrenceUntil,
        eventType: workCalendarEvents.eventType,
        createdBy: workCalendarEvents.createdBy,
      })
      .from(workCalendarEvents)
      .where(and(eq(workCalendarEvents.organizationId, organizationId), ne(workCalendarEvents.status, "cancelled"))),
    db
      .select({
        id: projectClientMeetings.id,
        projectId: projectClientMeetings.projectId,
        title: projectClientMeetings.title,
        startsAt: projectClientMeetings.startsAt,
        organizerUserId: projectClientMeetings.organizerUserId,
        staffEmails: projectClientMeetings.staffEmails,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
      })
      .from(projectClientMeetings)
      .innerJoin(projects, eq(projects.id, projectClientMeetings.projectId))
      .where(
        and(
          eq(projectClientMeetings.organizationId, organizationId),
          eq(projectClientMeetings.status, "scheduled"),
          // A day either side in UTC; narrowed to today in the company's zone below.
          gte(projectClientMeetings.startsAt, `${shiftDate(today, -1)}T00:00:00.000Z`),
          lte(projectClientMeetings.startsAt, `${shiftDate(today, 2)}T00:00:00.000Z`),
        ),
      ),
    companyExceptions(db, organizationId),
  ])

  const tasks: OrgTask[] = taskRows.map((row) => ({
    id: row.id,
    title: row.title,
    projectLabel: projectLabel({ name: row.projectName, projectNumber: row.projectNumber }),
    startDate: row.startDate,
    endDate: row.endDate < row.startDate ? row.startDate : row.endDate,
    href: scheduleItemHref(row.projectId, row.id),
    assignedTo: row.assignedTo,
    assignedUserId: row.assignedUserId,
  }))
  const todos: OrgTodo[] = todoRows.flatMap((row) =>
    row.dueDate
      ? [{
          id: row.id,
          title: row.title,
          projectLabel: projectLabel({ name: row.projectName, projectNumber: row.projectNumber }),
          dueDate: row.dueDate,
          priority: row.priority,
          href: projectTodoHref(row.projectId, row.id),
          assigneeName: row.assigneeName,
        }]
      : [],
  )

  // Work Calendar events happening today, with recurring ones expanded.
  const todaysEvents = eventRows.flatMap((event) => {
    const startDate = event.allDay ? event.startDate : event.startsAt ? dateKeyInTimeZone(new Date(event.startsAt), timeZone) : null
    const endDate = event.allDay
      ? event.endDateExclusive
        ? inclusiveEndDateFromExclusive(event.endDateExclusive)
        : event.startDate
      : event.endsAt
        ? dateKeyInTimeZone(new Date(event.endsAt), timeZone)
        : startDate
    if (!startDate || !endDate || !isWorkCalendarRecurrence(event.recurrence)) return []
    const occurs = expandWorkCalendarRecurrence({
      startDate,
      endDate,
      recurrence: event.recurrence,
      recurrenceUntil: event.recurrenceUntil,
      windowStart: today,
      windowEnd: today,
    })
    if (occurs.length === 0) return []
    const startTime = !event.allDay && event.startsAt ? timeKeyInTimeZone(new Date(event.startsAt), timeZone) : null
    return [{ ...event, startTime }]
  })
  const attendees = (
    await Promise.all(
      chunks(todaysEvents.map((event) => event.id)).map((ids) =>
        db
          .select({ eventId: workCalendarEventAttendees.eventId, userId: workCalendarEventAttendees.userId })
          .from(workCalendarEventAttendees)
          .where(inArray(workCalendarEventAttendees.eventId, [...ids])),
      ),
    )
  ).flat()
  const meetings: OrgMeeting[] = [
    ...todaysEvents.map((event) => {
      const people = attendees.filter((row) => row.eventId === event.id).map((row) => row.userId)
      // Without attendees, the event is its creator's.
      const userIds = new Set(people.length > 0 ? people : event.createdBy ? [event.createdBy] : [])
      return {
        id: `event:${event.id}`,
        title: event.title,
        projectLabel: null,
        startTime: event.startTime,
        href: eventHref(event.id),
        userIds,
        emails: new Set<string>(),
      }
    }),
    ...meetingRows
      .filter((meeting) => dateKeyInTimeZone(new Date(meeting.startsAt), timeZone) === today)
      .map((meeting) => ({
        id: `meeting:${meeting.id}`,
        title: meeting.title,
        projectLabel: projectLabel({ name: meeting.projectName, projectNumber: meeting.projectNumber }),
        startTime: timeKeyInTimeZone(new Date(meeting.startsAt), timeZone),
        href: `/dashboard/projects/${encodeURIComponent(meeting.projectId)}`,
        userIds: new Set([meeting.organizerUserId]),
        emails: new Set(parseStrings(meeting.staffEmails).map((email) => email.trim().toLowerCase())),
      })),
  ]

  return { today, tasks, todos, meetings, exceptions }
}

/** One person's share of the company rows. */
export function personSources(rows: OrgPlanRows, person: PlanPerson): {
  readonly scheduleItems: readonly PlanScheduleItem[]
  readonly todos: readonly PlanTodo[]
  readonly meetings: readonly PlanMeeting[]
} {
  const aliases = personAliases(person)
  const emails = new Set([person.email, person.googleEmail].flatMap((email) => (email ? [email.trim().toLowerCase()] : [])))
  return {
    scheduleItems: rows.tasks.filter((task) => task.assignedUserId === person.id || assignmentIncludes(task.assignedTo, aliases)),
    todos: rows.todos.filter((todo) => assignmentIncludes(todo.assigneeName, aliases)),
    meetings: rows.meetings.filter(
      (meeting) => meeting.userIds.has(person.id) || [...emails].some((email) => meeting.emails.has(email)),
    ),
  }
}

export function personPlan(rows: OrgPlanRows, person: PlanPerson, settings: MorningPlanSettings): {
  readonly plan: TodaysPlan
  readonly load: WeekLoad | null
} {
  const sources = personSources(rows, person)
  const plan = buildTodaysPlan({ today: rows.today, ...sources })
  const load = settings.overloadWarnings
    ? measureWeekLoad({
        today: rows.today,
        scheduleItems: sources.scheduleItems,
        todos: sources.todos,
        exceptions: rows.exceptions,
        thresholdPercent: settings.overloadThresholdPercent,
        todoWorkdays: settings.todoWorkdays,
      })
    : null
  return { plan, load }
}

type StaffRow = PlanPerson & {
  readonly name: string
  readonly digestEnabled: boolean
  readonly digestHour: number
  readonly lastDigestOn: string | null
  readonly lastOverloadWeek: string | null
}

/** Active staff (by their role in this company), with their plan preferences. */
async function staffWithPreferences(db: Db, organizationId: string): Promise<readonly StaffRow[]> {
  const rows = await db
    .select({
      id: users.id,
      role: organizationMembers.role,
      email: users.email,
      googleEmail: users.googleEmail,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
      otherNames: myCompassCalendars.otherNames,
      digestEnabled: morningPlanPreferences.digestEnabled,
      digestHour: morningPlanPreferences.digestHour,
      lastDigestOn: morningPlanPreferences.lastDigestOn,
      lastOverloadWeek: morningPlanPreferences.lastOverloadWeek,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .leftJoin(myCompassCalendars, eq(myCompassCalendars.userId, users.id))
    .leftJoin(morningPlanPreferences, eq(morningPlanPreferences.userId, users.id))
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(users.isActive, true)))
  return rows
    .filter((row) => isInternalStaffRole(row.role) && !isDemoUser(row.id))
    .map((row) => ({
      id: row.id,
      email: row.email,
      googleEmail: row.googleEmail,
      displayName: row.displayName,
      firstName: row.firstName,
      lastName: row.lastName,
      otherNames: parseStrings(row.otherNames),
      name: row.displayName?.trim() || [row.firstName, row.lastName].filter(Boolean).join(" ") || row.email,
      digestEnabled: row.digestEnabled ?? false,
      digestHour: row.digestHour ?? 7,
      lastDigestOn: row.lastDigestOn,
      lastOverloadWeek: row.lastOverloadWeek,
    }))
}

/** One staff member's plan for today, in the company's time zone. */
export async function loadPlanForUser(
  db: Db,
  organizationId: string,
  person: PlanPerson,
  now: Date = new Date(),
): Promise<{ readonly plan: TodaysPlan; readonly load: WeekLoad | null } | null> {
  const settings = await readFeatureSettings(db, organizationId, "morning-plan")
  if (!settings.enabled) return null
  const timeZone = await companyTimeZone(db, organizationId)
  const rows = await loadOrgPlanRows(db, organizationId, dateKeyInTimeZone(now, timeZone), timeZone)
  return personPlan(rows, person, settings)
}

export type TeamWorkloadRow = {
  readonly userId: string
  readonly name: string
  readonly load: WeekLoad
}

/** Staff whose week is over the company's threshold, most loaded first. */
export async function loadTeamWorkload(db: Db, organizationId: string, now: Date = new Date()): Promise<readonly TeamWorkloadRow[]> {
  const settings = await readFeatureSettings(db, organizationId, "morning-plan")
  if (!settings.enabled || !settings.overloadWarnings) return []
  const timeZone = await companyTimeZone(db, organizationId)
  const [rows, staff] = await Promise.all([
    loadOrgPlanRows(db, organizationId, dateKeyInTimeZone(now, timeZone), timeZone),
    staffWithPreferences(db, organizationId),
  ])
  return staff
    .flatMap((person) => {
      const { load } = personPlan(rows, person, settings)
      return load?.overloaded ? [{ userId: person.id, name: person.name, load }] : []
    })
    .sort((left, right) => (right.load.percent ?? 0) - (left.load.percent ?? 0))
}

async function saveSent(
  db: Db,
  organizationId: string,
  userId: string,
  change: { readonly lastDigestOn?: string; readonly lastOverloadWeek?: string },
  now: Date,
): Promise<void> {
  await upsertMorningPlanPreferences(db, { userId, organizationId, change, at: now.toISOString() })
}

/**
 * Scheduled every 10 minutes: sends each person who asked for it their plan
 * once a day at their hour, and an overload warning at most once a week.
 */
export async function sweepMorningPlans(db: Db, now: Date = new Date()): Promise<{ readonly digests: number; readonly warnings: number }> {
  const orgs = await db.selectDistinct({ organizationId: organizationMembers.organizationId }).from(organizationMembers)
  let digests = 0
  let warnings = 0
  for (const { organizationId } of orgs) {
    const settings = await readFeatureSettings(db, organizationId, "morning-plan")
    if (!settings.enabled || (!settings.allowDailyDigest && !settings.overloadWarnings)) continue
    const timeZone = await companyTimeZone(db, organizationId)
    const today = dateKeyInTimeZone(now, timeZone)
    const hour = Number(timeKeyInTimeZone(now, timeZone).slice(0, 2))
    if (hour < EARLIEST_SEND_HOUR) continue
    const weekStart = weekBounds(today).start
    const staff = (await staffWithPreferences(db, organizationId)).filter((person) => {
      const digestDue = settings.allowDailyDigest && person.digestEnabled && hour >= person.digestHour && person.lastDigestOn !== today
      const warningDue = settings.overloadWarnings && hour >= person.digestHour && person.lastOverloadWeek !== weekStart
      return digestDue || warningDue
    })
    if (staff.length === 0) continue
    const rows = await loadOrgPlanRows(db, organizationId, today, timeZone)
    for (const person of staff) {
      const { plan, load } = personPlan(rows, person, settings)
      const recipients = [{ userId: person.id, email: person.email }]
      if (settings.allowDailyDigest && person.digestEnabled && hour >= person.digestHour && person.lastDigestOn !== today) {
        // Record the send first, so an overlapping run can't send twice.
        await saveSent(db, organizationId, person.id, { lastDigestOn: today }, now)
        await createSystemNotificationEvent({
          organizationId,
          projectId: null,
          eventType: "morning_plan.digest",
          sourceType: "morning_plan",
          sourceId: `${person.id}:${today}`,
          title: "Today's plan",
          body: planDigestText(plan, load),
          href: "/dashboard#todays-plan",
          priority: "normal",
          audience: "staff",
          recipients,
          delivery: { inApp: false, email: true, push: true },
        })
        digests += 1
      }
      if (load?.overloaded && person.lastOverloadWeek !== weekStart && hour >= person.digestHour) {
        await saveSent(db, organizationId, person.id, { lastOverloadWeek: weekStart }, now)
        await createSystemNotificationEvent({
          organizationId,
          projectId: null,
          eventType: "morning_plan.overload",
          sourceType: "morning_plan",
          sourceId: `${person.id}:${weekStart}`,
          title: "Your week is over capacity",
          body: `This week holds ${load.assignedWorkdays} workdays of assigned work for ${load.availableWorkdays} available.${
            load.suggestions.length > 0 ? ` Could move: ${load.suggestions.map((item) => item.title).join("; ")}.` : ""
          }`,
          href: "/dashboard#todays-plan",
          priority: "normal",
          audience: "staff",
          recipients,
          delivery: { inApp: true, email: false, push: false },
        })
        warnings += 1
      }
    }
  }
  return { digests, warnings }
}
