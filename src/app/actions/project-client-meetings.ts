"use server"

import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  organizationMembers,
  projectClientMeetings,
  projects,
  users,
} from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { recordActivityEvent } from "@/lib/activity-log"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { getCompassGmailAccessToken } from "@/lib/email/compass-email"
import { projectEmailRecipientOptions } from "@/lib/email/project-recipient-options"
import {
  isValidRecipientEmail,
  normalizeRecipientEmail,
  type EmailRecipientOption,
} from "@/lib/email/recipient-options"
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
} from "@/lib/google/calendar/client"
import { createNotificationEvent } from "@/lib/notifications/create-event"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { assertProjectAccess } from "@/lib/project-access"
import { projectNumberAndName } from "@/lib/project-display-name"
import { isInternalStaffRole } from "@/lib/user-roles"

const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events"
const MEET_SETTINGS_SCOPE = "https://www.googleapis.com/auth/meetings.space.settings"
const MAX_GUESTS = 50
const MIN_DURATION_MINUTES = 15
const MAX_DURATION_MINUTES = 480

type ActionResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string }

export type ProjectClientMeetingItem = {
  readonly id: string
  readonly title: string
  readonly note: string | null
  readonly startsAt: string
  readonly endsAt: string
  readonly timeZone: string
  readonly organizerName: string
  readonly organizerUserId: string
  readonly guestEmails: readonly string[]
  readonly staffEmails: readonly string[]
  readonly meetingUrl: string | null
  readonly status: "scheduled" | "cancelled"
  readonly canCancel: boolean
  /** null until the call has ended and Compass has looked for a transcript. */
  readonly transcript: TranscriptState | null
  /** The internal draft daily log made from the transcript. */
  readonly dailyLogHref: string | null
}

export type TranscriptState =
  | { readonly status: "pending" }
  | { readonly status: "saved"; readonly url: string | null }
  | { readonly status: "none" }
  | { readonly status: "error"; readonly message: string }

function transcriptState(meeting: typeof projectClientMeetings.$inferSelect): TranscriptState | null {
  switch (meeting.transcriptStatus) {
    case "pending":
      return { status: "pending" }
    case "saved":
      return { status: "saved", url: meeting.transcriptUrl }
    case "none":
      return { status: "none" }
    case "error":
      return { status: "error", message: meeting.transcriptError ?? "Transcript import failed" }
    default:
      return null
  }
}

export type ProjectClientMeetingsView = {
  readonly meetings: readonly ProjectClientMeetingItem[]
  readonly guestOptions: readonly EmailRecipientOption[]
  readonly staffOptions: readonly EmailRecipientOption[]
  readonly canSchedule: boolean
  readonly defaultTitle: string
}

export type ScheduleProjectClientMeetingInput = {
  readonly title: string
  readonly note: string
  /** null starts the meeting now. */
  readonly startsAt: string | null
  readonly durationMinutes: number
  readonly timeZone: string
  readonly guestEmails: readonly string[]
  readonly staffEmails: readonly string[]
  /** Ask Google to start the transcript when the call starts. */
  readonly autoTranscribe: boolean
}

type MeetingAccess = {
  readonly db: ReturnType<typeof getDb>
  readonly env: CloudflareEnv
  readonly user: AuthUser
  readonly organizationId: string
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly clientName: string | null
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

async function meetingAccess(
  projectId: string,
  mutate: boolean
): Promise<MeetingAccess> {
  const user = await requireAuth()
  if (mutate && isDemoUser(user.id)) throw new Error("DEMO_READ_ONLY")
  if (!isInternalStaffRole(user.role)) throw new Error("Permission denied")
  await requireFeaturePermission(user, "schedule", mutate ? "update" : "read")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  await assertProjectAccess(db, user, projectId)
  const project = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      clientName: projects.clientName,
    })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!project) throw new Error("Project not found")
  return { db, env, user, organizationId, project }
}

function parseEmailList(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : []
  } catch {
    return []
  }
}

function cleanEmails(values: readonly string[]): readonly string[] {
  const cleaned = new Set<string>()
  for (const value of values) {
    const email = normalizeRecipientEmail(value)
    if (!isValidRecipientEmail(email)) {
      throw new Error(`${value.trim() || "An invitee"} is not a valid email address`)
    }
    cleaned.add(email)
  }
  return Array.from(cleaned)
}

function displayName(row: {
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
  readonly email: string
}): string {
  const full = [row.firstName, row.lastName].filter(Boolean).join(" ").trim()
  return row.displayName?.trim() || full || row.email
}

/**
 * The organizer hosts from their own Google Calendar, so their Compass
 * account must map to an address in the connected Workspace domain.
 */
