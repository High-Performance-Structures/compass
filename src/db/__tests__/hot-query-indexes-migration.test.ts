import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

type PlanRow = { readonly detail: string }

type TestStatement = {
  readonly all: () => readonly unknown[]
}

type TestDatabase = {
  readonly exec: (query: string) => void
  readonly prepare: (query: string) => TestStatement
  readonly close: () => void
}

type TestDatabaseModule = {
  readonly Database: new (filename: string) => TestDatabase
}

function isTestDatabaseModule(value: unknown): value is TestDatabaseModule {
  return (
    value !== null &&
    typeof value === "object" &&
    "Database" in value &&
    typeof value.Database === "function"
  )
}

function isPlanRow(value: unknown): value is PlanRow {
  return (
    value !== null &&
    typeof value === "object" &&
    "detail" in value &&
    typeof value.detail === "string"
  )
}

function migrationSql(): string {
  return readFileSync(
    resolve(process.cwd(), "drizzle/0274_hot_query_indexes.sql"),
    "utf8",
  ).replaceAll("--> statement-breakpoint", "")
}

// Only the columns the hot queries touch, plus the indexes production
// already had, so the planner sees the same choices it does on D1.
const BASE_TABLES = `
  CREATE TABLE projects (id TEXT PRIMARY KEY, organization_id TEXT, status TEXT);
  CREATE UNIQUE INDEX projects_organization_id_unique ON projects (organization_id, id);
  CREATE TABLE project_route_aliases (source_project_id TEXT PRIMARY KEY, target_project_id TEXT);
  CREATE TABLE project_registry_removals (id TEXT PRIMARY KEY, organization_id TEXT, project_id TEXT, removed_at TEXT);
  CREATE UNIQUE INDEX project_registry_removals_org_project_unique ON project_registry_removals (organization_id, project_id);
  CREATE TABLE project_duplicate_decisions (id TEXT PRIMARY KEY, organization_id TEXT, removed_project_id TEXT, status TEXT, updated_at TEXT);
  CREATE INDEX project_duplicate_decisions_org_status_idx ON project_duplicate_decisions (organization_id, status, updated_at);
  CREATE TABLE schedule_tasks (id TEXT PRIMARY KEY, project_id TEXT, start_date TEXT, end_date_calculated TEXT, status TEXT, assigned_user_id TEXT);
  CREATE TABLE messages (id TEXT PRIMARY KEY, channel_id TEXT, thread_id TEXT, created_at TEXT);
  CREATE TABLE channel_members (id TEXT PRIMARY KEY, channel_id TEXT, user_id TEXT);
  CREATE TABLE notification_events (id TEXT PRIMARY KEY, organization_id TEXT, source_type TEXT, event_type TEXT, source_id TEXT, created_at TEXT);
  CREATE INDEX idx_notification_events_org_created ON notification_events (organization_id, created_at);
  CREATE TABLE notification_recipients (id TEXT PRIMARY KEY, event_id TEXT, user_id TEXT);
`

async function createDatabase(): Promise<TestDatabase> {
  let database: TestDatabase
  if ("Bun" in globalThis) {
    const sqliteSpecifier = "bun:sqlite"
    const sqliteModule: unknown = await import(sqliteSpecifier)
    if (!isTestDatabaseModule(sqliteModule)) {
      throw new Error("bun:sqlite did not provide a Database constructor")
    }
    database = new sqliteModule.Database(":memory:")
  } else {
    const { default: Database } = await import("better-sqlite3")
    database = new Database(":memory:")
  }
  database.exec(BASE_TABLES)
  database.exec(migrationSql())
  return database
}

function plan(database: TestDatabase, query: string): string {
  return database
    .prepare(`EXPLAIN QUERY PLAN ${query}`)
    .all()
    .filter(isPlanRow)
    .map((row) => row.detail)
    .join(" | ")
}

describe("0274 hot query indexes", () => {
  it("applies twice without error", async () => {
    const database = await createDatabase()
    expect(() => database.exec(migrationSql())).not.toThrow()
    database.close()
  })

  it("lets the project registry visibility checks seek instead of scan", async () => {
    const database = await createDatabase()
    const detail = plan(
      database,
      `select p.id from projects p where p.organization_id = 'o'
        and not exists (select 1 from project_registry_removals r where r.project_id = p.id)
        and not exists (select 1 from project_duplicate_decisions d
          where d.status = 'confirmed' and d.removed_project_id = p.id)`,
    )
    expect(detail).toContain("project_registry_removals_project_idx")
    expect(detail).toContain("project_duplicate_decisions_removed_idx")
    expect(detail).not.toMatch(/SCAN (r|d)\b/)
    database.close()
  })

  it("reads schedule tasks per project for org-wide date windows", async () => {
    const database = await createDatabase()
    const detail = plan(
      database,
      `select st.id from schedule_tasks st inner join projects p on p.id = st.project_id
        where p.organization_id = 'o' and p.status in ('active', 'planning')
          and st.status <> 'DONE' and st.end_date_calculated >= '2026-10-30'
          and st.start_date <= '2026-11-06'`,
    )
    expect(detail).toContain("schedule_tasks_project_start_idx")
    expect(detail).not.toContain("SCAN st")
    database.close()
  })

  it("serves channel messages and membership checks from indexes", async () => {
    const database = await createDatabase()
    expect(
      plan(
        database,
        `select id from messages where channel_id = 'c' and thread_id is null
          and created_at > 'x' order by created_at desc limit 50`,
      ),
    ).toContain("messages_channel_thread_created_idx")
    expect(
      plan(
        database,
        `select id from channel_members where channel_id = 'c' and user_id = 'u' limit 1`,
      ),
    ).toContain("channel_members_channel_user_idx")
    database.close()
  })

  it("narrows the notification recovery sweep to its source and event type", async () => {
    const database = await createDatabase()
    const detail = plan(
      database,
      `select e.id from notification_events e
        left join notification_events r on r.id = e.id || ':recovered'
        where e.organization_id = 'o' and e.source_type = 's' and e.event_type = 't'
          and e.source_id like 'x%' and e.created_at < 'z' and r.id is null limit 10`,
    )
    expect(detail).toContain(
      "notification_events_org_source_idx (organization_id=? AND source_type=? AND event_type=?",
    )
    database.close()
  })
})
