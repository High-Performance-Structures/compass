import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/notifications/events", () => ({ notifyProjectAssignment: vi.fn(async () => undefined) }))
vi.mock("@/lib/notifications/clear-on-read", () => ({ clearOverdueFollowUpReminders: vi.fn(async () => undefined) }))

import { getDb } from "@/db"
import type { AuthUser } from "@/lib/auth"
import {
  applyDailyLogFollowUps,
  checkDailyLogFollowUps,
  loadOpenDailyLogTodos,
  loadProjectTodoHistory,
  loadTodoHours,
  loadTodoWorkedLogCounts,
} from "@/lib/daily-logs/log-followups-server"

type Statement = {
  readonly run: (...values: readonly unknown[]) => { readonly changes: number | bigint }
  readonly all: (...values: readonly unknown[]) => readonly Record<string, unknown>[]
  readonly get: (...values: readonly unknown[]) => unknown
}
type Sqlite = { readonly exec: (sql: string) => void; readonly prepare: (sql: string) => Statement }

const nodeRequire = createRequire(import.meta.url)

function newSqlite(): Sqlite {
  const imported: unknown = nodeRequire("node:sqlite")
  const Database = imported !== null && typeof imported === "object" ? Reflect.get(imported, "DatabaseSync") : undefined
  if (typeof Database !== "function") throw new Error("node:sqlite is unavailable")
  const instance: unknown = Reflect.construct(Database, [":memory:"])
  if (instance === null || typeof instance !== "object") throw new Error("Unable to open SQLite")
  return {
    exec: (sql) => Reflect.apply(Reflect.get(instance, "exec"), instance, [sql]),
    prepare: (sql) => Reflect.apply(Reflect.get(instance, "prepare"), instance, [sql]),
  }
}

/** Just enough of D1 for drizzle: prepare/bind and run, all, first, raw. */
type D1 = Parameters<typeof getDb>[0]

// Tests hand drizzle a small stand-in that has D1's prepare and batch.
function isD1(value: unknown): value is D1 {
  return typeof value === "object" && value !== null && "prepare" in value && "batch" in value
}

function d1(sqlite: Sqlite): D1 {
  function prepared(query: string, values: readonly unknown[] = []): Record<string, unknown> {
    const statement = sqlite.prepare(query)
    const bound = values.map((value) => (typeof value === "boolean" ? Number(value) : value))
    return {
      bind: (...next: readonly unknown[]) => prepared(query, next),
      run: async () => ({ success: true, meta: { changes: Number(statement.run(...bound).changes) } }),
      all: async () => ({ success: true, results: statement.all(...bound) }),
      first: async () => statement.get(...bound) ?? null,
      raw: async () => statement.all(...bound).map((row) => Object.values(row)),
    }
  }
  const database = {
    prepare: (query: string) => prepared(query),
    batch: async (statements: readonly { readonly run: () => Promise<unknown> }[]) => Promise.all(statements.map((statement) => statement.run())),
  }
  if (!isD1(database)) throw new Error("Not a D1 stand-in")
  return database
}

function migrate(sqlite: Sqlite): void {
  const dir = join(process.cwd(), "drizzle")
  for (const file of readdirSync(dir).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(join(dir, file), "utf8").replaceAll("--> statement-breakpoint", ""))
  }
}

const NOW = "2026-10-14T20:00:00.000Z"
const creator: AuthUser = {
  id: "user-dan",
  email: "dan@example.com",
  firstName: "Dan",
  lastName: "Crew",
  displayName: "Dan Crew",
  avatarUrl: null,
  role: "field_crew",
  googleEmail: null,
  isActive: true,
  lastLoginAt: null,
  organizationId: "org-1",
  organizationName: "Example Co",
  organizationType: "internal",
  createdAt: NOW,
  updatedAt: NOW,
}

function seed(sqlite: Sqlite): void {
  sqlite.exec(`
    INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-1', 'Example Co', 'example', 'internal', 1, '${NOW}', '${NOW}');
    INSERT INTO users (id, email, display_name, role, is_active, created_at, updated_at, last_login_at) VALUES ('user-dan', 'dan@example.com', 'Dan Crew', 'field_crew', 1, '${NOW}', '${NOW}', NULL);
    INSERT INTO organization_members (id, organization_id, user_id, role, joined_at) VALUES ('m1', 'org-1', 'user-dan', 'field_crew', '${NOW}');
    INSERT INTO projects (id, name, organization_id, status, created_at) VALUES ('p1', 'Bishop Residence', 'org-1', 'active', '${NOW}');
    INSERT INTO project_contacts (id, project_id, contact_type, display_name, role, active, created_at, updated_at) VALUES ('c1', 'p1', 'owner', 'Jordan Bishop', 'Owner', 1, '${NOW}', '${NOW}');
    INSERT INTO project_operations (id, project_id, source_system, source_record_type, title, status, priority, cost_code, sage_write_status, sync_direction, sync_status, created_at, updated_at)
      VALUES ('t1', 'p1', 'compass', 'staff_task', 'Second-floor joists', 'open', 'normal', '06 11 00', 'not_ready', 'write', 'compass_only', '${NOW}', '${NOW}'),
             ('t2', 'p1', 'compass', 'staff_task', 'Framing inspection', 'blocked', 'normal', NULL, 'not_ready', 'write', 'compass_only', '${NOW}', '${NOW}'),
             ('t3', 'p1', 'compass', 'staff_task', 'Already done', 'complete', 'normal', NULL, 'not_ready', 'write', 'compass_only', '${NOW}', '${NOW}');
    INSERT INTO daily_logs (id, project_id, author_id, log_date, work_completed, created_at, updated_at) VALUES ('log-1', 'p1', 'user-dan', '2026-10-14', 'Set joists', '${NOW}', '${NOW}');
    INSERT INTO internal_duty_entries (id, organization_id, project_id, entry_date, user_id, duty_code, duty_label, hours, daily_log_id, todo_id, created_at, updated_at)
      VALUES ('line-1', 'org-1', 'p1', '2026-10-14', 'user-dan', '06 11 00', 'Wood Framing', 20, 'log-1', 't1', '${NOW}', '${NOW}');
  `)
}