async function organizerWorkspaceEmail(
  access: MeetingAccess
): Promise<string> {
  const workspace = await access.db
    .select({ domain: googleAuth.workspaceDomain })
    .from(googleAuth)
    .where(eq(googleAuth.organizationId, access.organizationId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!workspace) {
    throw new Error("Connect Google Workspace in Settings before booking Google Meet calls.")
  }
  const email = normalizeRecipientEmail(access.user.googleEmail ?? access.user.email)
  if (!email.endsWith(`@${workspace.domain.toLowerCase()}`)) {
    throw new Error(
      `Your Compass account isn't linked to a ${workspace.domain} Google account, so Compass can't host a Meet from your calendar.`
    )
  }
  return email
}

async function delegatedCalendarToken(
  access: MeetingAccess,
  organizerEmail: string
): Promise<string> {
  const token = await getCompassGmailAccessToken({
    env: access.env,
    db: access.db,
    organizationId: access.organizationId,
    scopes: [CALENDAR_EVENTS_SCOPE],
    sender: organizerEmail,
  })
  if (!token.success) throw new Error(token.error)
  return token.accessToken
}

function meetingTimes(input: ScheduleProjectClientMeetingInput): {
  readonly startsAt: string
  readonly endsAt: string
} {
  const duration = Math.round(input.durationMinutes)
  if (
    !Number.isFinite(duration) ||
    duration < MIN_DURATION_MINUTES ||
    duration > MAX_DURATION_MINUTES
  ) {
    throw new Error("Choose a meeting length between 15 minutes and 8 hours")
  }
  const now = Date.now()
  const start = input.startsAt === null ? now : Date.parse(input.startsAt)
  if (!Number.isFinite(start)) throw new Error("Choose a valid start time")
  // A few minutes of slack lets someone book a meeting that is just starting.
  if (start < now - 10 * 60_000) throw new Error("Choose a start time in the future")
  if (start > now + 366 * 24 * 60 * 60_000) {
    throw new Error("Meetings can be booked up to a year ahead")
  }
  return {
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + duration * 60_000).toISOString(),
  }
}

async function staffDirectory(
  access: MeetingAccess
): Promise<readonly { readonly userId: string; readonly email: string; readonly name: string }[]> {
  const rows = await access.db
    .select({
      id: users.id,
      email: users.email,
      googleEmail: users.googleEmail,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
    })
    .from(users)
    .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
    .where(
      and(
        eq(organizationMembers.organizationId, access.organizationId),
        eq(users.isActive, true)
      )
    )
  return rows
    .filter((row) => isInternalStaffRole(row.role) && !isDemoUser(row.id))
    .map((row) => ({
      userId: row.id,
      email: normalizeRecipientEmail(row.googleEmail ?? row.email),
      name: displayName(row),
    }))
    .filter((row) => isValidRecipientEmail(row.email))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Turns on Meet's automatic transcript for the meeting's space, so nobody
 * has to remember to press Transcribe. Google announces it to everyone.
 */
async function enableAutoTranscription(
  access: MeetingAccess,
  organizerEmail: string,
  meetingUrl: string
): Promise<void> {
  const meetingCode = new URL(meetingUrl).pathname.replace(/^\/+/, "")
  const token = await getCompassGmailAccessToken({
    env: access.env,
    db: access.db,
    organizationId: access.organizationId,
    scopes: [MEET_SETTINGS_SCOPE],
    sender: organizerEmail,
  })
  if (!token.success) throw new Error(token.error)
  const headers = { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/json" }
  const space: unknown = await fetch(
    `https://meet.googleapis.com/v2/spaces/${encodeURIComponent(meetingCode)}`,
    { headers }
  ).then((response) => (response.ok ? response.json() : null))
  const name = typeof space === "object" && space !== null ? Reflect.get(space, "name") : null
  if (typeof name !== "string") throw new Error("Google Meet did not return the meeting space")
  const mask = "config.artifactConfig.transcriptionConfig.autoTranscriptionGeneration"
  const response = await fetch(
    `https://meet.googleapis.com/v2/${name}?updateMask=${encodeURIComponent(mask)}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        config: { artifactConfig: { transcriptionConfig: { autoTranscriptionGeneration: "ON" } } },
      }),
    }
  )
  if (!response.ok) throw new Error(`Google Meet did not turn on the transcript (${response.status})`)
}

export async function getProjectClientMeetings(
  projectId: string
): Promise<ActionResult<ProjectClientMeetingsView>> {
  try {
    const access = await meetingAccess(projectId, false)
    const [rows, guestOptions, staff] = await Promise.all([
      access.db
        .select({
          meeting: projectClientMeetings,
          displayName: users.displayName,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        })
        .from(projectClientMeetings)
        .innerJoin(users, eq(users.id, projectClientMeetings.organizerUserId))
        .where(eq(projectClientMeetings.projectId, projectId))
        .orderBy(desc(projectClientMeetings.startsAt))
        .limit(50),
      projectEmailRecipientOptions(access.db, projectId, [access.project.clientName]),
      staffDirectory(access),
    ])
    const canSchedule = !isDemoUser(access.user.id)
    return {
      success: true,
      data: {
        meetings: rows.map(({ meeting, ...organizer }) => ({
          id: meeting.id,
          title: meeting.title,
          note: meeting.note,
          startsAt: meeting.startsAt,
          endsAt: meeting.endsAt,
          timeZone: meeting.timeZone,
          organizerName: displayName(organizer),
          organizerUserId: meeting.organizerUserId,
          guestEmails: parseEmailList(meeting.guestEmails),
          staffEmails: parseEmailList(meeting.staffEmails),
          meetingUrl: meeting.status === "scheduled" ? meeting.meetingUrl : null,
          status: meeting.status === "cancelled" ? "cancelled" : "scheduled",
          canCancel: canSchedule && meeting.status === "scheduled",
          transcript: transcriptState(meeting),
          dailyLogHref: meeting.dailyLogId
            ? `/dashboard/projects/${encodeURIComponent(projectId)}/daily-logs#daily-log-${encodeURIComponent(meeting.dailyLogId)}`
            : null,
        })),
        // Clients first: owner contacts are the people these calls are for.
        guestOptions: guestOptions.filter((option) => option.category !== "internal"),
        staffOptions: staff
          .filter((person) => person.userId !== access.user.id)
          .map((person) => ({
            id: person.userId,
            email: person.email,
            displayName: person.name,
            companyName: null,
            category: "internal",
            recommended: false,
          })),
        canSchedule,
        defaultTitle: `${projectNumberAndName(access.project)} - project meeting`,
      },
    }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to load project meetings") }
  }
}

