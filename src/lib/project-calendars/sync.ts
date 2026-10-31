import "server-only"

import { and, eq, gte, inArray } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  compassProjectCalendarEvents,
  compassProjectCalendarMembers,
  compassProjectCalendars,
  organizationCalendarSettings,
  organizationMembers,
  projectClientMeetings,
  projectMembers,
  projects,
  scheduleTasks,
  users,
  workCalendarEvents,
} from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { chunkD1Values } from "@/lib/d1-query"
import { isDemoUser } from "@/lib/demo"
import {
  insertMissingProjectCalendars,
  updateProjectCalendar,
  updateProjectCalendars,
} from "@/lib/domain/calendars/store"
import { getCompassGmailAccessToken } from "@/lib/email/compass-email"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { ProjectCalendarSettings } from "@/lib/feature-settings/registry"
import { calendarFetch, GoogleCalendarHttpError, isGoneError } from "@/lib/google/calendar/compass-calendar-fetch"
import { addDays } from "@/lib/my-compass-calendar/items"
import { appBaseUrl, workspaceEmailFor } from "@/lib/my-compass-calendar/sync"
import {
  clientMeetingItem,
  projectCalendarName,
  projectEventBody,
  projectItemHash,
  scheduleTaskItem,
  workEventItem,
  type ProjectCalendarItem,
} from "@/lib/project-calendars/items"
import { isInternalStaffRole } from "@/lib/user-roles"

type Db = ReturnType<typeof getDb>

/** Make calendars and manage events on the calendars Compass made. */
const APP_CREATED_SCOPE = "https://www.googleapis.com/auth/calendar.app.created"
/** Share those calendars with staff. */
const ACL_SCOPE = "https://www.googleapis.com/auth/calendar.acls"
/** Add a shared calendar to a staff member's calendar list. */
const CALENDAR_LIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist"
export const PROJECT_CALENDAR_OWNER_SCOPES = [APP_CREATED_SCOPE, ACL_SCOPE] as const

const OPEN_PROJECT_STATUSES = ["OPEN", "WARRANTY"] as const
/** Projects synced per run, and Google writes per run and per project. */
const PROJECTS_PER_RUN = 20
const WRITES_PER_RUN = 400
const WRITES_PER_PROJECT = 150
/** A project is re-synced at most this often. */
const RESYNC_MS = 5 * 60_000

export type ProjectCalendarRow = typeof compassProjectCalendars.$inferSelect

export type ProjectCalendarSweepSummary = {
  readonly synced: number
  readonly removed: number
  readonly created: number
  readonly updated: number
  readonly deleted: number
  readonly shared: number
  readonly unshared: number
  readonly failed: number
}

type Counts = { created: number; updated: number; deleted: number; shared: number; unshared: number; writes: number }

/** Whether this project should have a calendar under the company setting. */
export function projectCalendarIncluded(
  settings: ProjectCalendarSettings,
  project: { readonly status: string | null },
  row: { readonly enabled: boolean | null } | null
): boolean {
  if (settings.mode === "off") return false
  if (row?.enabled === false) return false
  if (row?.enabled === true) return true
  return settings.mode === "open" && OPEN_PROJECT_STATUSES.some((status) => status === project.status)
}

function eventOverlaps(
  event: {
    readonly allDay: boolean
    readonly startDate: string | null
    readonly endDateExclusive: string | null
    readonly startsAt: string | null
    readonly endsAt: string | null
    readonly recurrence: string
    readonly recurrenceUntil: string | null
  },
  windowStart: string,
  windowEnd: string
): boolean {
  const start = (event.allDay ? event.startDate : event.startsAt)?.slice(0, 10)
  if (!start || start > windowEnd) return false
  if (event.recurrence !== "none") return !event.recurrenceUntil || event.recurrenceUntil >= windowStart
  const end = (event.allDay ? event.endDateExclusive : event.endsAt)?.slice(0, 10) ?? start
  return end >= windowStart
}

