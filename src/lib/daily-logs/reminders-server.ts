import { and, desc, eq, gte, inArray, lte, ne } from "drizzle-orm"
import type { getDb } from "@/db"
import {
  dailyLogReminders,
  dailyLogs,
  notificationPreferences,
  organizationMembers,
  projects,
  scheduleTasks,
  users,
  workCalendarEventAttendees,
  workCalendarEvents,
} from "@/db/schema"
import { internalDutyEntries } from "@/db/schema-internal-duties"
import { companyTimeZone } from "@/lib/daily-logs/log-followups-server"
import {
  isFieldRole,
  isWorkDay,
  reminderBody,
  reminderTimeFor,
  type DailyLogReminderRules,
} from "@/lib/daily-logs/reminders"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { createSystemNotificationEvent } from "@/lib/notifications/create-event"
import { shiftDateKey } from "@/lib/project-timeline/model"
import { isInternalStaffRole } from "@/lib/user-roles"
import { dateKeyInTimeZone, timeKeyInTimeZone } from "@/lib/work-calendar"

type Db = ReturnType<typeof getDb>

export const MISSING_DAILY_LOG_EVENT = "daily_log.missing"

/** Someone on staff with no daily log or duty entry on a day they were expected to log. */
export type MissingDailyLogPerson = {
  readonly userId: string
  readonly name: string
  readonly email: string
  readonly role: string
  /** HH:MM they're reminded at. */
  readonly time: string
  /** Where the reminder points: the job they were scheduled on, else where they last logged. */
  readonly projectId: string | null
  readonly projectLabel: string | null
  readonly scheduled: boolean
}

function chunks<T>(values: readonly T[], size = 80): readonly (readonly T[])[] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, index * size + size))
}

function displayName(row: { readonly displayName: string | null; readonly firstName: string | null; readonly lastName: string | null; readonly email: string }): string {
  return row.displayName?.trim() || [row.firstName, row.lastName].filter(Boolean).join(" ") || row.email
}

function projectLabel(row: { readonly name: string; readonly projectNumber: string | null }): string {
  return row.projectNumber ? `${row.projectNumber} · ${row.name}` : row.name
}

/** People away on an Absence that covers the date (attendees, or whoever made it). */
async function absentOn(db: Db, organizationId: string, date: string): Promise<ReadonlySet<string>> {
  const events = await db
    .select({
      id: workCalendarEvents.id,
      allDay: workCalendarEvents.allDay,
      startDate: workCalendarEvents.startDate,
      endDateExclusive: workCalendarEvents.endDateExclusive,
      startsAt: workCalendarEvents.startsAt,
      endsAt: workCalendarEvents.endsAt,
      createdBy: workCalendarEvents.createdBy,
    })
    .from(workCalendarEvents)
    .where(
      and(
        eq(workCalendarEvents.organizationId, organizationId),
        eq(workCalendarEvents.eventType, "absence"),
        ne(workCalendarEvents.status, "cancelled"),
      ),
    )
  const covering = events.filter((event) => {
    if (event.allDay && event.startDate) {
      return event.startDate <= date && date < (event.endDateExclusive ?? shiftDateKey(event.startDate, 1))
    }
    if (event.startsAt) {
      return event.startsAt.slice(0, 10) <= date && date <= (event.endsAt ?? event.startsAt).slice(0, 10)
    }
    return false
  })
  if (covering.length === 0) return new Set()
  const attendees = (
    await Promise.all(
      chunks(covering.map((event) => event.id)).map((ids) =>
        db
          .select({ eventId: workCalendarEventAttendees.eventId, userId: workCalendarEventAttendees.userId })
          .from(workCalendarEventAttendees)
          .where(inArray(workCalendarEventAttendees.eventId, [...ids])),
      ),
    )
  ).flat()
  const absent = new Set<string>()
  for (const event of covering) {
    const people = attendees.filter((row) => row.eventId === event.id)
    if (people.length > 0) for (const person of people) absent.add(person.userId)
    else if (event.createdBy) absent.add(event.createdBy)
  }
  return absent
}

