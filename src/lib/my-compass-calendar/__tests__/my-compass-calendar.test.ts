import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  settings: vi.fn(),
  createCalendar: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/email/compass-email", () => ({ getCompassGmailAccessToken: mocks.token }))
vi.mock("@/lib/feature-settings/server", () => ({ readFeatureSettings: mocks.settings }))
vi.mock("@/lib/google/calendar/client", () => ({ createGoogleCalendar: mocks.createCalendar }))

import { assignmentIncludes, personAliases } from "../items"
import { sweepMyCompassCalendars } from "../sync"
import {
  openCorrespondenceTestDatabase,
  type CorrespondenceTestDatabase,
} from "../../../../__tests__/helpers/correspondence-core"

const NOW = new Date("2026-10-24T20:00:00.000Z")
const SETTINGS = {
  mode: "on",
  pilotUserIds: [],
  scheduleItems: true,
  todos: true,
  projectMilestones: true,
  daysBack: 14,
  daysAhead: 120,
}
let database: CorrespondenceTestDatabase | null = null
const fetchMock = vi.fn()

afterEach(() => {
  database?.close()
  database = null
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function open(): CorrespondenceTestDatabase {
  const opened = openCorrespondenceTestDatabase()
  const { sqlite } = opened
  sqlite.exec(`
    ALTER TABLE users ADD COLUMN google_email TEXT;
    ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'OPEN';
    UPDATE users SET email = 'staff-a@hps.test' WHERE id = 'staff-a';
    CREATE TABLE google_auth (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, service_account_key_encrypted TEXT NOT NULL,
      workspace_domain TEXT NOT NULL, shared_drive_id TEXT, shared_drive_name TEXT,
      connected_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO google_auth VALUES ('ga','org-a','enc','hps.test',NULL,NULL,'staff-a','x','x');
    CREATE TABLE organization_calendar_settings (
      organization_id TEXT PRIMARY KEY, default_project_id TEXT, time_zone TEXT NOT NULL, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE schedule_tasks (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, start_date TEXT NOT NULL,
      end_date_calculated TEXT NOT NULL, phase TEXT NOT NULL, status TEXT NOT NULL, is_milestone INTEGER NOT NULL DEFAULT 0,
      assigned_to TEXT, assigned_user_id TEXT
    );
    CREATE TABLE project_operations (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_record_type TEXT NOT NULL, title TEXT NOT NULL,
      status TEXT NOT NULL, assignee_name TEXT, due_date TEXT
    );
    INSERT INTO schedule_tasks VALUES
      ('t-mine','project-a','Frame walls','2026-10-26','2026-10-28','Framing','PENDING',0,'Daniel Vogel, High Performance Structures, Inc., Staff A',NULL),
      ('t-company','project-a','Pour slab','2026-10-26','2026-10-27','Foundation','PENDING',0,'High Performance Structures, Inc.',NULL),
      ('t-done','project-a','Excavate','2026-10-20','2026-10-21','Site','COMPLETE',0,'Staff A',NULL),
      ('t-milestone','project-a','Dry-in','2026-11-05','2026-11-05','Milestones','PENDING',1,NULL,NULL),
      ('t-other-milestone','project-b','Dry-in','2026-11-05','2026-11-05','Milestones','PENDING',1,NULL,NULL),
      ('t-user-id','project-b','Inspection','2026-10-30','2026-10-30','Inspections','PENDING',0,NULL,'staff-a');
    INSERT INTO project_operations VALUES
      ('o-alias','project-a','todo','Order windows','incomplete','Staffie Aye','2026-10-29'),
      ('o-done','project-a','todo','Call client','completed','Staff A','2026-10-29'),
      ('o-someone','project-a','todo','Pick colors','incomplete','Someone Else','2026-10-29');
  `)
  for (const file of ["0248_my_compass_calendars.sql"]) {
    sqlite.exec(readFileSync(resolve(process.cwd(), "drizzle", file), "utf8").replaceAll("--> statement-breakpoint", ""))
  }
  mocks.settings.mockResolvedValue(SETTINGS)
  mocks.token.mockResolvedValue({ success: true, accessToken: "token", sender: "staff-a@hps.test" })
  mocks.createCalendar.mockResolvedValue({ id: "cal-1", summary: "My Compass", description: null, timeZone: "America/Denver" })
  let next = 0
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "POST") return Response.json({ id: `event-${++next}` })
    if (init?.method === "DELETE") return new Response(null, { status: 204 })
    return Response.json({ id: "ok" })
  })
  vi.stubGlobal("fetch", fetchMock)
  database = opened
  return opened
}

function itemKeys(db: CorrespondenceTestDatabase): readonly string[] {
  const rows: unknown = db.sqlite.prepare("SELECT item_key FROM my_compass_calendar_items ORDER BY item_key").all()
  return Array.isArray(rows) ? rows.map((row) => String(Reflect.get(row, "item_key"))) : []
}

function postedBodies(): readonly Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)))
}