describe("daily log follow-ups on the server", () => {
  let sqlite: Sqlite
  let db: ReturnType<typeof getDb>

  beforeEach(() => {
    sqlite = newSqlite()
    migrate(sqlite)
    seed(sqlite)
    db = getDb(d1(sqlite))
  })

  it("lists open to-dos only", async () => {
    const todos = await loadOpenDailyLogTodos(db, "p1")
    expect(todos.map((todo) => [todo.id, todo.status, todo.costCode])).toEqual([
      ["t1", "open", "06 11 00"],
      ["t2", "blocked", null],
    ])
  })

  it("records work, clears a blocked to-do, creates to-dos and logs client contact", async () => {
    const checked = await checkDailyLogFollowUps(db, "org-1", "p1", "2026-10-14", {
      todoUpdates: [
        { todoId: "t1", worked: true, blocked: null },
        { todoId: "t2", worked: false, blocked: "cleared" },
        { todoId: "t3", worked: true, blocked: null },
      ],
      newTodos: [{ source: "issues", title: "Short 40 sheets of subfloor", recordType: "supplier_task", assigneeName: "Nu-Tech", costCode: "06 15 13" }],
      clientContacts: [
        { contactId: "c1", interactionType: "site_visit", direction: "inbound", time: "10:15", summary: "Walked the second floor; asked to move the bath window.", followUpTodo: true },
      ],
    })
    if (!checked.ok) throw new Error(checked.error)
    // A finished to-do drops out instead of failing the log.
    expect(checked.followUps.todoUpdates.map((update) => update.todoId)).toEqual(["t1", "t2"])

    const result = await applyDailyLogFollowUps(db, {
      organizationId: "org-1",
      projectId: "p1",
      dailyLogId: "log-1",
      logDate: "2026-10-14",
      creator,
      workCompleted: "Set joists",
      lines: [{ costCode: "06 11 00", hours: 20, description: "East-side joists", todoId: "t1" }],
      checked,
    })
    expect(result.createdTodos).toBe(2)

    const statuses = sqlite.prepare("SELECT id, status FROM project_operations WHERE id IN ('t1','t2') ORDER BY id").all()
    expect(statuses).toEqual([{ id: "t1", status: "in_progress" }, { id: "t2", status: "in_progress" }])

    const created = sqlite.prepare("SELECT title, source_record_type, source_record_id, assignee_name, cost_code FROM project_operations WHERE source_record_id = 'log-1' ORDER BY title").all()
    expect(created).toEqual([
      { title: "Follow up with Jordan Bishop: Walked the second floor; asked to move the bath window.", source_record_type: "staff_task", source_record_id: "log-1", assignee_name: "Dan Crew", cost_code: null },
      { title: "Short 40 sheets of subfloor", source_record_type: "supplier_task", source_record_id: "log-1", assignee_name: "Nu-Tech", cost_code: "06 15 13" },
    ])

    const interaction = sqlite.prepare("SELECT project_contact_id, interaction_type, direction, daily_log_id, occurred_at, qualifies_for_client_touch FROM project_interactions").get()
    // America/Denver is the default company time zone: 10:15 MDT.
    expect(interaction).toEqual({
      project_contact_id: "c1",
      interaction_type: "site_visit",
      direction: "inbound",
      daily_log_id: "log-1",
      occurred_at: "2026-10-14T16:15:00.000Z",
      qualifies_for_client_touch: 1,
    })

    const history = await loadProjectTodoHistory(db, "p1", "t1")
    expect(history.map((event) => [event.kind, event.fromStatus, event.toStatus, event.note, event.logDate, event.actorName])).toEqual([
      ["worked", "open", "in_progress", "20 h · East-side joists", "2026-10-14", "Dan Crew"],
    ])
    expect((await loadTodoHours(db, "p1")).get("t1")).toBe(20)
    expect((await loadTodoWorkedLogCounts(db, "p1")).get("t1")).toBe(1)
  })

  it("rejects a short client contact summary, but keeps a phone's log", async () => {
    const followUps = {
      todoUpdates: [],
      newTodos: [],
      clientContacts: [{ contactId: "c1", interactionType: "call", direction: "outbound" as const, time: "", summary: "Called", followUpTodo: false }],
    }
    const strict = await checkDailyLogFollowUps(db, "org-1", "p1", "2026-10-14", followUps)
    expect(strict.ok).toBe(false)
    const lenient = await checkDailyLogFollowUps(db, "org-1", "p1", "2026-10-14", followUps, true)
    expect(lenient.ok && lenient.followUps.clientContacts).toEqual([])
  })
})