export async function scheduleProjectClientMeeting(
  projectId: string,
  input: ScheduleProjectClientMeetingInput
): Promise<
  ActionResult<{ readonly id: string; readonly meetingUrl: string | null; readonly warning: string | null }>
> {
  try {
    const access = await meetingAccess(projectId, true)
    const title = input.title.trim()
    if (!title) throw new Error("Give the meeting a title")
    if (title.length > 200) throw new Error("Title must be 200 characters or fewer")
    const note = input.note.trim()
    if (note.length > 4_000) throw new Error("Note must be 4,000 characters or fewer")
    const timeZone = input.timeZone.trim() || "America/Denver"
    const guestEmails = cleanEmails(input.guestEmails)
    const organizerEmail = await organizerWorkspaceEmail(access)
    const staffEmails = cleanEmails(input.staffEmails).filter(
      (email) => email !== organizerEmail && !guestEmails.includes(email)
    )
    // Meetings can be with clients, vendors, or only staff.
    if (guestEmails.length + staffEmails.length === 0) throw new Error("Invite at least one person")
    if (guestEmails.length + staffEmails.length > MAX_GUESTS) {
      throw new Error(`A meeting can include up to ${MAX_GUESTS} invitees`)
    }
    const times = meetingTimes(input)
    const projectLabel = projectNumberAndName(access.project)
    const accessToken = await delegatedCalendarToken(access, organizerEmail)

    const id = crypto.randomUUID()
    // Google sends the invitations (sendUpdates=all) so the meeting lands on
    // each guest's own calendar with the Meet link and dial-in details.
    const googleEvent = await createGoogleCalendarEvent(accessToken, "primary", {
      summary: title,
      description: [note, `Scheduled in Compass for ${projectLabel}.`]
        .filter(Boolean)
        .join("\n\n"),
      location: null,
      startDate: null,
      endDateExclusive: null,
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      timeZone,
      visibility: "default",
      recurrence: [],
      attendeeEmails: [...guestEmails, ...staffEmails],
      conferenceRequestId: id,
    })

    const now = new Date().toISOString()
    await access.db.insert(projectClientMeetings).values({
      id,
      organizationId: access.organizationId,
      projectId,
      organizerUserId: access.user.id,
      organizerEmail,
      title,
      note: note || null,
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      timeZone,
      guestEmails: JSON.stringify(guestEmails),
      staffEmails: JSON.stringify(staffEmails),
      googleEventId: googleEvent.id,
      meetingUrl: googleEvent.meetingUrl,
      status: "scheduled",
      createdAt: now,
      updatedAt: now,
    })

    await recordActivityEvent({
      db: access.db,
      organizationId: access.organizationId,
      projectId,
      actor: access.user,
      category: "schedule",
      action: input.startsAt === null ? "client_meeting_started" : "client_meeting_scheduled",
      entityType: "project_client_meeting",
      entityId: id,
      summary: `${input.startsAt === null ? "Started" : "Scheduled"} Google Meet "${title}" with ${[...guestEmails, ...staffEmails].join(", ")}`,
      metadata: {
        guests: guestEmails.join(", "),
        staff: staffEmails.join(", "),
        startsAt: times.startsAt,
      },
    })
    await notifyInvitedStaff(access, {
      meetingId: id,
      title,
      staffEmails,
      projectLabel,
      change: "invited",
    })

    let warning: string | null = null
    if (input.autoTranscribe && googleEvent.meetingUrl) {
      try {
        await enableAutoTranscription(access, organizerEmail, googleEvent.meetingUrl)
      } catch (error) {
        // The meeting is booked either way; someone can press Transcribe in Meet.
        console.error("Could not turn on automatic Meet transcription:", error)
        warning = "Compass couldn't turn on the transcript automatically. Press Transcribe in Meet when the call starts."
      }
    }

    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true, data: { id, meetingUrl: googleEvent.meetingUrl, warning } }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to book the Google Meet") }
  }
}

