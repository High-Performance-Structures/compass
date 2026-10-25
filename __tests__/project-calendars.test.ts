import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"

import { openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "./helpers/correspondence-core"
import {
  compassProjectCalendarEvents,
  compassProjectCalendarMembers,
  compassProjectCalendars,
  projectClientMeetings,
  projects,
  scheduleTasks,
  users,
  workCalendarEvents,
} from "@/db/schema"
import { FEATURE_SETTINGS, type ProjectCalendarSettings } from "@/lib/feature-settings/registry"
import { projectEventBody, workEventItem } from "@/lib/project-calendars/items"
import { projectCalendarIncluded, syncProjectCalendar } from "@/lib/project-calendars/sync"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/email/compass-email", () => ({
  getCompassGmailAccessToken: vi.fn(async (input: { readonly sender?: string }) => ({
    success: true,
    accessToken: `token:${input.sender ?? "compass@example.com"}`,
    sender: input.sender ?? "compass@example.com",
  })),
}))

const SETTINGS: ProjectCalendarSettings = { ...FEATURE_SETTINGS["project-calendars"].defaults, mode: "selected" }
const NOW = new Date("2026-10-24T18:00:00.000Z")
const OWNER = { accessToken: "token:compass@example.com", email: "compass@example.com" }
const PROJECT = { id: "project-a", organizationId: "org-a", name: "Reiter Residence", projectNumber: "O-152-00" }

let testDb: CorrespondenceTestDatabase

type Call = { readonly method: string; readonly path: string; readonly token: string; readonly body: unknown }
let calls: Call[] = []
let googleEvents = new Map<string, unknown>()
let deletedCalendars = new Set<string>()

function createTable(table: SQLiteTable): void {
  const config = getTableConfig(table)
  testDb.sqlite.exec(`DROP TABLE IF EXISTS "${config.name}"`)
  testDb.sqlite.exec(
    `CREATE TABLE "${config.name}" (${config.columns
      .map((c) => `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}${c.hasDefault && typeof c.default !== "object" ? ` DEFAULT ${typeof c.default === "string" ? `'${c.default}'` : Number(c.default)}` : ""}`)
      .join(",")})`
  )
}

function fakeGoogle(): void {
  let next = 0
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace("https://www.googleapis.com/calendar/v3", "")
    const method = init.method ?? "GET"
    const token = String(new Headers(init.headers).get("Authorization")).replace("Bearer ", "")
    const body: unknown = typeof init.body === "string" ? JSON.parse(init.body) : null
    calls.push({ method, path, token, body })
    const calendar = decodeURIComponent(path.split("/")[2] ?? "")
    if (path.startsWith("/calendars/") && deletedCalendars.has(calendar)) return new Response("{}", { status: 404 })
    if (method === "POST" && path === "/calendars") return Response.json({ id: "cal-1" })
    if (method === "POST" && path.includes("/acl")) {
      const scope = typeof body === "object" && body !== null ? Reflect.get(body, "scope") : null
      return Response.json({ id: `user:${String(Reflect.get(Object(scope), "value"))}` })
    }
    if (method === "POST" && path === "/users/me/calendarList") return Response.json({ id: "cal-1" })
    if (method === "POST" && path.endsWith("/events")) {
      next += 1
      googleEvents.set(`evt-${next}`, body)
      return Response.json({ id: `evt-${next}` })
    }
    if (method === "DELETE") return new Response(null, { status: 204 })
    return Response.json({})
  }))
}

function insertPerson(id: string, email: string, role: string, onTeam: boolean): void {
  testDb.sqlite
    .prepare("INSERT INTO users (id, email, role, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, 'x', 'x')")
    .run(id, email, role)
  testDb.sqlite
    .prepare("INSERT INTO organization_members (id, organization_id, user_id, role, joined_at) VALUES (?, 'org-a', ?, ?, 'x')")
    .run(`m-${id}`, id, role)
  if (onTeam) {
    testDb.sqlite
      .prepare("INSERT INTO project_members (id, project_id, user_id, role, assigned_at) VALUES (?, 'project-a', ?, 'member', 'x')")
      .run(`pm-${id}`, id)
  }
}

async function sync(settings: ProjectCalendarSettings = SETTINGS): Promise<Awaited<ReturnType<typeof syncProjectCalendar>>> {
  return syncProjectCalendar({
    db: testDb.db,
    env: {},
    settings,
    workspaceDomain: "example.com",
    timeZone: "America/Denver",
    project: PROJECT,
    owner: OWNER,
    writeBudget: 400,
    now: NOW,
  })
}

