import { beforeEach, describe, expect, it, vi } from "vitest"

const notify = vi.fn<(input: unknown) => Promise<void>>(async () => undefined)
vi.mock("@/lib/notifications/create-event", () => ({ createSystemNotificationEvent: (input: unknown) => notify(input) }))
vi.mock("@/lib/notifications/events", () => ({ notifyProjectAssignment: vi.fn() }))
vi.mock("@/lib/notifications/clear-on-read", () => ({ clearOverdueFollowUpReminders: vi.fn() }))

import { getDb } from "@/db"
import { clockLabel, isWorkDay, reminderTimeFor, weekdayOf } from "@/lib/daily-logs/reminders"
import { recentMissingDailyLogs, sendMissingDailyLogReminders, staffMissingDailyLogs } from "@/lib/daily-logs/reminders-server"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { d1, migratedSqlite, type Sqlite } from "./sqlite-d1"

const NOW = "2026-10-14T12:00:00.000Z"
const rules = FEATURE_SETTINGS["daily-log-reminders"].defaults

function seed(sqlite: Sqlite): void {
  sqlite.exec(`
    INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-1', 'Example Co', 'example', 'internal', 1, '${NOW}', '${NOW}');
    INSERT INTO users (id, email, display_name, role, is_active, created_at, updated_at) VALUES
      ('crew', 'crew@example.com', 'Avery Crew', 'field_crew', 1, '${NOW}', '${NOW}'),
      ('office', 'office@example.com', 'Cass Office', 'office_manager', 1, '${NOW}', '${NOW}'),
      ('logged', 'logged@example.com', 'Dan Logged', 'field_crew', 1, '${NOW}', '${NOW}'),
      ('away', 'away@example.com', 'Pat Away', 'project_manager', 1, '${NOW}', '${NOW}'),
      ('client', 'client@example.com', 'Client Person', 'client', 1, '${NOW}', '${NOW}'),
      ('sub', 'sub@example.com', 'Sub Person', 'subcontractor', 1, '${NOW}', '${NOW}');
    INSERT INTO organization_members (id, organization_id, user_id, role, joined_at) VALUES
      ('m1', 'org-1', 'crew', 'field_crew', '${NOW}'), ('m2', 'org-1', 'office', 'office_manager', '${NOW}'),
      ('m3', 'org-1', 'logged', 'field_crew', '${NOW}'), ('m4', 'org-1', 'away', 'project_manager', '${NOW}'),
      ('m5', 'org-1', 'client', 'client', '${NOW}'), ('m6', 'org-1', 'sub', 'subcontractor', '${NOW}');
    INSERT INTO projects (id, name, project_number, organization_id, status, created_at) VALUES ('p1', 'Bishop Residence', 'H-430', 'org-1', 'active', '${NOW}');
    INSERT INTO daily_logs (id, project_id, author_id, log_date, work_completed, created_at, updated_at) VALUES ('log-1', 'p1', 'logged', '2026-10-14', 'Joists', '${NOW}', '${NOW}');
    INSERT INTO schedule_tasks (id, project_id, title, start_date, workdays, end_date_calculated, phase, status, assigned_user_id, created_at, updated_at)
      VALUES ('s1', 'p1', 'Framing', '2026-10-13', 3, '2026-10-15', 'framing', 'PENDING', 'crew', '${NOW}', '${NOW}');
    INSERT INTO work_calendar_events (id, organization_id, title, event_type, visibility, start_date, end_date_exclusive, all_day, time_zone, recurrence, status, version, created_by, created_at, updated_at)
      VALUES ('ev1', 'org-1', 'Vacation', 'absence', 'busy', '2026-10-14', '2026-10-16', 1, 'America/Denver', 'none', 'open', 1, 'away', '${NOW}', '${NOW}');
  `)
}

describe("daily log reminder rules", () => {
  it("picks the group's time unless people may pick their own", () => {
    expect(reminderTimeFor({ ...rules, officeTime: "16:00", fieldTime: "17:00" }, "field_crew", "15:00")).toBe("17:00")
    expect(reminderTimeFor({ ...rules, officeTime: "16:00" }, "office_manager", null)).toBe("16:00")
    expect(reminderTimeFor({ ...rules, staffPickOwnTime: true }, "field_crew", "15:00")).toBe("15:00")
  })

  it("knows work days and reads times", () => {
    expect(weekdayOf("2026-10-14")).toBe(3)
    expect(isWorkDay("2026-10-17", rules.workDays)).toBe(false)
    expect(clockLabel("16:30")).toBe("4:30 PM")
    expect(clockLabel("00:05")).toBe("12:05 AM")
  })
})

describe("missing daily log reminders", () => {
  let db: ReturnType<typeof getDb>

  beforeEach(() => {
    notify.mockClear()
    const sqlite = migratedSqlite()
    seed(sqlite)
    db = getDb(d1(sqlite))
  })

  it("lists staff with no log, skipping people who logged, are away, or aren't staff", async () => {
    const missing = await staffMissingDailyLogs(db, "org-1", "2026-10-14", rules)
    expect(missing.map((person) => [person.name, person.time, person.projectLabel, person.scheduled])).toEqual([
      ["Avery Crew", "16:30", "H-430 · Bishop Residence", true],
      ["Cass Office", "16:30", null, false],
    ])
    const scheduledOnly = await staffMissingDailyLogs(db, "org-1", "2026-10-14", { ...rules, audience: "scheduled_staff" })
    expect(scheduledOnly.map((person) => person.name)).toEqual(["Avery Crew"])
    const fieldOnly = await staffMissingDailyLogs(db, "org-1", "2026-10-14", { ...rules, audience: "field_staff" })
    expect(fieldOnly.map((person) => person.name)).toEqual(["Avery Crew"])
    expect(await staffMissingDailyLogs(db, "org-1", "2026-10-17", rules)).toEqual([])
  })

  it("reminds once, at the company's time", async () => {
    // 4:00 PM in Denver: too early.
    expect(await sendMissingDailyLogReminders(db, new Date("2026-10-14T22:00:00.000Z"))).toEqual({ reminded: 0 })
    // 4:40 PM: both reminded, with push.
    expect(await sendMissingDailyLogReminders(db, new Date("2026-10-14T22:40:00.000Z"))).toEqual({ reminded: 2 })
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Daily log",
        href: "/dashboard/projects/p1/daily-logs?quickAdd=daily-log",
        body: "You haven't written a daily log today. Tap to log on H-430 · Bishop Residence (you were scheduled) or another job or workspace.",
        delivery: { inApp: true, email: false, push: true },
      }),
    )
    // The next run doesn't repeat it.
    expect(await sendMissingDailyLogReminders(db, new Date("2026-10-14T22:50:00.000Z"))).toEqual({ reminded: 0 })
  })

  it("lists recent missing days for admins", async () => {
    const days = await recentMissingDailyLogs(db, "org-1", { workDays: 1, now: new Date("2026-10-15T15:00:00.000Z") })
    expect(days.map((day) => [day.date, day.people.map((person) => person.name)])).toEqual([["2026-10-14", ["Avery Crew", "Cass Office"]]])
  })
})