/** Everything that belongs on the project's calendar right now. */
async function desiredProjectItems(input: {
  readonly db: Db
  readonly projectId: string
  readonly settings: ProjectCalendarSettings
  readonly baseUrl: string
  readonly now: Date
  /** The company's time zone, for schedule items with a time. */
  readonly timeZone?: string
}): Promise<readonly ProjectCalendarItem[]> {
  const { db, settings, projectId, baseUrl } = input
  const today = input.now.toISOString().slice(0, 10)
  const windowStart = addDays(today, -settings.daysBack)
  const windowEnd = addDays(today, settings.daysAhead)
  const items: ProjectCalendarItem[] = []

  if (settings.milestones || settings.scheduleItems) {
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
        status: scheduleTasks.status,
        startTime: scheduleTasks.startTime,
        endTime: scheduleTasks.endTime,
      })
      .from(scheduleTasks)
      .where(eq(scheduleTasks.projectId, projectId))
    for (const task of tasks) {
      if (task.endDate < windowStart || task.startDate > windowEnd) continue
      if (task.isMilestone ? !settings.milestones : !settings.scheduleItems) continue
      items.push(scheduleTaskItem({ baseUrl, task, timeZone: input.timeZone }))
    }
  }

  if (settings.workCalendarEvents) {
    const events = await db
      .select()
      .from(workCalendarEvents)
      .where(and(eq(workCalendarEvents.projectId, projectId), eq(workCalendarEvents.status, "open")))
    for (const event of events) {
      // Private and invite-only events stay with the people involved.
      if (event.visibility !== "organization") continue
      if (!eventOverlaps(event, windowStart, windowEnd)) continue
      const item = workEventItem({ baseUrl, projectId, event })
      if (item) items.push(item)
    }
  }

  if (settings.clientMeetings) {
    const meetings = await db
      .select({
        id: projectClientMeetings.id,
        projectId: projectClientMeetings.projectId,
        title: projectClientMeetings.title,
        note: projectClientMeetings.note,
        startsAt: projectClientMeetings.startsAt,
        endsAt: projectClientMeetings.endsAt,
        timeZone: projectClientMeetings.timeZone,
        meetingUrl: projectClientMeetings.meetingUrl,
        organizerEmail: projectClientMeetings.organizerEmail,
      })
      .from(projectClientMeetings)
      .where(
        and(
          eq(projectClientMeetings.projectId, projectId),
          eq(projectClientMeetings.status, "scheduled"),
          gte(projectClientMeetings.endsAt, `${windowStart}T00:00:00.000Z`)
        )
      )
    for (const meeting of meetings) {
      if (meeting.startsAt.slice(0, 10) > windowEnd) continue
      items.push(clientMeetingItem({ baseUrl, meeting }))
    }
  }

  return items
}

/** Staff who should see this project's calendar, by Google address. */
async function desiredProjectMembers(input: {
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string
  readonly settings: ProjectCalendarSettings
  readonly workspaceDomain: string
  readonly ownerEmail: string
}): Promise<ReadonlyMap<string, string>> {
  const { db, settings } = input
  const staff = await db
    .select({
      id: users.id,
      email: users.email,
      googleEmail: users.googleEmail,
      isActive: users.isActive,
      role: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, input.organizationId))
  const team =
    settings.shareWith === "project"
      ? new Set(
          (
            await db
              .select({ userId: projectMembers.userId })
              .from(projectMembers)
              .where(eq(projectMembers.projectId, input.projectId))
          ).map((row) => row.userId)
        )
      : null
  const owner = input.ownerEmail.toLowerCase()
  const members = new Map<string, string>()
  for (const person of staff) {
    // Sharing follows the company membership role, so clients and vendors on
    // the project never get the calendar.
    if (!person.isActive || isDemoUser(person.id) || !isInternalStaffRole(person.role)) continue
    if (settings.excludedUserIds.includes(person.id)) continue
    if (team && !team.has(person.id)) continue
    const email = workspaceEmailFor(person, input.workspaceDomain)
    if (!email || email === owner) continue
    members.set(person.id, email)
  }
  return members
}

type OwnerToken = { readonly accessToken: string; readonly email: string }

async function ownerToken(db: Db, env: unknown, organizationId: string, email?: string): Promise<OwnerToken> {
  const token = await getCompassGmailAccessToken({
    env,
    db,
    organizationId,
    scopes: [...PROJECT_CALENDAR_OWNER_SCOPES],
    sender: email,
  })
  if (!token.success) throw new Error(token.error)
  return { accessToken: token.accessToken, email: token.sender.toLowerCase() }
}