beforeEach(() => {
  testDb = openCorrespondenceTestDatabase()
  testDb.sqlite.exec("PRAGMA foreign_keys = OFF")
  for (const table of [users, projects, scheduleTasks, workCalendarEvents, projectClientMeetings, compassProjectCalendars, compassProjectCalendarEvents, compassProjectCalendarMembers]) {
    createTable(table)
  }
  testDb.sqlite.exec("DELETE FROM organization_members; DELETE FROM project_members;")
  testDb.sqlite.exec("INSERT INTO projects (id, organization_id, name, project_number, status) VALUES ('project-a', 'org-a', 'Reiter Residence', 'O-152-00', 'OPEN')")
  testDb.sqlite.exec("INSERT INTO compass_project_calendars (project_id, organization_id, enabled, status, created_at, updated_at) VALUES ('project-a', 'org-a', 1, 'pending', 'x', 'x')")
  insertPerson("pm", "pm@example.com", "project_manager", true)
  insertPerson("office", "office@example.com", "office", false)
  insertPerson("client", "client@example.com", "client", true)
  insertPerson("vendor", "sub@example.com", "subcontractor", true)
  insertPerson("outside", "staff@gmail.com", "project_manager", true)
  insertPerson("owner-account", "compass@example.com", "admin", true)
  testDb.sqlite.exec(`
    INSERT INTO schedule_tasks (id, project_id, title, start_date, workdays, end_date_calculated, phase, status, is_milestone, percent_complete, sort_order, created_at, updated_at)
      VALUES ('task-1', 'project-a', 'Pour footings', '2026-10-27', 2, '2026-10-28', 'Foundation', 'PENDING', 0, 0, 0, 'x', 'x'),
             ('task-2', 'project-a', 'Framing inspection', '2026-11-04', 0, '2026-11-04', 'Framing', 'PENDING', 1, 0, 1, 'x', 'x'),
             ('task-old', 'project-a', 'Long ago', '2025-01-01', 1, '2025-01-01', 'Site', 'COMPLETE', 0, 100, 2, 'x', 'x');
    INSERT INTO work_calendar_events (id, organization_id, project_id, title, event_type, visibility, all_day, starts_at, ends_at, time_zone, recurrence, status, version, created_at, updated_at)
      VALUES ('evt-public', 'org-a', 'project-a', 'Site walk', 'meeting', 'organization', 0, '2026-10-29T16:00:00.000Z', '2026-10-29T17:00:00.000Z', 'America/Denver', 'none', 'open', 1, 'x', 'x'),
             ('evt-private', 'org-a', 'project-a', 'Private call', 'meeting', 'private', 0, '2026-10-29T18:00:00.000Z', '2026-10-29T19:00:00.000Z', 'America/Denver', 'none', 'open', 1, 'x', 'x');
    INSERT INTO project_client_meetings (id, organization_id, project_id, organizer_user_id, organizer_email, title, starts_at, ends_at, time_zone, meeting_url, status, created_at, updated_at)
      VALUES ('meet-1', 'org-a', 'project-a', 'pm', 'pm@example.com', 'Selections review', '2026-10-30T20:00:00.000Z', '2026-10-30T21:00:00.000Z', 'America/Denver', 'https://meet.google.com/abc-defg-hij', 'scheduled', 'x', 'x');
  `)
  calls = []
  googleEvents = new Map()
  deletedCalendars = new Set()
  fakeGoogle()
})

afterEach(() => {
  vi.unstubAllGlobals()
  testDb.close()
})

describe("which jobs get a calendar", () => {
  it("follows the company setting unless staff chose for the job", () => {
    const open = { status: "OPEN" }
    const closed = { status: "COMPLETE" }
    expect(projectCalendarIncluded({ ...SETTINGS, mode: "off" }, open, { enabled: true })).toBe(false)
    const defaults = FEATURE_SETTINGS["project-calendars"].defaults
    expect(defaults.mode).toBe("selected")
    expect(projectCalendarIncluded(defaults, open, null)).toBe(false)
    expect(projectCalendarIncluded(defaults, open, { enabled: true })).toBe(true)
    expect(projectCalendarIncluded({ ...SETTINGS, mode: "selected" }, open, null)).toBe(false)
    expect(projectCalendarIncluded({ ...SETTINGS, mode: "selected" }, closed, { enabled: true })).toBe(true)
    expect(projectCalendarIncluded({ ...SETTINGS, mode: "open" }, open, null)).toBe(true)
    expect(projectCalendarIncluded({ ...SETTINGS, mode: "open" }, open, { enabled: false })).toBe(false)
    expect(projectCalendarIncluded({ ...SETTINGS, mode: "open" }, closed, null)).toBe(false)
  })
})

