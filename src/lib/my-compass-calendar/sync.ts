import "server-only"

import { and, eq, gte, inArray, isNull, lt, lte, ne, or } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  myCompassCalendarItems,
  myCompassCalendars,
  organizationCalendarSettings,
  organizationMembers,
  projectMembers,
  projectOperations,
  projects,
  scheduleTasks,
  users,
} from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { isDemoUser } from "@/lib/demo"
import { getCompassGmailAccessToken } from "@/lib/email/compass-email"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { MyCompassCalendarSettings } from "@/lib/feature-settings/registry"
import { createGoogleCalendar } from "@/lib/google/calendar/client"
import { calendarFetch, GoogleCalendarHttpError } from "@/lib/google/calendar/compass-calendar-fetch"
import {
  addDays,
  assignmentIncludes,
  itemHash,
  personAliases,
  scheduleItem,
  todoItem,
  type MyCompassItem,
} from "@/lib/my-compass-calendar/items"
import { isInternalStaffRole } from "@/lib/user-roles"

type Db = ReturnType<typeof getDb>

/** Lets Compass make calendars and manage only the calendars it made. */
const MY_COMPASS_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created"
const MY_COMPASS_CALENDAR_NAME = "My Compass"
const OPEN_PROJECT_STATUSES = ["OPEN", "WARRANTY"] as const
const OPEN_TODO_STATUSES = ["incomplete", "open", "in_progress"] as const
const TODO_RECORD_TYPES = ["todo", "staff_task", "task"] as const
/** People synced per run, and Google writes per person per run. */
const USERS_PER_RUN = 6
const WRITES_PER_USER = 120
/** A person is re-synced at most this often. */
const RESYNC_MS = 5 * 60_000

export type MyCompassSweepSummary = {
  readonly synced: number
  readonly created: number
  readonly updated: number
  readonly deleted: number
  readonly failed: number
}

function eventBody(item: MyCompassItem): string {
  return JSON.stringify({
    summary: item.summary,
    description: item.description,
    ...(item.timed
      ? {
          start: { dateTime: item.timed.startsAt, timeZone: item.timed.timeZone },
          end: { dateTime: item.timed.endsAt, timeZone: item.timed.timeZone },
        }
      : { start: { date: item.startDate }, end: { date: item.endDateExclusive } }),
    // Assignments shouldn't block the person's free/busy time or ping them.
    transparency: "transparent",
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: { private: { compassItemKey: item.key } },
  })
}

function eventId(payload: unknown): string {
  const id = typeof payload === "object" && payload !== null ? Reflect.get(payload, "id") : null
  if (typeof id !== "string") throw new Error("Google returned an event without an id")
  return id
}

export function appBaseUrl(env: unknown): string {
  const configured = typeof env === "object" && env !== null ? Reflect.get(env, "COMPASS_APP_URL") : null
  return typeof configured === "string" && configured.trim()
    ? configured.trim().replace(/\/$/, "")
    : "https://compass.openrangeconstruction.ltd"
}