async function addToCalendarList(input: {
  readonly db: Db
  readonly env: unknown
  readonly organizationId: string
  readonly email: string
  readonly calendarId: string
}): Promise<boolean> {
  const token = await getCompassGmailAccessToken({
    env: input.env,
    db: input.db,
    organizationId: input.organizationId,
    scopes: [CALENDAR_LIST_SCOPE],
    sender: input.email,
  })
  if (!token.success) return false
  try {
    await calendarFetch(token.accessToken, "/users/me/calendarList", {
      method: "POST",
      body: JSON.stringify({ id: input.calendarId, selected: true }),
    })
    return true
  } catch (error) {
    // Already on their list.
    return error instanceof GoogleCalendarHttpError && error.status === 409
  }
}

async function removeFromCalendarList(input: {
  readonly db: Db
  readonly env: unknown
  readonly organizationId: string
  readonly email: string
  readonly calendarId: string
}): Promise<void> {
  const token = await getCompassGmailAccessToken({
    env: input.env,
    db: input.db,
    organizationId: input.organizationId,
    scopes: [CALENDAR_LIST_SCOPE],
    sender: input.email,
  })
  if (!token.success) return
  await calendarFetch(
    token.accessToken,
    `/users/me/calendarList/${encodeURIComponent(input.calendarId)}`,
    { method: "DELETE" }
  ).catch(() => undefined)
}

function calendarIdOf(payload: unknown): string {
  const id = typeof payload === "object" && payload !== null ? Reflect.get(payload, "id") : null
  if (typeof id !== "string") throw new Error("Google returned a calendar without an id")
  return id
}

function eventIdOf(payload: unknown): string {
  const id = typeof payload === "object" && payload !== null ? Reflect.get(payload, "id") : null
  if (typeof id !== "string") throw new Error("Google returned an event without an id")
  return id
}

