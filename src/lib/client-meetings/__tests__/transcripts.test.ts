import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  driveContext: vi.fn(),
  resolveFolder: vi.fn(),
  activity: vi.fn(),
  exportFile: vi.fn(),
  uploadFile: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/email/compass-email", () => ({ getCompassGmailAccessToken: mocks.token }))
vi.mock("@/lib/google/project-document-drive", () => ({ getProjectDocumentDriveContext: mocks.driveContext }))
vi.mock("@/lib/paper-trail/folders", () => ({
  internalDomainSet: () => new Set(["example.test"]),
  resolveRecordFolder: mocks.resolveFolder,
}))
vi.mock("@/lib/feature-settings/server", () => ({ readFeatureSettings: vi.fn(async () => ({ internalDomains: [] })) }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.activity }))

import { upcomingClientMeetingsForGuest } from "../guest-meetings"
import { meetingCodeFromUrl, sweepClientMeetingTranscripts } from "../transcripts"
import {
  openCorrespondenceTestDatabase,
  type CorrespondenceTestDatabase,
} from "../../../../__tests__/helpers/correspondence-core"

const NOW = new Date("2026-10-24T20:00:00.000Z")
let database: CorrespondenceTestDatabase | null = null
const fetchMock = vi.fn()

afterEach(() => {
  database?.close()
  database = null
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function migration(file: string): string {
  return readFileSync(resolve(process.cwd(), "drizzle", file), "utf8").replaceAll("--> statement-breakpoint", "")
}

function open(): CorrespondenceTestDatabase {
  const opened = openCorrespondenceTestDatabase()
  opened.sqlite.exec("ALTER TABLE projects ADD COLUMN google_drive_folder_id TEXT")
  opened.sqlite.exec("UPDATE projects SET google_drive_folder_id = 'project-folder' WHERE id = 'project-a'")
  opened.sqlite.exec(migration("0246_project_client_meetings.sql"))
  opened.sqlite.exec(migration("0247_client_meeting_transcripts.sql"))
  mocks.token.mockResolvedValue({ success: true, accessToken: "meet-token", sender: "staff-a@example.test" })
  mocks.driveContext.mockResolvedValue({
    client: { exportFile: mocks.exportFile, uploadFile: mocks.uploadFile },
    googleEmail: "drive-owner@example.test",
    sharedDriveId: null,
  })
  mocks.resolveFolder.mockResolvedValue({ ok: true, folderId: "communications-folder", heldPrivate: false })
  mocks.exportFile.mockResolvedValue(new Response("%PDF-1.4", { status: 200 }))
  mocks.uploadFile.mockResolvedValue({ id: "drive-file-1", webViewLink: "https://drive.google.com/file/d/drive-file-1/view" })
  vi.stubGlobal("fetch", fetchMock)
  database = opened
  return opened
}

function insertMeeting(db: CorrespondenceTestDatabase, overrides: { id?: string; endsAt?: string; guests?: string; status?: string } = {}): void {
  const id = overrides.id ?? "meeting-1"
  db.sqlite
    .prepare(
      `INSERT INTO project_client_meetings (id, organization_id, project_id, organizer_user_id, organizer_email, title,
        starts_at, ends_at, time_zone, guest_emails, staff_emails, google_event_id, meeting_url, status, created_at, updated_at)
       VALUES (?, 'org-a', 'project-a', 'staff-a', 'staff-a@example.test', 'Selections review', ?, ?, 'America/Denver', ?, '[]',
        'g1', 'https://meet.google.com/abc-defg-hij', ?, 'x', 'x')`
    )
    .run(
      id,
      "2026-10-24T18:00:00.000Z",
      overrides.endsAt ?? "2026-10-24T18:30:00.000Z",
      overrides.guests ?? '["owner-a@example.test"]',
      overrides.status ?? "scheduled"
    )
}

function meetResponses(transcripts: readonly Record<string, unknown>[], endTime: string | null = "2026-10-24T18:31:00Z"): void {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/transcripts")) return Response.json({ transcripts })
    return Response.json({
      conferenceRecords: [{ name: "conferenceRecords/rec-1", ...(endTime ? { endTime } : {}) }],
    })
  })
}

function meetingRow(db: CorrespondenceTestDatabase): Record<string, unknown> {
  const row: unknown = db.sqlite.prepare("SELECT * FROM project_client_meetings WHERE id = 'meeting-1'").get()
  if (typeof row !== "object" || row === null) throw new Error("missing meeting")
  return Object.fromEntries(Object.entries(row))
}