describe("assignment matching", () => {
  const aliases = personAliases({
    email: "wes@hps.test",
    googleEmail: null,
    displayName: "Wes Jones",
    firstName: "Wes",
    lastName: "Jones",
    otherNames: ["Wesley Jones"],
  })

  it("finds a person inside a list of names and by another spelling", () => {
    expect(assignmentIncludes("Daniel Vogel, High Performance Structures, Inc., Martine Vogel, Wesley Jones", aliases)).toBe(true)
    expect(assignmentIncludes("wes jones", aliases)).toBe(true)
    expect(assignmentIncludes("Wes@HPS.test", aliases)).toBe(true)
  })

  it("does not match the company or someone with a similar name", () => {
    expect(assignmentIncludes("High Performance Structures, Inc.", aliases)).toBe(false)
    expect(assignmentIncludes("Wesley Jonesboro", aliases)).toBe(false)
    expect(assignmentIncludes(null, aliases)).toBe(false)
  })
})

describe("My Compass calendar sync", () => {
  it("creates the calendar and adds only the person's open items as free all-day events", async () => {
    const db = open()
    db.sqlite.exec("INSERT INTO project_members VALUES ('pm-a2','project-a','staff-a','staff','x') ON CONFLICT DO NOTHING")
    db.sqlite.exec(`INSERT INTO my_compass_calendars (user_id, organization_id, other_names, created_at, updated_at)
      VALUES ('staff-a','org-a','["Staffie Aye"]','x','x')`)

    const summary = await sweepMyCompassCalendars(db.db, { COMPASS_APP_URL: "https://compass.test" }, NOW)

    expect(summary).toMatchObject({ synced: 1, created: 4, failed: 0 })
    expect(mocks.token).toHaveBeenCalledWith(expect.objectContaining({
      sender: "staff-a@hps.test",
      scopes: ["https://www.googleapis.com/auth/calendar.app.created"],
    }))
    expect(mocks.createCalendar).toHaveBeenCalledWith("token", expect.objectContaining({ summary: "My Compass" }))
    // Assigned in a list, assigned by account, a team milestone, and a to-do under another name.
    expect(itemKeys(db)).toEqual(["schedule:t-milestone", "schedule:t-mine", "schedule:t-user-id", "todo:o-alias"])
    const framing = postedBodies().find((body) => String(body.summary).includes("Frame walls"))
    expect(framing).toMatchObject({
      summary: "A-1 · Frame walls",
      start: { date: "2026-10-26" },
      end: { date: "2026-10-29" },
      transparency: "transparent",
      reminders: { useDefault: false, overrides: [] },
    })
    expect(String(framing?.description)).toContain("https://compass.test/dashboard/projects/project-a/schedule")
  })

  it("updates changed items and removes ones that are finished, then leaves unchanged ones alone", async () => {
    const db = open()
    await sweepMyCompassCalendars(db.db, {}, NOW)
    const later = new Date(NOW.getTime() + 10 * 60_000)

    db.sqlite.exec("UPDATE schedule_tasks SET end_date_calculated = '2026-10-30' WHERE id = 't-mine'")
    db.sqlite.exec("UPDATE schedule_tasks SET status = 'COMPLETE' WHERE id = 't-user-id'")
    fetchMock.mockClear()
    const second = await sweepMyCompassCalendars(db.db, {}, later)
    expect(second).toMatchObject({ created: 0, updated: 1, deleted: 1 })
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1)
    expect(itemKeys(db)).not.toContain("schedule:t-user-id")

    fetchMock.mockClear()
    const third = await sweepMyCompassCalendars(db.db, {}, new Date(later.getTime() + 10 * 60_000))
    expect(third).toMatchObject({ created: 0, updated: 0, deleted: 0 })
  })

  it("stops when the person deleted the calendar in Google", async () => {
    const db = open()
    await sweepMyCompassCalendars(db.db, {}, NOW)
    fetchMock.mockImplementation(async () => Response.json({ error: { message: "Not Found" } }, { status: 404 }))
    await sweepMyCompassCalendars(db.db, {}, new Date(NOW.getTime() + 10 * 60_000))
    expect(db.sqlite.prepare("SELECT status, google_calendar_id FROM my_compass_calendars").get())
      .toEqual({ status: "removed", google_calendar_id: null })
    expect(itemKeys(db)).toEqual([])
  })

  it("works with more open jobs than D1 binds in one query", async () => {
    const db = open()
    const insertProject = db.sqlite.prepare("INSERT INTO projects (id, organization_id, name, project_number) VALUES (?, 'org-a', ?, ?)")
    for (let index = 0; index < 150; index += 1) insertProject.run(`bulk-${index}`, `Bulk ${index}`, `B-${index}`)
    db.failures.setBindLimit(100)
    expect(await sweepMyCompassCalendars(db.db, {}, NOW)).toMatchObject({ synced: 1, failed: 0 })
    expect(itemKeys(db)).toContain("schedule:t-mine")
  })

  it("only includes test people while testing, and skips accounts outside the Workspace domain", async () => {
    const db = open()
    mocks.settings.mockResolvedValue({ ...SETTINGS, mode: "pilot", pilotUserIds: ["revoked-a"] })
    expect(await sweepMyCompassCalendars(db.db, {}, NOW)).toMatchObject({ synced: 0 })
    expect(mocks.createCalendar).not.toHaveBeenCalled()
  })
})