/** Brings one project's Google calendar, events and sharing in line with Compass. */
export async function syncProjectCalendar(input: {
  readonly db: Db
  readonly env: unknown
  readonly settings: ProjectCalendarSettings
  readonly workspaceDomain: string
  readonly timeZone: string
  readonly project: { readonly id: string; readonly organizationId: string; readonly name: string; readonly projectNumber: string | null }
  readonly owner: OwnerToken
  readonly writeBudget: number
  readonly now?: Date
}): Promise<Counts> {
  const { db, project, owner } = input
  const now = input.now ?? new Date()
  const counts: Counts = { created: 0, updated: 0, deleted: 0, shared: 0, unshared: 0, writes: 0 }
  const budget = Math.min(WRITES_PER_PROJECT, input.writeBudget)
  const row = await db
    .select()
    .from(compassProjectCalendars)
    .where(eq(compassProjectCalendars.projectId, project.id))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!row) return counts
  const name = projectCalendarName(project)
  let calendarId = row.googleCalendarId

  if (!calendarId) {
    const created = await calendarFetch(owner.accessToken, "/calendars", {
      method: "POST",
      body: JSON.stringify({
        summary: name,
        description:
          "This job's schedule, events and client meetings, kept up to date by Compass and shared with staff on the job. Make changes in Compass; edits made here are replaced.",
        timeZone: input.timeZone,
      }),
    })
    calendarId = calendarIdOf(created)
    counts.writes += 1
    // Anything tracked belonged to an earlier calendar that's gone now.
    await db.delete(compassProjectCalendarEvents).where(eq(compassProjectCalendarEvents.projectId, project.id))
    await db.delete(compassProjectCalendarMembers).where(eq(compassProjectCalendarMembers.projectId, project.id))
    await updateProjectCalendar(db, project.id, { googleCalendarId: calendarId, ownerEmail: owner.email, calendarName: name, status: "active", updatedAt: now.toISOString() })
  } else if (row.calendarName !== name) {
    try {
      await calendarFetch(owner.accessToken, `/calendars/${encodeURIComponent(calendarId)}`, {
        method: "PATCH",
        body: JSON.stringify({ summary: name }),
      })
    } catch (error) {
      if (isGoneError(error)) return recreate(input, counts)
      throw error
    }
    counts.writes += 1
    await updateProjectCalendar(db, project.id, { calendarName: name, updatedAt: now.toISOString() })
  }
  const calendarPath = `/calendars/${encodeURIComponent(calendarId)}`
  let complete = true

  // Sharing first, so staff can see the calendar while events fill in.
  const desiredMembers = await desiredProjectMembers({
    db,
    organizationId: project.organizationId,
    projectId: project.id,
    settings: input.settings,
    workspaceDomain: input.workspaceDomain,
    ownerEmail: owner.email,
  })
  const tracked = await db
    .select()
    .from(compassProjectCalendarMembers)
    .where(eq(compassProjectCalendarMembers.projectId, project.id))
  const trackedByUser = new Map(tracked.map((member) => [member.userId, member]))
  for (const [userId, email] of desiredMembers) {
    const current = trackedByUser.get(userId)
    if (current && current.email === email) {
      if (input.settings.addToStaffCalendars && !current.listedAt) {
        if (await addToCalendarList({ db, env: input.env, organizationId: project.organizationId, email, calendarId })) {
          await db
            .update(compassProjectCalendarMembers)
            .set({ listedAt: now.toISOString(), updatedAt: now.toISOString() })
            .where(eq(compassProjectCalendarMembers.id, current.id))
        }
      }
      continue
    }
    if (counts.writes >= budget) {
      complete = false
      break
    }
    let rule: unknown
    try {
      rule = await calendarFetch(owner.accessToken, `${calendarPath}/acl?sendNotifications=false`, {
        method: "POST",
        body: JSON.stringify({ role: "reader", scope: { type: "user", value: email } }),
      })
    } catch (error) {
      if (isGoneError(error)) return recreate(input, counts)
      throw error
    }
    counts.writes += 1
    counts.shared += 1
    const listed =
      input.settings.addToStaffCalendars &&
      (await addToCalendarList({ db, env: input.env, organizationId: project.organizationId, email, calendarId }))
    const stamp = now.toISOString()
    const values = {
      email,
      aclRuleId: eventIdOf(rule),
      listedAt: listed ? stamp : null,
      updatedAt: stamp,
    }
    if (current) {
      await db.update(compassProjectCalendarMembers).set(values).where(eq(compassProjectCalendarMembers.id, current.id))
    } else {
      await db
        .insert(compassProjectCalendarMembers)
        .values({ id: crypto.randomUUID(), projectId: project.id, userId, createdAt: stamp, ...values })
    }
  }
  for (const member of tracked) {
    if (desiredMembers.get(member.userId) === member.email) continue
    if (desiredMembers.has(member.userId)) continue // Address changed; re-shared above.
    if (counts.writes >= budget) {
      complete = false
      break
    }
    try {
      await calendarFetch(owner.accessToken, `${calendarPath}/acl/${encodeURIComponent(member.aclRuleId)}`, { method: "DELETE" })
    } catch (error) {
      if (!isGoneError(error)) throw error
    }
    counts.writes += 1
    counts.unshared += 1
    if (member.listedAt) {
      await removeFromCalendarList({ db, env: input.env, organizationId: project.organizationId, email: member.email, calendarId })
    }
    await db.delete(compassProjectCalendarMembers).where(eq(compassProjectCalendarMembers.id, member.id))
  }

  const desired = await desiredProjectItems({
    db,
    projectId: project.id,
    settings: input.settings,
    baseUrl: appBaseUrl(input.env),
    now,
    timeZone: input.timeZone,
  })
  const existing = await db
    .select()
    .from(compassProjectCalendarEvents)
    .where(eq(compassProjectCalendarEvents.projectId, project.id))
  const existingByKey = new Map(existing.map((item) => [item.itemKey, item]))
  const desiredKeys = new Set(desired.map((item) => item.key))
  const eventsPath = `${calendarPath}/events`

  for (const item of desired) {
    if (counts.writes >= budget) {
      complete = false
      break
    }
    const hash = await projectItemHash(item)
    const current = existingByKey.get(item.key)
    if (current && current.contentHash === hash) continue
    counts.writes += 1
    const stamp = new Date().toISOString()
    if (current) {
      try {
        await calendarFetch(owner.accessToken, `${eventsPath}/${encodeURIComponent(current.googleEventId)}`, {
          method: "PUT",
          body: projectEventBody(item),
        })
        await db
          .update(compassProjectCalendarEvents)
          .set({ contentHash: hash, updatedAt: stamp })
          .where(eq(compassProjectCalendarEvents.id, current.id))
        counts.updated += 1
        continue
      } catch (error) {
        // Deleted in Google: put it back below, since Compass owns the calendar.
        if (!isGoneError(error)) throw error
        await db.delete(compassProjectCalendarEvents).where(eq(compassProjectCalendarEvents.id, current.id))
      }
    }
    let created: unknown
    try {
      created = await calendarFetch(owner.accessToken, eventsPath, { method: "POST", body: projectEventBody(item) })
    } catch (error) {
      if (isGoneError(error)) return recreate(input, counts)
      throw error
    }
    await db.insert(compassProjectCalendarEvents).values({
      id: crypto.randomUUID(),
      projectId: project.id,
      itemKey: item.key,
      googleEventId: eventIdOf(created),
      contentHash: hash,
      createdAt: stamp,
      updatedAt: stamp,
    })
    counts.created += 1
  }

  for (const item of existing) {
    if (desiredKeys.has(item.itemKey)) continue
    if (counts.writes >= budget) {
      complete = false
      break
    }
    counts.writes += 1
    try {
      await calendarFetch(owner.accessToken, `${eventsPath}/${encodeURIComponent(item.googleEventId)}`, { method: "DELETE" })
    } catch (error) {
      if (!isGoneError(error)) throw error
    }
    await db.delete(compassProjectCalendarEvents).where(eq(compassProjectCalendarEvents.id, item.id))
    counts.deleted += 1
  }

  await updateProjectCalendar(db, project.id, {
    status: "active",
    // Leave the time unset while writes remain, so the next run picks this project up first.
    lastSyncedAt: complete ? now.toISOString() : row.lastSyncedAt,
    lastError: null,
    updatedAt: now.toISOString(),
  })
  return counts
}

