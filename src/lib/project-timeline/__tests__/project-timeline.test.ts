import { beforeEach, describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { d1, migratedSqlite, type Sqlite } from "@/lib/daily-logs/__tests__/sqlite-d1"
import { filterTimeline, shiftDateKey, timelineDays } from "@/lib/project-timeline/model"
import { loadProjectTimeline } from "@/lib/project-timeline/server"

const NOW = "2026-10-14T20:00:00.000Z"

function seed(sqlite: Sqlite): void {
  sqlite.exec(`
    INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-1', 'Example Co', 'example', 'internal', 1, '${NOW}', '${NOW}');
    INSERT INTO users (id, email, display_name, role, is_active, created_at, updated_at) VALUES ('u1', 'dan@example.com', 'Dan Crew', 'field_crew', 1, '${NOW}', '${NOW}'), ('u2', 'cass@example.com', 'Cass Office', 'office_manager', 1, '${NOW}', '${NOW}');
    INSERT INTO projects (id, name, organization_id, status, created_at) VALUES ('p1', 'Bishop Residence', 'org-1', 'active', '${NOW}'), ('office', 'Office', 'org-1', 'active', '${NOW}');
    INSERT INTO project_contacts (id, project_id, contact_type, display_name, active, created_at, updated_at) VALUES ('c1', 'p1', 'owner', 'Jordan Bishop', 1, '${NOW}', '${NOW}');
    INSERT INTO daily_logs (id, project_id, author_id, log_date, work_completed, is_client_visible, created_at, updated_at)
      VALUES ('log-14', 'p1', 'u1', '2026-10-14', 'Set east-side joists', 1, '${NOW}', '${NOW}'),
             ('log-old', 'p1', 'u1', '2026-09-01', 'Long ago', 0, '${NOW}', '${NOW}');
    INSERT INTO project_operations (id, project_id, source_system, source_record_type, source_record_id, title, status, priority, assignee_name, sage_write_status, sync_direction, sync_status, created_at, updated_at)
      VALUES ('t1', 'p1', 'compass', 'staff_task', NULL, 'Second-floor joists', 'in_progress', 'normal', 'Dan', 'not_ready', 'write', 'compass_only', '${NOW}', '${NOW}'),
             ('t2', 'p1', 'compass', 'supplier_task', 'log-14', 'Subfloor short', 'open', 'normal', 'Nu-Tech', 'not_ready', 'write', 'compass_only', '${NOW}', '${NOW}'),
             ('t3', 'p1', 'compass', 'staff_task', 'log-14', 'Call county', 'open', 'normal', NULL, 'not_ready', 'write', 'compass_only', '${NOW}', '${NOW}');
    INSERT INTO internal_duty_entries (id, organization_id, project_id, entry_date, user_id, duty_code, duty_label, hours, daily_log_id, todo_id, related_project_id, created_at, updated_at)
      VALUES ('l1', 'org-1', 'p1', '2026-10-14', 'u1', '06 11 00', 'Wood Framing', 20, 'log-14', 't1', NULL, '${NOW}', '${NOW}'),
             ('l2', 'org-1', 'p1', '2026-10-14', 'u1', '01 74 13', 'Progress Cleaning', 2, 'log-14', NULL, NULL, '${NOW}', '${NOW}'),
             ('d1', 'org-1', 'office', '2026-10-13', 'u2', '507', 'Billing/Accounts Receivable', 1.5, NULL, NULL, 'p1', '${NOW}', '${NOW}');
    INSERT INTO project_todo_events (id, organization_id, project_id, todo_id, kind, daily_log_id, from_status, to_status, note, actor_id, created_at)
      VALUES ('e1', 'org-1', 'p1', 't1', 'worked', 'log-14', 'open', 'in_progress', '20 h · East side', 'u1', '${NOW}'),
             ('e2', 'org-1', 'p1', 't2', 'created', 'log-14', NULL, 'open', NULL, 'u1', '${NOW}'),
             ('e3', 'org-1', 'p1', 't3', 'created', 'log-14', NULL, 'open', NULL, 'u1', '${NOW}');
    INSERT INTO project_interactions (id, organization_id, project_id, project_contact_id, interaction_type, direction, source, qualifies_for_client_touch, summary, occurred_at, created_by, created_at, updated_at, daily_log_id)
      VALUES ('i1', 'org-1', 'p1', 'c1', 'site_visit', 'inbound', 'manual', 1, 'Walked the second floor.', '2026-10-14T16:15:00.000Z', 'u1', '${NOW}', '${NOW}', 'log-14');
    INSERT INTO activity_events (id, organization_id, project_id, actor_user_id, actor_name, actor_role, category, action, entity_type, summary, created_at)
      VALUES ('a1', 'org-1', 'p1', 'u1', 'Dan Crew', 'field_crew', 'schedule', 'updated', 'schedule_task', 'Moved rough plumbing to Oct 16', '2026-10-14T18:00:00.000Z');
  `)
}

describe("project timeline", () => {
  let db: ReturnType<typeof getDb>

  beforeEach(() => {
    const sqlite = migratedSqlite()
    seed(sqlite)
    db = getDb(d1(sqlite))
  })

  it("gathers logs, to-dos, client contact, office time and schedule by day", async () => {
    const timeline = await loadProjectTimeline(db, { organizationId: "org-1", projectId: "p1", to: "2026-10-14" })
    expect(timeline.from).toBe("2026-10-01")
    expect(timeline.days.map((day) => day.date)).toEqual(["2026-10-14", "2026-10-13"])
    const today = timeline.days[0]?.items ?? []
    expect(today.map((item) => [item.kind, item.title])).toEqual([
      ["log", "Daily log by Dan Crew"],
      ["contact", "Site visit · Jordan Bishop → Dan Crew"],
      ["todo", "Worked on: Second-floor joists"],
      ["todo", "2 to-dos opened from this log"],
      ["schedule", "Moved rough plumbing to Oct 16"],
    ])
    expect(today[0]).toMatchObject({ meta: "06 11 00 Wood Framing 20 h · 01 74 13 Progress Cleaning 2 h", ownerVisible: true })
    expect(today.find((item) => item.title.startsWith("Worked on"))?.meta).toBe("Open → In progress · Dan Crew")
    expect(timeline.days[1]?.items.map((item) => item.title)).toEqual(["Cass Office · 507 Billing/Accounts Receivable · 1.5 h"])
    expect(timeline.codeHours.map((row) => [row.code, row.hours])).toEqual([["06 11 00", 20], ["01 74 13", 2]])
    expect([timeline.todoHours, timeline.otherHours]).toEqual([20, 2])
  })

  it("loads an earlier stretch", async () => {
    const timeline = await loadProjectTimeline(db, { organizationId: "org-1", projectId: "p1", to: "2026-09-05", days: 14 })
    expect(timeline.days.map((day) => day.date)).toEqual(["2026-09-01"])
  })
})

describe("timeline helpers", () => {
  it("shifts date keys across months", () => {
    expect(shiftDateKey("2026-10-01", -1)).toBe("2026-09-30")
    expect(shiftDateKey("2026-12-31", 1)).toBe("2027-01-01")
  })

  it("groups and filters items", () => {
    const item = (id: string, kind: "log" | "todo", date: string) => ({ id, kind, date, at: `${date}T00:00:00Z`, title: id, body: null, meta: null, href: null, hrefLabel: null, ownerVisible: false, blocked: false })
    const days = timelineDays([item("a", "todo", "2026-10-13"), item("b", "log", "2026-10-14"), item("c", "todo", "2026-10-14")])
    expect(days.map((day) => [day.date, day.items.map((i) => i.id)])).toEqual([["2026-10-14", ["b", "c"]], ["2026-10-13", ["a"]]])
    expect(filterTimeline(days, "log").map((day) => day.date)).toEqual(["2026-10-14"])
  })
})