describe("client meeting transcripts", () => {
  it("reads the meeting code from a Meet link", () => {
    expect(meetingCodeFromUrl("https://meet.google.com/abc-defg-hij")).toBe("abc-defg-hij")
    expect(meetingCodeFromUrl("https://example.com/abc-defg-hij")).toBeNull()
    expect(meetingCodeFromUrl(null)).toBeNull()
  })

  it("saves a generated transcript as a PDF in the project's Communications folder", async () => {
    const db = open()
    insertMeeting(db)
    meetResponses([{ name: "t1", state: "FILE_GENERATED", docsDestination: { document: "doc-1" }, startTime: "2026-10-24T18:01:00Z" }])

    expect(await sweepClientMeetingTranscripts(db.db, {} as CloudflareEnv, NOW)).toEqual({ checked: 1, saved: 1, none: 0, failed: 0 })
    expect(mocks.token).toHaveBeenCalledWith(expect.objectContaining({
      sender: "staff-a@example.test",
      scopes: ["https://www.googleapis.com/auth/meetings.space.readonly"],
    }))
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(encodeURIComponent('space.meeting_code = "abc-defg-hij"'))
    expect(mocks.resolveFolder).toHaveBeenCalledWith(expect.objectContaining({ projectFolderId: "project-folder", category: "communications" }))
    expect(mocks.exportFile).toHaveBeenCalledWith("staff-a@example.test", "doc-1", "application/pdf")
    expect(mocks.uploadFile).toHaveBeenCalledWith("drive-owner@example.test", expect.objectContaining({
      name: "Meeting transcript - Selections review - 2026-10-24.pdf",
      parentId: "communications-folder",
    }))
    expect(meetingRow(db)).toMatchObject({
      transcript_status: "saved",
      transcript_drive_file_id: "drive-file-1",
      transcript_url: "https://drive.google.com/file/d/drive-file-1/view",
    })
    expect(mocks.activity).toHaveBeenCalledWith(expect.objectContaining({ action: "client_meeting_transcript_saved", projectId: "project-a" }))
  })

  it("waits while Google is still writing the transcript, then stops after a day with none", async () => {
    const db = open()
    insertMeeting(db)
    meetResponses([{ name: "t1", state: "ENDED" }])
    await sweepClientMeetingTranscripts(db.db, {} as CloudflareEnv, NOW)
    expect(meetingRow(db).transcript_status).toBe("pending")
    expect(mocks.uploadFile).not.toHaveBeenCalled()

    meetResponses([])
    await sweepClientMeetingTranscripts(db.db, {} as CloudflareEnv, new Date("2026-10-26T00:00:00.000Z"))
    expect(meetingRow(db).transcript_status).toBe("none")
  })

  it("leaves meetings that ended in the last few minutes and cancelled meetings alone", async () => {
    const db = open()
    insertMeeting(db, { endsAt: "2026-10-24T19:55:00.000Z" })
    insertMeeting(db, { id: "meeting-2", status: "cancelled" })
    expect(await sweepClientMeetingTranscripts(db.db, {} as CloudflareEnv, NOW)).toMatchObject({ checked: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("records an error instead of saving into a folder shared outside the company", async () => {
    const db = open()
    insertMeeting(db)
    meetResponses([{ name: "t1", state: "FILE_GENERATED", docsDestination: { document: "doc-1" } }])
    mocks.resolveFolder.mockResolvedValue({ ok: false, error: "The project's Drive folder is shared outside the company" })
    expect(await sweepClientMeetingTranscripts(db.db, {} as CloudflareEnv, NOW)).toMatchObject({ failed: 1 })
    expect(meetingRow(db)).toMatchObject({ transcript_status: "error" })
    expect(mocks.uploadFile).not.toHaveBeenCalled()
  })
})

describe("guest meeting join links", () => {
  it("lists only upcoming meetings the person was invited to", async () => {
    const db = open()
    insertMeeting(db, { endsAt: "2026-10-24T21:00:00.000Z" })
    insertMeeting(db, { id: "meeting-2", endsAt: "2026-10-24T21:00:00.000Z", guests: '["someone@else.test"]' })
    insertMeeting(db, { id: "meeting-3", endsAt: "2026-10-24T19:00:00.000Z" })

    const meetings = await upcomingClientMeetingsForGuest(db.db, {
      organizationId: "org-a",
      projectId: "project-a",
      emails: ["Owner-A@Example.test"],
      now: NOW,
    })
    expect(meetings.map((meeting) => meeting.id)).toEqual(["meeting-1"])
    expect(meetings[0]).toMatchObject({ meetingUrl: "https://meet.google.com/abc-defg-hij", hostName: "Staff A" })
    expect(await upcomingClientMeetingsForGuest(db.db, { organizationId: "org-b", projectId: "project-a", emails: ["owner-a@example.test"], now: NOW })).toEqual([])
  })
})
