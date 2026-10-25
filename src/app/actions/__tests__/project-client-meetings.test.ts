import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCloudflareContext: vi.fn(),
  token: vi.fn(),
  createEvent: vi.fn(),
  deleteEvent: vi.fn(),
  notify: vi.fn(),
  activity: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, getCurrentUser: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/lib/permission-enforcement", () => ({ requireFeaturePermission: vi.fn(async () => {}) }))
vi.mock("@/lib/project-access", () => ({ assertProjectAccess: vi.fn(async () => ({})) }))
vi.mock("@/lib/email/compass-email", () => ({ getCompassGmailAccessToken: mocks.token }))
vi.mock("@/lib/google/calendar/client", () => ({
  createGoogleCalendarEvent: mocks.createEvent,
  deleteGoogleCalendarEvent: mocks.deleteEvent,
}))
vi.mock("@/lib/notifications/create-event", () => ({ createNotificationEvent: mocks.notify }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.activity }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import {
  cancelProjectClientMeeting,
  getClientMeetingTranscript,
  getProjectClientMeetings,
  scheduleProjectClientMeeting,
  type ScheduleProjectClientMeetingInput,
} from "../project-client-meetings"
import {
  openCorrespondenceTestDatabase,
  type CorrespondenceTestDatabase,
} from "../../../../__tests__/helpers/correspondence-core"

let database: CorrespondenceTestDatabase | null = null

afterEach(() => {
  database?.close()
  database = null
  vi.clearAllMocks()
})

function open(email = "staff-a@example.test"): CorrespondenceTestDatabase {
  const opened = openCorrespondenceTestDatabase()
  const { sqlite } = opened
  sqlite.exec("ALTER TABLE users ADD COLUMN google_email TEXT")
  sqlite.exec("ALTER TABLE projects ADD COLUMN client_name TEXT")
  sqlite.exec("UPDATE projects SET client_name = 'Owner A' WHERE id = 'project-a'")
  sqlite.exec(`
    CREATE TABLE google_auth (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, service_account_key_encrypted TEXT NOT NULL,
      workspace_domain TEXT NOT NULL, shared_drive_id TEXT, shared_drive_name TEXT,
      connected_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO google_auth VALUES ('ga','org-a','enc','example.test',NULL,NULL,'staff-a','x','x');
    INSERT INTO project_contacts (id, project_id, contact_type, display_name, email, company_name)
      VALUES ('c-owner','project-a','owner','Owner A','client@home.test',NULL);
  `)
  sqlite.exec("CREATE TABLE daily_logs (id TEXT PRIMARY KEY)")
  for (const file of ["0246_project_client_meetings.sql", "0247_client_meeting_transcripts.sql", "0249_client_meeting_daily_logs.sql", "0251_client_meeting_transcript_text.sql"]) {
    sqlite.exec(
      readFileSync(resolve(process.cwd(), "drizzle", file), "utf8").replaceAll("--> statement-breakpoint", "")
    )
  }
  mocks.getCloudflareContext.mockResolvedValue({ env: { DB: opened.d1 } })
  mocks.requireAuth.mockResolvedValue({
    id: "staff-a",
    email,
    googleEmail: null,
    displayName: "Staff A",
    role: "admin",
    organizationId: "org-a",
    isActive: true,
  })
  mocks.token.mockResolvedValue({ success: true, accessToken: "token", sender: email })
  mocks.createEvent.mockResolvedValue({ id: "google-event-1", meetingUrl: "https://meet.google.com/abc-defg-hij" })
  mocks.deleteEvent.mockResolvedValue(undefined)
  database = opened
  return opened
}

function input(overrides: Partial<ScheduleProjectClientMeetingInput> = {}): ScheduleProjectClientMeetingInput {
  return {
    title: "A-1 - Project A - client meeting",
    note: "Walk through the selections.",
    startsAt: null,
    durationMinutes: 30,
    timeZone: "America/Denver",
    guestEmails: ["Client@Home.test"],
    staffEmails: ["staff-b@example.test"],
    autoTranscribe: false,
    ...overrides,
  }
}

describe("project client meetings", () => {
  it("books a Meet on the organizer's own calendar and invites guests and staff", async () => {
    const db = open()
    const result = await scheduleProjectClientMeeting("project-a", input())

    expect(result).toEqual({
      success: true,
      data: { id: expect.any(String), meetingUrl: "https://meet.google.com/abc-defg-hij", warning: null },
    })
    expect(mocks.token).toHaveBeenCalledWith(expect.objectContaining({
      sender: "staff-a@example.test",
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
    }))
    const [, calendarId, event] = mocks.createEvent.mock.calls[0] ?? []
    expect(calendarId).toBe("primary")
    expect(event).toMatchObject({
      summary: "A-1 - Project A - client meeting",
      attendeeEmails: ["client@home.test", "staff-b@example.test"],
      conferenceRequestId: expect.any(String),
    })
    const stored = db.sqlite.prepare("SELECT * FROM project_client_meetings").get()
    expect(stored).toMatchObject({
      project_id: "project-a",
      organizer_email: "staff-a@example.test",
      google_event_id: "google-event-1",
      guest_emails: '["client@home.test"]',
      status: "scheduled",
    })
    expect(mocks.activity).toHaveBeenCalledWith(expect.objectContaining({ action: "client_meeting_started" }))
  })

  it("books a staff-only project meeting and refuses one with nobody invited", async () => {
    open()
    expect(await scheduleProjectClientMeeting("project-a", input({ guestEmails: [] }))).toMatchObject({ success: true })
    const [, , event] = mocks.createEvent.mock.calls[0] ?? []
    expect(event).toMatchObject({ attendeeEmails: ["staff-b@example.test"] })
    expect(await scheduleProjectClientMeeting("project-a", input({ guestEmails: [], staffEmails: [] }))).toEqual({
      success: false,
      error: "Invite at least one person",
    })
  })

  it("lists the project's owner contacts as recommended guests", async () => {
    open()
    const result = await getProjectClientMeetings("project-a")
    if (!result.success) throw new Error(result.error)
    expect(result.data.guestOptions[0]).toMatchObject({ email: "client@home.test", recommended: true })
    expect(result.data.staffOptions.map((option) => option.email)).not.toContain("staff-a@example.test")
  })

  it("refuses a host outside the connected Workspace domain before calling Google", async () => {
    open("staff-a@gmail.test")
    const result = await scheduleProjectClientMeeting("project-a", input())
    expect(result.success).toBe(false)
    expect(mocks.createEvent).not.toHaveBeenCalled()
  })

  it("requires an invitee and a start time in the future", async () => {
    open()
    expect(await scheduleProjectClientMeeting("project-a", input({ guestEmails: [], staffEmails: [] }))).toMatchObject({ success: false })
    expect(
      await scheduleProjectClientMeeting("project-a", input({ startsAt: "2020-01-01T00:00:00.000Z" }))
    ).toMatchObject({ success: false })
    expect(mocks.createEvent).not.toHaveBeenCalled()
  })

  it("cancels on Google so guests are told, then marks the meeting cancelled", async () => {
    const db = open()
    const booked = await scheduleProjectClientMeeting("project-a", input())
    if (!booked.success) throw new Error(booked.error)

    expect(await cancelProjectClientMeeting("project-a", booked.data.id)).toEqual({ success: true, data: null })
    expect(mocks.deleteEvent).toHaveBeenCalledWith("token", "primary", "google-event-1")
    expect(db.sqlite.prepare("SELECT status, cancelled_by FROM project_client_meetings").get())
      .toEqual({ status: "cancelled", cancelled_by: "staff-a" })
  })

  it("loads a saved transcript for Print Preview, falling back to its daily log, for staff only", async () => {
    const db = open()
    db.sqlite.exec("ALTER TABLE daily_logs ADD COLUMN work_completed TEXT")
    db.sqlite.exec(`
      INSERT INTO daily_logs (id, work_completed) VALUES ('log-1', 'Project meeting: Walkthrough' || char(10) || char(10) || 'Transcript' || char(10) || char(10) || 'Owner A: From the log.');
      INSERT INTO project_client_meetings (id, organization_id, project_id, organizer_user_id, organizer_email, title,
        starts_at, ends_at, time_zone, guest_emails, staff_emails, status, transcript_status, transcript_url,
        transcript_text, daily_log_id, created_at, updated_at)
      VALUES
        ('m-text','org-a','project-a','staff-a','staff-a@example.test','Walkthrough','2026-10-24T18:00:00.000Z',
         '2026-10-24T18:30:00.000Z','America/Denver','["client@home.test"]','[]','scheduled','saved',NULL,
         'Owner A: Kept as written.','log-1','x','x'),
        ('m-log','org-a','project-a','staff-a','staff-a@example.test','Walkthrough','2026-10-24T18:00:00.000Z',
         '2026-10-24T18:30:00.000Z','America/Denver','[]','[]','scheduled','saved',NULL,NULL,'log-1','x','x'),
        ('m-pending','org-a','project-a','staff-a','staff-a@example.test','Walkthrough','2026-10-24T18:00:00.000Z',
         '2026-10-24T18:30:00.000Z','America/Denver','[]','[]','scheduled','pending',NULL,NULL,NULL,'x','x');
    `)

    expect(await getClientMeetingTranscript("project-a", "m-text")).toMatchObject({
      success: true,
      data: { title: "Walkthrough", hostName: "Staff A", guestEmails: ["client@home.test"], text: "Owner A: Kept as written." },
    })
    expect(await getClientMeetingTranscript("project-a", "m-log")).toMatchObject({
      success: true,
      data: { text: "Owner A: From the log." },
    })
    expect(await getClientMeetingTranscript("project-a", "m-pending")).toMatchObject({ success: false })
    expect(await getClientMeetingTranscript("project-b", "m-text")).toMatchObject({ success: false })

    mocks.requireAuth.mockResolvedValue({ id: "client-a", email: "client@home.test", role: "client", organizationId: "org-a", isActive: true })
    expect(await getClientMeetingTranscript("project-a", "m-text")).toEqual({ success: false, error: "Permission denied" })
  })
})