function parseNames(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

/** The address Compass acts as in Google, or null when it isn't a Workspace account. */
export function workspaceEmailFor(
  user: { readonly email: string; readonly googleEmail: string | null },
  workspaceDomain: string
): string | null {
  const email = (user.googleEmail ?? user.email).trim().toLowerCase()
  return email.endsWith(`@${workspaceDomain.trim().toLowerCase()}`) ? email : null
}

export function userIsEligible(
  settings: MyCompassCalendarSettings,
  user: { readonly id: string; readonly role: string; readonly isActive: boolean }
): boolean {
  if (settings.mode === "off" || !user.isActive || isDemoUser(user.id)) return false
  if (!isInternalStaffRole(user.role)) return false
  return settings.mode === "on" || settings.pilotUserIds.includes(user.id)
}

/** Everything that belongs on this person's calendar right now. */
async function desiredItems(input: {
  readonly db: Db
  readonly organizationId: string
  readonly settings: MyCompassCalendarSettings
  readonly baseUrl: string
  readonly now: Date
  readonly user: {
    readonly id: string
    readonly email: string
    readonly googleEmail: string | null
    readonly displayName: string | null
    readonly firstName: string | null
    readonly lastName: string | null
  }
  readonly otherNames: readonly string[]
  /** The company's time zone, for schedule items with a time. */
  readonly timeZone?: string
}): Promise<readonly MyCompassItem[]> {
  const { db, settings, user } = input
  const today = input.now.toISOString().slice(0, 10)
  const windowStart = addDays(today, -settings.daysBack)
  const windowEnd = addDays(today, settings.daysAhead)
  const aliases = personAliases({ ...user, otherNames: input.otherNames })

  const openProjects = await db
    .select({ id: projects.id, name: projects.name, projectNumber: projects.projectNumber })
    .from(projects)
    .where(and(eq(projects.organizationId, input.organizationId), inArray(projects.status, [...OPEN_PROJECT_STATUSES])))
  if (openProjects.length === 0) return []
  const projectById = new Map(openProjects.map((project) => [project.id, project]))
  // Filter by joining projects, not by listing ids: D1 allows 100 bound
  // parameters per query and a company can have more open jobs than that.
  const openProjectFilter = and(
    eq(projects.organizationId, input.organizationId),
    inArray(projects.status, [...OPEN_PROJECT_STATUSES])
  )
  const items: MyCompassItem[] = []

  if (settings.scheduleItems || settings.projectMilestones) {
    const memberOf = settings.projectMilestones
      ? new Set(
          (
            await db
              .select({ projectId: projectMembers.projectId })
              .from(projectMembers)
              .where(eq(projectMembers.userId, user.id))
          ).map((row) => row.projectId)
        )
      : new Set<string>()
    const tasks = await db
      .select({
        id: scheduleTasks.id,
        projectId: scheduleTasks.projectId,
        title: scheduleTasks.title,
        startDate: scheduleTasks.startDate,
        endDate: scheduleTasks.endDateCalculated,
        phase: scheduleTasks.phase,
        isMilestone: scheduleTasks.isMilestone,
        assignedTo: scheduleTasks.assignedTo,
        assignedUserId: scheduleTasks.assignedUserId,
        startTime: scheduleTasks.startTime,
        endTime: scheduleTasks.endTime,
      })
      .from(scheduleTasks)
      .innerJoin(projects, eq(projects.id, scheduleTasks.projectId))
      .where(
        and(
          openProjectFilter,
          ne(scheduleTasks.status, "COMPLETE"),
          gte(scheduleTasks.endDateCalculated, windowStart),
          lte(scheduleTasks.startDate, windowEnd)
        )
      )
    for (const task of tasks) {
      const project = projectById.get(task.projectId)
      if (!project) continue
      const assigned =
        settings.scheduleItems &&
        (task.assignedUserId === user.id || assignmentIncludes(task.assignedTo, aliases))
      const milestone = settings.projectMilestones && task.isMilestone && memberOf.has(task.projectId)
      if (assigned || milestone) {
        items.push(scheduleItem({ baseUrl: input.baseUrl, task, project, timeZone: input.timeZone }))
      }
    }
  }

  if (settings.todos) {
    const todos = await db
      .select({
        id: projectOperations.id,
        projectId: projectOperations.projectId,
        title: projectOperations.title,
        dueDate: projectOperations.dueDate,
        assigneeName: projectOperations.assigneeName,
      })
      .from(projectOperations)
      .innerJoin(projects, eq(projects.id, projectOperations.projectId))
      .where(
        and(
          openProjectFilter,
          inArray(projectOperations.sourceRecordType, [...TODO_RECORD_TYPES]),
          inArray(projectOperations.status, [...OPEN_TODO_STATUSES]),
          gte(projectOperations.dueDate, windowStart),
          lte(projectOperations.dueDate, windowEnd)
        )
      )
    for (const todo of todos) {
      const project = projectById.get(todo.projectId)
      if (!project || !todo.dueDate || !assignmentIncludes(todo.assigneeName, aliases)) continue
      items.push(todoItem({ baseUrl: input.baseUrl, todo: { ...todo, dueDate: todo.dueDate }, project }))
    }
  }

  return items
}

type SyncCounts = { created: number; updated: number; deleted: number }

/** Brings one person's calendar in line with Compass. */
export async function syncMyCompassCalendar(input: {
  readonly db: Db
  readonly env: unknown
  readonly settings: MyCompassCalendarSettings
  readonly workspaceDomain: string
  readonly timeZone: string
  readonly userId: string
  readonly now?: Date
}): Promise<SyncCounts> {
  const { db, settings } = input
  const now = input.now ?? new Date()
  const counts: SyncCounts = { created: 0, updated: 0, deleted: 0 }
  const row = await db
    .select({
      calendar: myCompassCalendars,
      user: {
        id: users.id,
        email: users.email,
        googleEmail: users.googleEmail,
        displayName: users.displayName,
        firstName: users.firstName,
        lastName: users.lastName,
      },
    })
    .from(myCompassCalendars)
    .innerJoin(users, eq(users.id, myCompassCalendars.userId))
    .where(eq(myCompassCalendars.userId, input.userId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!row || !row.calendar.enabled || row.calendar.status === "removed") return counts
  const { calendar, user } = row
  const email = workspaceEmailFor(user, input.workspaceDomain)
  if (!email) throw new Error(`This account isn't a ${input.workspaceDomain} Google account.`)

  const token = await getCompassGmailAccessToken({
    env: input.env,
    db,
    organizationId: calendar.organizationId,
    scopes: [MY_COMPASS_CALENDAR_SCOPE],
    sender: email,
  })
  if (!token.success) throw new Error(token.error)
  const accessToken = token.accessToken

  let calendarId = calendar.googleCalendarId
  if (calendarId && calendar.googleEmail !== email) {
    // The person's Google address changed; start a calendar in the new account.
    calendarId = null
    await db.delete(myCompassCalendarItems).where(eq(myCompassCalendarItems.userId, user.id))
  }
  if (calendarId) {
    try {
      await calendarFetch(accessToken, `/calendars/${encodeURIComponent(calendarId)}`)
    } catch (error) {
      if (error instanceof GoogleCalendarHttpError && (error.status === 404 || error.status === 410)) {
        // They deleted it in Google. Respect that until they turn it back on.
        await db
          .update(myCompassCalendars)
          .set({ status: "removed", googleCalendarId: null, lastError: null, updatedAt: now.toISOString() })
          .where(eq(myCompassCalendars.userId, user.id))
        await db.delete(myCompassCalendarItems).where(eq(myCompassCalendarItems.userId, user.id))
        return counts
      }
      throw error
    }
  } else {
    const created = await createGoogleCalendar(accessToken, {
      summary: MY_COMPASS_CALENDAR_NAME,
      description:
        "Your Compass schedule items and to-dos, kept up to date by Compass. Make changes in Compass; edits made here are replaced.",
      timeZone: input.timeZone,
    })
    calendarId = created.id
    await db
      .update(myCompassCalendars)
      .set({ googleCalendarId: calendarId, googleEmail: email, status: "active", updatedAt: now.toISOString() })
      .where(eq(myCompassCalendars.userId, user.id))
  }

  const desired = await desiredItems({
    db,
    organizationId: calendar.organizationId,
    settings,
    baseUrl: appBaseUrl(input.env),
    now,
    user,
    otherNames: parseNames(calendar.otherNames),
    timeZone: input.timeZone,
  })
  const existing = await db
    .select()
    .from(myCompassCalendarItems)
    .where(eq(myCompassCalendarItems.userId, user.id))
  const existingByKey = new Map(existing.map((item) => [item.itemKey, item]))
  const desiredKeys = new Set(desired.map((item) => item.key))
  const events = `/calendars/${encodeURIComponent(calendarId)}/events`
  let writes = 0
  let complete = true

  for (const item of desired) {
    if (writes >= WRITES_PER_USER) {
      complete = false
      break
    }
    const hash = await itemHash(item)
    const current = existingByKey.get(item.key)
    if (current && current.contentHash === hash) continue
    writes += 1
    const stamp = new Date().toISOString()
    if (current) {
      try {
        await calendarFetch(accessToken, `${events}/${encodeURIComponent(current.googleEventId)}`, {
          method: "PUT",
          body: eventBody(item),
        })
        await db
          .update(myCompassCalendarItems)
          .set({ contentHash: hash, updatedAt: stamp })
          .where(eq(myCompassCalendarItems.id, current.id))
        counts.updated += 1
        continue
      } catch (error) {
        // Deleted in Google: put it back below, since Compass owns the calendar.
        if (!(error instanceof GoogleCalendarHttpError && (error.status === 404 || error.status === 410))) throw error
        await db.delete(myCompassCalendarItems).where(eq(myCompassCalendarItems.id, current.id))
      }
    }
    const created = await calendarFetch(accessToken, events, { method: "POST", body: eventBody(item) })
    await db.insert(myCompassCalendarItems).values({
      id: crypto.randomUUID(),
      userId: user.id,
      itemKey: item.key,
      googleEventId: eventId(created),
      contentHash: hash,
      createdAt: stamp,
      updatedAt: stamp,
    })
    counts.created += 1
  }

  for (const item of existing) {
    if (desiredKeys.has(item.itemKey)) continue
    if (writes >= WRITES_PER_USER) {
      complete = false
      break
    }
    writes += 1
    try {
      await calendarFetch(accessToken, `${events}/${encodeURIComponent(item.googleEventId)}`, { method: "DELETE" })
    } catch (error) {
      if (!(error instanceof GoogleCalendarHttpError && (error.status === 404 || error.status === 410))) throw error
    }
    await db.delete(myCompassCalendarItems).where(eq(myCompassCalendarItems.id, item.id))
    counts.deleted += 1
  }

  await db
    .update(myCompassCalendars)
    .set({
      status: "active",
      // Leave the time unset while writes remain, so the next run picks this person up first.
      lastSyncedAt: complete ? now.toISOString() : calendar.lastSyncedAt,
      lastError: null,
      updatedAt: now.toISOString(),
    })
    .where(eq(myCompassCalendars.userId, user.id))
  return counts
}

/** Removes the calendar from the person's Google account and forgets its items. */
export async function removeMyCompassCalendar(input: {
  readonly db: Db
  readonly env: unknown
  readonly userId: string
  readonly status: "removed" | "pending"
}): Promise<void> {
  const row = await input.db
    .select()
    .from(myCompassCalendars)
    .where(eq(myCompassCalendars.userId, input.userId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!row) return
  if (row.googleCalendarId && row.googleEmail) {
    const token = await getCompassGmailAccessToken({
      env: input.env,
      db: input.db,
      organizationId: row.organizationId,
      scopes: [MY_COMPASS_CALENDAR_SCOPE],
      sender: row.googleEmail,
    })
    if (!token.success) throw new Error(token.error)
    try {
      await calendarFetch(token.accessToken, `/calendars/${encodeURIComponent(row.googleCalendarId)}`, { method: "DELETE" })
    } catch (error) {
      if (!(error instanceof GoogleCalendarHttpError && (error.status === 404 || error.status === 410))) throw error
    }
  }
  await input.db.delete(myCompassCalendarItems).where(eq(myCompassCalendarItems.userId, input.userId))
  await input.db
    .update(myCompassCalendars)
    .set({ googleCalendarId: null, status: input.status, lastSyncedAt: null, lastError: null, updatedAt: new Date().toISOString() })
    .where(eq(myCompassCalendars.userId, input.userId))
}

/**
 * Scheduled: keeps every eligible person's My Compass calendar current.
 * Each run handles the people synced longest ago, a few at a time.
 */
export async function sweepMyCompassCalendars(db: Db, env: unknown, now = new Date()): Promise<MyCompassSweepSummary> {
  const summary = { synced: 0, created: 0, updated: 0, deleted: 0, failed: 0 }
  const workspaces = await db
    .select({ organizationId: googleAuth.organizationId, domain: googleAuth.workspaceDomain })
    .from(googleAuth)
  for (const workspace of workspaces) {
    const settings = await readFeatureSettings(db, workspace.organizationId, "my-compass-calendar")
    const timeZone =
      (
        await db
          .select({ timeZone: organizationCalendarSettings.timeZone })
          .from(organizationCalendarSettings)
          .where(eq(organizationCalendarSettings.organizationId, workspace.organizationId))
          .limit(1)
      )[0]?.timeZone ?? "America/Denver"
    const members = await db
      .select({
        id: users.id,
        email: users.email,
        googleEmail: users.googleEmail,
        role: users.role,
        isActive: users.isActive,
      })
      .from(users)
      .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
      .where(eq(organizationMembers.organizationId, workspace.organizationId))
    const eligible = members.filter(
      (member) => userIsEligible(settings, member) && workspaceEmailFor(member, workspace.domain) !== null
    )
    const eligibleIds = new Set(eligible.map((member) => member.id))

    const rows = await db
      .select()
      .from(myCompassCalendars)
      .where(eq(myCompassCalendars.organizationId, workspace.organizationId))
    const known = new Set(rows.map((row) => row.userId))
    const stamp = now.toISOString()
    for (const member of eligible) {
      if (known.has(member.id)) continue
      await db
        .insert(myCompassCalendars)
        .values({ userId: member.id, organizationId: workspace.organizationId, createdAt: stamp, updatedAt: stamp })
        .onConflictDoNothing()
    }

    // People no longer included (setting turned off, left the test group,
    // or left the company) have their calendar removed from Google.
    for (const row of rows) {
      if (eligibleIds.has(row.userId) || !row.googleCalendarId) continue
      try {
        await removeMyCompassCalendar({ db, env, userId: row.userId, status: "pending" })
      } catch (error) {
        summary.failed += 1
        await db
          .update(myCompassCalendars)
          .set({ lastError: errorText(error), updatedAt: stamp })
          .where(eq(myCompassCalendars.userId, row.userId))
      }
    }
    if (eligible.length === 0) continue

    // Eligibility is filtered here rather than with an id list in SQL (D1's
    // 100-parameter limit); the table holds one row per person.
    const due = (
      await db
        .select({ userId: myCompassCalendars.userId })
        .from(myCompassCalendars)
        .where(
          and(
            eq(myCompassCalendars.organizationId, workspace.organizationId),
            eq(myCompassCalendars.enabled, true),
            ne(myCompassCalendars.status, "removed"),
            or(isNull(myCompassCalendars.lastSyncedAt), lt(myCompassCalendars.lastSyncedAt, new Date(now.getTime() - RESYNC_MS).toISOString()))
          )
        )
        .orderBy(myCompassCalendars.lastSyncedAt)
    )
      .filter((row) => eligibleIds.has(row.userId))
      .slice(0, USERS_PER_RUN)
    for (const { userId } of due) {
      try {
        const counts = await syncMyCompassCalendar({
          db,
          env,
          settings,
          workspaceDomain: workspace.domain,
          timeZone,
          userId,
          now,
        })
        summary.synced += 1
        summary.created += counts.created
        summary.updated += counts.updated
        summary.deleted += counts.deleted
      } catch (error) {
        summary.failed += 1
        await db
          .update(myCompassCalendars)
          .set({ status: "error", lastError: errorText(error), lastSyncedAt: now.toISOString(), updatedAt: now.toISOString() })
          .where(eq(myCompassCalendars.userId, userId))
      }
    }
  }
  return summary
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : "My Compass calendar sync failed").slice(0, 500)
}
