import Database from "better-sqlite3"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { loadWorkingSchedule } from "@/lib/domain/schedule/queries"

const MIGRATIONS_DIR = join(process.cwd(), "drizzle")
const D1_MAX_BOUND_PARAMETERS = 100

type D1Statement = Readonly<{
  readonly bind: (...values: readonly unknown[]) => D1Statement
  readonly all: () => Promise<{ readonly success: true; readonly results: readonly unknown[] }>
  readonly run: () => Promise<{ readonly success: true; readonly meta: { readonly changes: number } }>
  readonly raw: () => Promise<readonly unknown[][]>
}>

type FakeD1 = {
  readonly prepare: (query: string) => D1Statement
  readonly batch: (statements: readonly D1Statement[]) => Promise<readonly unknown[]>
}

function isD1Database(value: FakeD1): value is FakeD1 & D1Database {
  return typeof value.prepare === "function"
}

/** SQLite behind a D1-shaped API that, like D1, rejects >100 bound values. */
function d1(sqlite: InstanceType<typeof Database>) {
  function prepared(query: string, values: readonly unknown[] = []): D1Statement {
    const statement = sqlite.prepare(query)
    const guard = (): void => {
      if (values.length > D1_MAX_BOUND_PARAMETERS) throw new Error("D1_ERROR: too many SQL variables")
    }
    const returnsRows = /^\s*(select|with)\b/i.test(query)
    const rows = (): unknown[] => {
      if (returnsRows) return statement.all(...values)
      statement.run(...values)
      return []
    }
    return {
      bind: (...next) => prepared(query, next),
      async all() {
        guard()
        return { success: true, results: rows() }
      },
      async run() {
        guard()
        return { success: true, meta: { changes: statement.run(...values).changes } }
      },
      async raw() {
        guard()
        return rows().map((row) => (row !== null && typeof row === "object" ? Object.values(row) : [row]))
      },
    }
  }
  const fake: FakeD1 = {
    prepare: (query) => prepared(query),
    batch: async (statements) => Promise.all(statements.map(async (statement) => statement.all())),
  }
  if (!isD1Database(fake)) throw new Error("fake D1 is incomplete")
  return getDb(fake)
}

function migratedDatabase(): InstanceType<typeof Database> {
  const sqlite = new Database(":memory:")
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8").replaceAll("--> statement-breakpoint", ""))
  }
  return sqlite
}

describe("loadWorkingSchedule assignees", () => {
  it("keeps every task's assignees on schedules longer than D1's parameter limit", async () => {
    const sqlite = migratedDatabase()
    sqlite.pragma("foreign_keys = OFF")
    const now = "2026-10-30T00:00:00.000Z"
    sqlite.prepare("INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org', 'Org', 'org', 'internal', 1, ?, ?)").run(now, now)
    sqlite.prepare("INSERT INTO projects (id, name, organization_id, created_at) VALUES ('p1', 'Big job', 'org', ?)").run(now)
    const insertTask = sqlite.prepare(
      "INSERT INTO schedule_tasks (id, project_id, title, start_date, workdays, end_date_calculated, phase, sort_order, created_at, updated_at) VALUES (?, 'p1', ?, '2026-11-02', 1, '2026-11-02', 'Framing', ?, ?, ?)"
    )
    const insertAssignee = sqlite.prepare(
      "INSERT INTO schedule_task_assignees (id, schedule_task_id, participant_id, source_start_date, source_workdays, source_end_date, assigned_at, created_at, updated_at) VALUES (?, ?, ?, '2026-11-02', 1, '2026-11-02', ?, ?, ?)"
    )
    for (let index = 0; index < 150; index += 1) {
      insertTask.run(`t${index}`, `Task ${index}`, index, now, now)
      insertAssignee.run(`a${index}`, `t${index}`, `participant-${index}`, now, now, now)
    }

    const schedule = await loadWorkingSchedule(d1(sqlite), "p1")

    expect(schedule.tasks).toHaveLength(150)
    expect(schedule.tasks.every((task) => (task.assignees ?? []).length === 1)).toBe(true)
    const last = schedule.tasks.find((task) => task.id === "t149")
    expect(last?.assignees?.[0]?.participantId).toBe("participant-149")
    sqlite.close()
  })
})