/** The calendar was deleted in Google; start a new one on the next run. */
async function recreate(
  input: { readonly db: Db; readonly project: { readonly id: string } },
  counts: Counts
): Promise<Counts> {
  await updateProjectCalendar(input.db, input.project.id, { googleCalendarId: null, calendarName: null, status: "pending", lastSyncedAt: null, updatedAt: new Date().toISOString() })
  return counts
}

/** Deletes the project's calendar from Google and forgets its events and sharing. */
export async function removeProjectCalendar(input: {
  readonly db: Db
  readonly env: unknown
  readonly row: ProjectCalendarRow
}): Promise<void> {
  const { db, row } = input
  if (row.googleCalendarId) {
    const owner = await ownerToken(db, input.env, row.organizationId, row.ownerEmail ?? undefined)
    try {
      // Deleting the calendar also removes it from every staff member's list.
      await calendarFetch(owner.accessToken, `/calendars/${encodeURIComponent(row.googleCalendarId)}`, { method: "DELETE" })
    } catch (error) {
      if (!isGoneError(error)) throw error
    }
  }
  await db.delete(compassProjectCalendarEvents).where(eq(compassProjectCalendarEvents.projectId, row.projectId))
  await db.delete(compassProjectCalendarMembers).where(eq(compassProjectCalendarMembers.projectId, row.projectId))
  await updateProjectCalendar(db, row.projectId, { googleCalendarId: null, calendarName: null, status: "pending", lastSyncedAt: null, lastError: null, updatedAt: new Date().toISOString() })
}

export async function organizationTimeZone(db: Db, organizationId: string): Promise<string> {
  const [setting] = await db
    .select({ timeZone: organizationCalendarSettings.timeZone })
    .from(organizationCalendarSettings)
    .where(eq(organizationCalendarSettings.organizationId, organizationId))
    .limit(1)
  return setting?.timeZone ?? "America/Denver"
}

/**
 * Scheduled: keeps every included project's calendar current. Each run
 * handles the projects synced longest ago, within a budget of Google writes.
 */