export async function cancelProjectClientMeeting(
  projectId: string,
  meetingId: string
): Promise<ActionResult<null>> {
  try {
    const access = await meetingAccess(projectId, true)
    const meeting = await access.db
      .select()
      .from(projectClientMeetings)
      .where(
        and(
          eq(projectClientMeetings.id, meetingId),
          eq(projectClientMeetings.projectId, projectId),
          eq(projectClientMeetings.organizationId, access.organizationId)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!meeting) throw new Error("Meeting not found")
    if (meeting.status === "cancelled") return { success: true, data: null }

    // Delete from the organizer's calendar so Google tells every guest.
    if (meeting.googleEventId) {
      const accessToken = await delegatedCalendarToken(access, meeting.organizerEmail)
      await deleteGoogleCalendarEvent(accessToken, "primary", meeting.googleEventId)
    }
    const now = new Date().toISOString()
    await access.db
      .update(projectClientMeetings)
      .set({
        status: "cancelled",
        cancelledBy: access.user.id,
        cancelledAt: now,
        updatedAt: now,
      })
      .where(eq(projectClientMeetings.id, meetingId))

    await recordActivityEvent({
      db: access.db,
      organizationId: access.organizationId,
      projectId,
      actor: access.user,
      category: "schedule",
      action: "client_meeting_cancelled",
      entityType: "project_client_meeting",
      entityId: meetingId,
      summary: `Cancelled Google Meet "${meeting.title}"`,
    })
    await notifyInvitedStaff(access, {
      meetingId,
      title: meeting.title,
      staffEmails: parseEmailList(meeting.staffEmails),
      projectLabel: projectNumberAndName(access.project),
      change: "cancelled",
    })

    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to cancel the meeting") }
  }
}

async function notifyInvitedStaff(
  access: MeetingAccess,
  input: {
    readonly meetingId: string
    readonly title: string
    readonly staffEmails: readonly string[]
    readonly projectLabel: string
    readonly change: "invited" | "cancelled"
  }
): Promise<void> {
  if (input.staffEmails.length === 0) return
  try {
    const invited = new Set(input.staffEmails)
    const recipients = (await staffDirectory(access))
      .filter((person) => invited.has(person.email) && person.userId !== access.user.id)
      .map((person) => ({ userId: person.userId, email: person.email }))
    if (recipients.length === 0) return
    const actorName = access.user.displayName ?? access.user.email
    await createNotificationEvent({
      organizationId: access.organizationId,
      projectId: access.project.id,
      eventType: input.change === "invited" ? "schedule.event_created" : "schedule.event_cancelled",
      sourceType: "project_client_meeting",
      sourceId: input.meetingId,
      title: `${input.title} ${input.change === "invited" ? "scheduled" : "cancelled"}`,
      body:
        input.change === "invited"
          ? `${actorName} invited you to a project Google Meet for ${input.projectLabel}.`
          : `${actorName} cancelled the project Google Meet for ${input.projectLabel}.`,
      href: `/dashboard/projects/${access.project.id}`,
      priority: "normal",
      audience: "attendees",
      createdBy: access.user.id,
      recipients,
      delivery: { inApp: true, email: false, push: true },
    })
  } catch (error) {
    // The meeting is booked even if a notification provider is unavailable.
    console.error("Failed to notify staff about a project meeting:", error)
  }
}
