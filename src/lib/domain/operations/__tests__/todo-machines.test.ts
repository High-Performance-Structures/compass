import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/notifications/events", () => ({ notifyProjectAssignment: vi.fn(async () => undefined) }))
vi.mock("@/lib/notifications/clear-on-read", () => ({ clearOverdueFollowUpReminders: vi.fn(async () => undefined) }))

import { getDb } from "@/db"
import type { AuthUser } from "@/lib/auth"
import { d1, migratedSqlite, type Sqlite } from "@/lib/daily-logs/__tests__/sqlite-d1"
import { applyDailyLogFollowUps, checkDailyLogFollowUps, loadProjectTodoHistory } from "@/lib/daily-logs/log-followups-server"
import { moveTodoStatusAutomatically, setTodoStatusByStaff } from "@/lib/domain/operations/store"
import {
  automaticTodoSourceSpellings,
  automaticTodoStatusAfter,
  automaticTodoStatusAfterEvents,
  todoAutomation,
} from "@/lib/domain/operations/todo-machines"
import { RECORD_STATUS_REGISTRY } from "@/lib/domain/record-statuses/registry"
import { availableEvents, machineProblems } from "@/lib/shared/state-machine"

describe("to-do status automation", () => {
  it("is well formed apart from blocked, which only staff set, and uses built-in statuses only", () => {
    expect(machineProblems(todoAutomation)).toEqual(['state "blocked" cannot be reached from "open"'])
    const builtIn = RECORD_STATUS_REGISTRY.todo.statuses.map((status) => status.key)
    for (const state of todoAutomation.states) expect(builtIn).toContain(state)
  })

  it("starts only open to-dos and unblocks only blocked ones", () => {
    expect(automaticTodoStatusAfter("start", "open")).toBe("in_progress")
    expect(automaticTodoStatusAfter("unblock", "blocked")).toBe("in_progress")
    expect(automaticTodoStatusAfter("unblock", "on_hold")).toBe("in_progress")
    for (const status of ["in_progress", "blocked", "complete", "archived"]) {
      expect(automaticTodoStatusAfter("start", status)).toBeNull()
    }
    expect(automaticTodoStatusAfter("unblock", "open")).toBeNull()
  })

  it("completes only through the log's sign-off, and never touches finished, archived or company statuses", () => {
    for (const status of ["open", "in_progress", "blocked"]) expect(automaticTodoStatusAfter("complete", status)).toBe("complete")
    for (const event of ["start", "unblock", "complete"] as const) {
      for (const status of ["complete", "done", "archived", "cancelled", "waiting_on_owner"]) {
        expect(automaticTodoStatusAfter(event, status)).toBeNull()
      }
    }
    expect(availableEvents(todoAutomation, "complete")).toEqual([])
  })

  it("applies a log's moves in order, or not at all", () => {
    expect(automaticTodoStatusAfterEvents(["unblock", "complete"], "blocked")).toBe("complete")
    expect(automaticTodoStatusAfterEvents(["start", "complete"], "open")).toBe("complete")
    expect(automaticTodoStatusAfterEvents(["start", "start"], "open")).toBeNull()
  })

  it("matches the stored spelling it read, so compare-and-set finds the row", () => {
    expect(automaticTodoSourceSpellings("blocked")).toEqual(["blocked", "on_hold"])
    expect(automaticTodoSourceSpellings("Open")).toEqual(["open", "Open"])
    expect(automaticTodoSourceSpellings("archived")).toEqual([])
    expect(automaticTodoSourceSpellings("waiting_on_owner")).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The store and the daily log against a real schema.
// ---------------------------------------------------------------------------

const NOW = "2026-11-12T20:00:00.000Z"
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

describe("to-do status writes", () => {
  let sqlite: Sqlite
  let db: ReturnType<typeof getDb>
  const statusOf = (id: string): unknown => sqlite.prepare("SELECT status FROM project_operations WHERE id = ?").get(id)
  const events = (id: string): readonly Record<string, unknown>[] =>
    sqlite.prepare("SELECT kind, from_status, to_status FROM project_todo_events WHERE todo_id = ? ORDER BY created_at").all(id)

  beforeEach(() => {
    sqlite = migratedSqlite()
    sqlite.exec(`
      INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-1', 'Example Co', 'example', 'internal', 1, '${NOW}', '${NOW}');
      INSERT INTO users (id, email, display_name, role, is_active, created_at, updated_at, last_login_at) VALUES ('user-dan', 'dan@example.com', 'Dan Crew', 'field_crew', 1, '${NOW}', '${NOW}', NULL);
      INSERT INTO projects (id, name, organization_id, status, created_at) VALUES ('p1', 'Bishop Residence', 'org-1', 'active', '${NOW}');
      INSERT INTO project_operations (id, project_id, source_system, source_record_type, title, status, priority, sage_write_status, sync_direction, sync_status, created_at, updated_at)
        VALUES ('t1', 'p1', 'compass', 'staff_task', 'Second-floor joists', 'open', 'normal', 'not_ready', 'write', 'compass_only', '${NOW}', '${NOW}'),
               ('t2', 'p1', 'compass', 'staff_task', 'Framing inspection', 'blocked', 'normal', 'not_ready', 'write', 'compass_only', '${NOW}', '${NOW}'),
               ('po', 'p1', 'compass', 'purchase_order', 'Lumber', 'draft', 'normal', 'not_ready', 'write', 'compass_only', '${NOW}', '${NOW}');
      INSERT INTO daily_logs (id, project_id, author_id, log_date, work_completed, created_at, updated_at) VALUES ('log-1', 'p1', 'user-dan', '2026-11-12', 'Set joists', '${NOW}', '${NOW}');
    `)
    db = getDb(d1(sqlite))
  })

  const statusEvent = (todoId: string, fromStatus: string, toStatus: string) => ({
    organizationId: "org-1", projectId: "p1", todoId, kind: "status" as const, dailyLogId: null, fromStatus, toStatus, note: null, actorId: "user-dan",
  })

  it("a staff change lands only on the status the person saw, with its history", async () => {
    const stale = await setTodoStatusByStaff(db, {
      projectId: "p1", todoId: "t1", expectedUpdatedAt: NOW, expectedStatus: "in_progress", status: "complete",
      history: statusEvent("t1", "in_progress", "complete"), updatedAt: "2026-11-12T21:00:00.000Z",
    })
    expect(stale).toBeNull()
    expect(statusOf("t1")).toEqual({ status: "open" })
    expect(events("t1")).toEqual([])

    const saved = await setTodoStatusByStaff(db, {
      projectId: "p1", todoId: "t1", expectedUpdatedAt: NOW, expectedStatus: "open", status: "complete",
      history: statusEvent("t1", "open", "complete"), updatedAt: "2026-11-12T21:00:00.000Z",
    })
    expect(saved).toEqual({ id: "t1", updatedAt: "2026-11-12T21:00:00.000Z" })
    expect(statusOf("t1")).toEqual({ status: "complete" })
    expect(events("t1")).toEqual([{ kind: "status", from_status: "open", to_status: "complete" }])
  })

  it("never moves a record that isn't a to-do", async () => {
    expect(await setTodoStatusByStaff(db, {
      projectId: "p1", todoId: "po", expectedUpdatedAt: NOW, expectedStatus: "draft", status: "complete", history: null, updatedAt: NOW,
    })).toBeNull()
    expect(await moveTodoStatusAutomatically(db, { projectId: "p1", todoId: "po", stored: "open", events: ["complete"], history: [], updatedAt: NOW })).toBe(false)
    expect(statusOf("po")).toEqual({ status: "draft" })
  })

  it("an automatic move the machine refuses writes nothing", async () => {
    const moved = await moveTodoStatusAutomatically(db, {
      projectId: "p1", todoId: "t1", stored: "open", events: ["unblock"], history: [statusEvent("t1", "open", "in_progress")], updatedAt: NOW,
    })
    expect(moved).toBe(false)
    expect(events("t1")).toEqual([])
  })

  async function checkedLog(updates: Parameters<typeof checkDailyLogFollowUps>[4]["todoUpdates"]) {
    const checked = await checkDailyLogFollowUps(db, "org-1", "p1", "2026-11-12", { todoUpdates: updates, newTodos: [], clientContacts: [] })
    if (!checked.ok) throw new Error(checked.error)
    return checked
  }

  const apply = (checked: Awaited<ReturnType<typeof checkedLog>>) =>
    applyDailyLogFollowUps(db, { organizationId: "org-1", projectId: "p1", dailyLogId: "log-1", logDate: "2026-11-12", creator, workCompleted: "Set joists", lines: [], checked })

  it("a daily log leaves a to-do someone archived while it was saving, and still records the work", async () => {
    const checked = await checkedLog([{ todoId: "t1", worked: true, completed: true, blocked: null }])
    sqlite.exec("UPDATE project_operations SET status = 'archived' WHERE id = 't1'")
    await apply(checked)

    expect(statusOf("t1")).toEqual({ status: "archived" })
    expect(events("t1")).toEqual([{ kind: "worked", from_status: "archived", to_status: "archived" }])
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM activity_events WHERE action = 'todo_completed'").get()).toEqual({ n: 0 })
  })

  it("a daily log doesn't unblock a to-do staff reopened meanwhile", async () => {
    const checked = await checkedLog([{ todoId: "t2", worked: false, blocked: "cleared" }])
    sqlite.exec("UPDATE project_operations SET status = 'open' WHERE id = 't2'")
    await apply(checked)

    expect(statusOf("t2")).toEqual({ status: "open" })
    expect(events("t2")).toEqual([])
  })

  it("a daily log clears a block and signs off in one write, with history in order", async () => {
    await apply(await checkedLog([{ todoId: "t2", worked: true, completed: true, blocked: "cleared" }]))

    expect(statusOf("t2")).toEqual({ status: "complete" })
    const history = await loadProjectTodoHistory(db, "p1", "t2")
    expect(history.map((event) => [event.kind, event.fromStatus, event.toStatus])).toEqual([
      ["unblocked", "blocked", "in_progress"],
      ["worked", "in_progress", "in_progress"],
      ["completed", "in_progress", "complete"],
    ])
  })
})

// ---------------------------------------------------------------------------
// Guard: to-do status changes go through the store's to-do status functions,
// and their history is written with them.
// ---------------------------------------------------------------------------

/** The text of every call to `name(` in `source`, through its closing parenthesis. */
function calls(source: string, name: string): string[] {
  const found: string[] = []
  let at = source.indexOf(`${name}(`)
  while (at >= 0) {
    let depth = 0
    let end = at + name.length
    for (; end < source.length; end++) {
      if (source[end] === "(") depth++
      if (source[end] === ")" && --depth === 0) break
    }
    found.push(source.slice(at, end))
    at = source.indexOf(`${name}(`, end)
  }
  return found
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe("to-do status writes guard", () => {
  it("the store's to-do status writes are compare-and-set and decided by the machine", () => {
    const store = readFileSync("src/lib/domain/operations/store.ts", "utf8")
    const body = (name: string): string => {
      const from = store.slice(store.indexOf(`export async function ${name}`))
      return from.slice(0, from.indexOf("\n}\n"))
    }
    expect(body("setTodoStatusByStaff")).toContain("eq(projectOperations.status, input.expectedStatus)")
    expect(body("setTodoStatusByStaff")).toContain("eq(projectOperations.updatedAt, input.expectedUpdatedAt)")
    const automatic = body("moveTodoStatusAutomatically")
    expect(automatic).toContain("automaticTodoStatusAfterEvents(move.events, move.stored)")
    expect(automatic).toContain("inArray(projectOperations.status, [...from])")
  })

  it("status-change history is never written on its own", () => {
    const offenders = sourceFiles("src").flatMap((file) => {
      return calls(readFileSync(file, "utf8"), "recordTodoEvent")
        .filter((call) => /kind: "(status|completed|unblocked)"/.test(call))
        .map((call) => `${file}: ${call.slice(0, 80)}`)
    })
    expect(offenders).toEqual([])
  }, 30_000) // reads the whole source tree; slow under a full parallel run
})