export async function sweepProjectCalendars(db: Db, env: unknown, now = new Date()): Promise<ProjectCalendarSweepSummary> {
  const summary = { synced: 0, removed: 0, created: 0, updated: 0, deleted: 0, shared: 0, unshared: 0, failed: 0 }
  const workspaces = await db
    .select({ organizationId: googleAuth.organizationId, domain: googleAuth.workspaceDomain })
    .from(googleAuth)
  let writeBudget = WRITES_PER_RUN
  for (const workspace of workspaces) {
    const organizationId = workspace.organizationId
    const settings = await readFeatureSettings(db, organizationId, "project-calendars")
    const rows = await db
      .select()
      .from(compassProjectCalendars)
      .where(eq(compassProjectCalendars.organizationId, organizationId))
    if (settings.mode === "off" && rows.every((row) => !row.googleCalendarId)) continue

    // Candidates: open jobs (when every open job gets one) plus jobs with a row.
    // Rows are matched in JS, not with an id list in SQL (D1 allows 100 bound
    // parameters per query).
    const candidates = await db
      .select({ id: projects.id, name: projects.name, projectNumber: projects.projectNumber, status: projects.status })
      .from(projects)
      .where(
        settings.mode === "open"
          ? and(eq(projects.organizationId, organizationId), inArray(projects.status, [...OPEN_PROJECT_STATUSES]))
          : eq(projects.organizationId, organizationId)
      )
    const rowByProject = new Map(rows.map((row) => [row.projectId, row]))
    const projectById = new Map(candidates.map((project) => [project.id, project]))
    const included = new Set(
      candidates
        .filter((project) => projectCalendarIncluded(settings, project, rowByProject.get(project.id) ?? null))
        .map((project) => project.id)
    )
    // Rows for staff-chosen jobs that aren't open still count in "open" mode.
    // One chunked read for all of them rather than one query per row.
    const chosenIds = rows
      .filter((row) => row.enabled === true && settings.mode !== "off" && !projectById.has(row.projectId))
      .map((row) => row.projectId)
    for (const chunk of chunkD1Values(chosenIds)) {
      const chosen = await db
        .select({ id: projects.id, name: projects.name, projectNumber: projects.projectNumber, status: projects.status })
        .from(projects)
        .where(inArray(projects.id, chunk))
      for (const project of chosen) {
        projectById.set(project.id, project)
        included.add(project.id)
      }
    }

    const stamp = now.toISOString()
    await insertMissingProjectCalendars(db, {
      organizationId,
      projectIds: [...included].filter((projectId) => !rowByProject.has(projectId)),
      now: stamp,
    })

    // Jobs no longer included (closed, turned off, or the feature is off)
    // have their calendar deleted from Google.
    // One Google calendar delete at a time, within the run's write budget
    // (rate-limited outside API), so this loop is intentional.
    for (const row of rows) {
      if (included.has(row.projectId) || !row.googleCalendarId) continue
      if (writeBudget <= 0) break
      writeBudget -= 1
      try {
        await removeProjectCalendar({ db, env, row })
        summary.removed += 1
      } catch (error) {
        summary.failed += 1
        await updateProjectCalendar(db, row.projectId, { status: "error", lastError: errorText(error), updatedAt: stamp })
      }
    }
    if (included.size === 0 || writeBudget <= 0) continue

    const cutoff = new Date(now.getTime() - RESYNC_MS).toISOString()
    const due = (
      await db
        .select({ projectId: compassProjectCalendars.projectId, lastSyncedAt: compassProjectCalendars.lastSyncedAt })
        .from(compassProjectCalendars)
        .where(eq(compassProjectCalendars.organizationId, organizationId))
        .orderBy(compassProjectCalendars.lastSyncedAt)
    )
      .filter((row) => included.has(row.projectId) && (!row.lastSyncedAt || row.lastSyncedAt < cutoff))
      .slice(0, PROJECTS_PER_RUN)
    if (due.length === 0) continue

    const timeZone = await organizationTimeZone(db, organizationId)
    const owners = new Map<string, OwnerToken>()
    let defaultOwner: OwnerToken
    try {
      defaultOwner = await ownerToken(db, env, organizationId)
    } catch (error) {
      summary.failed += 1
      await updateProjectCalendars(
        db,
        due.map((row) => row.projectId),
        { status: "error", lastError: errorText(error), lastSyncedAt: stamp, updatedAt: stamp }
      )
      continue
    }
    owners.set(defaultOwner.email, defaultOwner)

    for (const { projectId } of due) {
      if (writeBudget <= 0) break
      const project = projectById.get(projectId)
      if (!project) continue
      try {
        const row = rowByProject.get(projectId)
        // A calendar stays with the account that made it.
        const ownerEmail = row?.googleCalendarId && row.ownerEmail ? row.ownerEmail.toLowerCase() : defaultOwner.email
        let owner = owners.get(ownerEmail)
        if (!owner) {
          owner = await ownerToken(db, env, organizationId, ownerEmail)
          owners.set(ownerEmail, owner)
        }
        const counts = await syncProjectCalendar({
          db,
          env,
          settings,
          workspaceDomain: workspace.domain,
          timeZone,
          project: { ...project, organizationId },
          owner,
          writeBudget,
          now,
        })
        writeBudget -= counts.writes
        summary.synced += 1
        summary.created += counts.created
        summary.updated += counts.updated
        summary.deleted += counts.deleted
        summary.shared += counts.shared
        summary.unshared += counts.unshared
      } catch (error) {
        summary.failed += 1
        await updateProjectCalendar(db, projectId, { status: "error", lastError: errorText(error), lastSyncedAt: stamp, updatedAt: stamp })
      }
    }
  }
  return summary
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : "Project calendar sync failed").slice(0, 500)
}