describe("project calendar sync", () => {
  it("makes the calendar under the company account and shares it only with staff on the job", async () => {
    const counts = await sync()
    expect(calls[0]).toMatchObject({ method: "POST", path: "/calendars", token: OWNER.accessToken })
    expect(Reflect.get(Object(calls[0]?.body), "summary")).toBe("Compass – O-152-00 Reiter Residence")

    const shared = calls
      .filter((call) => call.path.includes("/acl"))
      .map((call) => ({ role: Reflect.get(Object(call.body), "role"), email: Reflect.get(Object(Reflect.get(Object(call.body), "scope")), "value") }))
    // Clients, vendors, non-Workspace addresses, staff off the team, and the
    // owning account itself are never shared with.
    expect(shared).toEqual([{ role: "reader", email: "pm@example.com" }])
    expect(calls.find((call) => call.path.includes("/acl"))?.path).toContain("sendNotifications=false")
    expect(calls.filter((call) => call.path === "/users/me/calendarList").map((call) => call.token)).toEqual(["token:pm@example.com"])
    expect(counts.shared).toBe(1)
  })

  it("puts the schedule, company-visible events and client meetings on it", async () => {
    await sync()
    const summaries = [...googleEvents.values()].map((event) => Reflect.get(Object(event), "summary"))
    expect(summaries.sort()).toEqual(["Meeting: Selections review", "Milestone: Framing inspection", "Pour footings", "Site walk"])
    const meeting = [...googleEvents.values()].find((event) => Reflect.get(Object(event), "summary") === "Meeting: Selections review")
    expect(Reflect.get(Object(meeting), "location")).toBe("https://meet.google.com/abc-defg-hij")
    expect(Reflect.get(Object(meeting), "attendees")).toBeUndefined()
  })

  it("writes nothing on a second run when nothing changed", async () => {
    await sync()
    calls = []
    const counts = await sync()
    expect(calls.filter((call) => call.method !== "GET")).toEqual([])
    expect(counts.writes).toBe(0)
  })

  it("follows schedule changes and team changes", async () => {
    await sync()
    calls = []
    testDb.sqlite.exec("UPDATE schedule_tasks SET start_date = '2026-11-02', end_date_calculated = '2026-11-03' WHERE id = 'task-1'")
    testDb.sqlite.exec("DELETE FROM project_members WHERE user_id = 'pm'")
    insertPerson("apm", "apm@example.com", "assistant_project_manager", true)
    const counts = await sync()
    expect(counts).toMatchObject({ updated: 1, shared: 1, unshared: 1 })
    expect(calls.find((call) => call.method === "PUT")?.body).toMatchObject({ start: { date: "2026-11-02" }, end: { date: "2026-11-04" } })
    expect(calls.find((call) => call.method === "DELETE" && call.path.includes("/acl/"))?.path).toContain(encodeURIComponent("user:pm@example.com"))
    // The removed person's calendar list entry is cleaned up as them.
    expect(calls.find((call) => call.method === "DELETE" && call.path.startsWith("/users/me/calendarList/"))?.token).toBe("token:pm@example.com")
  })

  it("can share with all staff, minus excluded people", async () => {
    await sync({ ...SETTINGS, shareWith: "all", excludedUserIds: ["office"] })
    const emails = calls
      .filter((call) => call.path.includes("/acl"))
      .map((call) => Reflect.get(Object(Reflect.get(Object(call.body), "scope")), "value"))
    expect(emails).toEqual(["pm@example.com"])
  })

  it("starts a new calendar when someone deleted it in Google", async () => {
    await sync()
    deletedCalendars.add("cal-1")
    testDb.sqlite.exec("UPDATE schedule_tasks SET title = 'Pour footings (moved)' WHERE id = 'task-1'")
    await sync()
    const row = testDb.sqlite.prepare("SELECT google_calendar_id, status FROM compass_project_calendars").get()
    expect(row).toEqual({ google_calendar_id: null, status: "pending" })
  })
})

describe("event bodies", () => {
  it("keeps timed Work Calendar events at their times and repeats", () => {
    const item = workEventItem({
      baseUrl: "https://compass.example.com",
      projectId: "project-a",
      event: {
        id: "evt",
        title: "Weekly OAC",
        eventType: "meeting",
        description: null,
        location: "Site trailer",
        meetingUrl: null,
        allDay: false,
        startDate: null,
        endDateExclusive: null,
        startsAt: "2026-10-29T16:00:00.000Z",
        endsAt: "2026-10-29T17:00:00.000Z",
        timeZone: "America/Denver",
        recurrence: "weekly",
        recurrenceUntil: "2026-12-31",
      },
    })
    if (!item) throw new Error("expected an event")
    const body: unknown = JSON.parse(projectEventBody(item))
    expect(body).toMatchObject({
      start: { dateTime: "2026-10-29T16:00:00.000Z", timeZone: "America/Denver" },
      recurrence: ["RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z"],
      transparency: "transparent",
      location: "Site trailer",
    })
  })
})