/**
 * Staff who should have written a daily log on `date` and haven't. A log on
 * any job or workspace, or a duty log entry, counts.
 */
export async function staffMissingDailyLogs(
  db: Db,
  organizationId: string,
  date: string,
  rules: DailyLogReminderRules,
): Promise<readonly MissingDailyLogPerson[]> {
  if (!isWorkDay(date, rules.workDays)) return []
  const members = await db
    .select({
      userId: users.id,
      role: organizationMembers.role,
      email: users.email,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
      personalTime: notificationPreferences.dailyLogReminderTime,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .leftJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(users.isActive, true)))
  // Staff only, by their role in this company: never clients, subs or suppliers.
  let staff = members.filter((member) => isInternalStaffRole(member.role))
  if (rules.audience === "field_staff") staff = staff.filter((member) => isFieldRole(member.role))
  if (staff.length === 0) return []
  const staffIds = staff.map((member) => member.userId)

  const [logged, dutyLogged, absent, scheduled] = await Promise.all([
    Promise.all(
      chunks(staffIds).map((ids) =>
        db.select({ userId: dailyLogs.authorId }).from(dailyLogs).where(and(eq(dailyLogs.logDate, date), inArray(dailyLogs.authorId, [...ids]))),
      ),
    ),
    Promise.all(
      chunks(staffIds).map((ids) =>
        db
          .select({ userId: internalDutyEntries.userId })
          .from(internalDutyEntries)
          .where(and(eq(internalDutyEntries.entryDate, date), inArray(internalDutyEntries.userId, [...ids]))),
      ),
    ),
    rules.skipAbsences ? absentOn(db, organizationId, date) : Promise.resolve(new Set<string>()),
    db
      .select({ userId: scheduleTasks.assignedUserId, projectId: projects.id, name: projects.name, projectNumber: projects.projectNumber })
      .from(scheduleTasks)
      .innerJoin(projects, eq(projects.id, scheduleTasks.projectId))
      .where(
        and(
          eq(projects.organizationId, organizationId),
          lte(scheduleTasks.startDate, date),
          gte(scheduleTasks.endDateCalculated, date),
          ne(scheduleTasks.status, "COMPLETE"),
        ),
      ),
  ])
  const done = new Set<string>()
  for (const row of [...logged.flat(), ...dutyLogged.flat()]) if (row.userId) done.add(row.userId)
  const scheduledProject = new Map<string, { readonly id: string; readonly label: string }>()
  for (const row of scheduled) {
    if (row.userId && !scheduledProject.has(row.userId)) scheduledProject.set(row.userId, { id: row.projectId, label: projectLabel(row) })
  }

  const missing = staff.filter((member) => !done.has(member.userId) && !absent.has(member.userId))
  const candidates = rules.audience === "scheduled_staff" ? missing.filter((member) => scheduledProject.has(member.userId)) : missing
  if (candidates.length === 0) return []

  // Where each person last logged, for people with nothing scheduled.
  const since = shiftDateKey(date, -30)
  const recent = (
    await Promise.all(
      chunks(candidates.filter((member) => !scheduledProject.has(member.userId)).map((member) => member.userId)).map((ids) =>
        db
          .select({ userId: dailyLogs.authorId, projectId: projects.id, name: projects.name, projectNumber: projects.projectNumber, logDate: dailyLogs.logDate })
          .from(dailyLogs)
          .innerJoin(projects, eq(projects.id, dailyLogs.projectId))
          .where(and(inArray(dailyLogs.authorId, [...ids]), gte(dailyLogs.logDate, since), lte(dailyLogs.logDate, date)))
          .orderBy(desc(dailyLogs.logDate)),
      ),
    )
  ).flat()
  const lastProject = new Map<string, { readonly id: string; readonly label: string }>()
  for (const row of recent) {
    if (row.userId && !lastProject.has(row.userId)) lastProject.set(row.userId, { id: row.projectId, label: projectLabel(row) })
  }

  return candidates
    .map((member) => {
      const scheduledOn = scheduledProject.get(member.userId)
      const project = scheduledOn ?? lastProject.get(member.userId) ?? null
      return {
        userId: member.userId,
        name: displayName(member),
        email: member.email,
        role: member.role,
        time: reminderTimeFor(rules, member.role, member.personalTime),
        projectId: project?.id ?? null,
        projectLabel: project?.label ?? null,
        scheduled: scheduledOn !== undefined,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Scheduled every few minutes: remind each person once, at or after their
 * time, on a day they haven't logged. Honors each company's settings.
 */
export async function sendMissingDailyLogReminders(db: Db, now: Date = new Date()): Promise<{ readonly reminded: number }> {
  const orgs = await db.selectDistinct({ organizationId: organizationMembers.organizationId }).from(organizationMembers)
  let reminded = 0
  for (const { organizationId } of orgs) {
    const rules = await readFeatureSettings(db, organizationId, "daily-log-reminders")
    if (!rules.enabled) continue
    const timeZone = await companyTimeZone(db, organizationId)
    const date = dateKeyInTimeZone(now, timeZone)
    const clock = timeKeyInTimeZone(now, timeZone)
    if (!isWorkDay(date, rules.workDays)) continue
    // Nothing to do before the earliest possible reminder time.
    if (!rules.staffPickOwnTime && clock < rules.officeTime && clock < rules.fieldTime) continue
    const due = (await staffMissingDailyLogs(db, organizationId, date, rules)).filter((person) => person.time <= clock)
    if (due.length === 0) continue
    const already = new Set(
      (
        await Promise.all(
          chunks(due.map((person) => person.userId)).map((ids) =>
            db
              .select({ userId: dailyLogReminders.userId })
              .from(dailyLogReminders)
              .where(and(eq(dailyLogReminders.reminderDate, date), inArray(dailyLogReminders.userId, [...ids]))),
          ),
        )
      )
        .flat()
        .map((row) => row.userId),
    )
    for (const person of due) {
      if (already.has(person.userId)) continue
      // Claim the day first, so an overlapping run can't remind twice.
      const claimed = await db
        .insert(dailyLogReminders)
        .values({ userId: person.userId, reminderDate: date, organizationId, remindedAt: now.toISOString() })
        .onConflictDoNothing()
        .returning({ userId: dailyLogReminders.userId })
      if (claimed.length === 0) continue
      await createSystemNotificationEvent({
        organizationId,
        projectId: person.projectId,
        eventType: MISSING_DAILY_LOG_EVENT,
        sourceType: "daily_log_reminder",
        sourceId: `${person.userId}:${date}`,
        title: "Daily log",
        body: reminderBody(person.projectLabel, person.scheduled),
        href: person.projectId
          ? `/dashboard/projects/${encodeURIComponent(person.projectId)}/daily-logs?quickAdd=daily-log`
          : "/dashboard/projects",
        priority: "normal",
        audience: "daily_log_author",
        recipients: [{ userId: person.userId, email: person.email }],
        delivery: { inApp: true, email: false, push: true },
      })
      reminded += 1
    }
  }
  return { reminded }
}

/** Recent work days and who was missing a daily log on each, newest first (not today). */
export async function recentMissingDailyLogs(
  db: Db,
  organizationId: string,
  options: { readonly workDays?: number; readonly now?: Date } = {},
): Promise<readonly { readonly date: string; readonly people: readonly MissingDailyLogPerson[] }[]> {
  const rules = await readFeatureSettings(db, organizationId, "daily-log-reminders")
  if (!rules.adminMissingList || rules.workDays.length === 0) return []
  const timeZone = await companyTimeZone(db, organizationId)
  const today = dateKeyInTimeZone(options.now ?? new Date(), timeZone)
  const days: string[] = []
  for (let back = 1; days.length < (options.workDays ?? 5) && back <= 21; back += 1) {
    const date = shiftDateKey(today, -back)
    if (isWorkDay(date, rules.workDays)) days.push(date)
  }
  const results = await Promise.all(days.map(async (date) => ({ date, people: await staffMissingDailyLogs(db, organizationId, date, rules) })))
  return results.filter((day) => day.people.length > 0)
}
