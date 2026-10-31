import Database from "better-sqlite3"
import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { loadProjectFollowUpSignals } from "@/lib/project-aging-server"
import { activeRegistryProject } from "@/lib/project-registry-visibility"

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

/** A D1-shaped wrapper over SQLite that records every statement it runs. */
function createDb(sqlite: InstanceType<typeof Database>, statements: string[]) {
  function prepared(query: string, values: readonly unknown[] = []): D1Statement {
    const statement = sqlite.prepare(query)
    const returnsRows = /^\s*(select|with)\b/i.test(query)
    const rows = (): unknown[] => {
      statements.push(query)
      if (returnsRows) return statement.all(...values)
      statement.run(...values)
      return []
    }
    return {
      bind: (...nextValues) => prepared(query, nextValues),
      async all() {
        return { success: true, results: rows() }
      },
      async run() {
        statements.push(query)
        return { success: true, meta: { changes: statement.run(...values).changes } }
      },
      async raw() {
        return rows().map((row) =>
          row !== null && typeof row === "object" ? Object.values(row) : [row],
        )
      },
    }
  }
  const fake: FakeD1 = {
    prepare: (query) => prepared(query),
    batch: async (batched) => Promise.all(batched.map(async (statement) => statement.all())),
  }
  if (!isD1Database(fake)) throw new Error("fake D1 is incomplete")
  return getDb(fake)
}

function openDatabase(): InstanceType<typeof Database> {
  const sqlite = new Database(":memory:")
  sqlite.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, organization_id TEXT, name TEXT NOT NULL,
      job_status_id TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE project_route_aliases (source_project_id TEXT PRIMARY KEY, target_project_id TEXT);
    CREATE TABLE project_registry_removals (id TEXT PRIMARY KEY, project_id TEXT);
    CREATE TABLE project_duplicate_decisions (id TEXT PRIMARY KEY, removed_project_id TEXT, status TEXT);
    CREATE TABLE organization_feature_settings (
      id TEXT PRIMARY KEY, organization_id TEXT, feature_key TEXT, value TEXT
    );
    CREATE TABLE project_interactions (
      id TEXT PRIMARY KEY, organization_id TEXT, project_id TEXT, occurred_at TEXT,
      qualifies_for_client_touch INTEGER, deleted_at TEXT
    );
    CREATE TABLE project_follow_ups (
      id TEXT PRIMARY KEY, organization_id TEXT, project_id TEXT, next_follow_up_at TEXT
    );
    CREATE TABLE project_job_statuses (
      id TEXT PRIMARY KEY, organization_id TEXT, follow_up_cadence_days INTEGER, active INTEGER
    );

    INSERT INTO projects (id, organization_id, name, job_status_id, created_at) VALUES
      ('kept', 'org', 'Kept', 'O', '2026-01-01'),
      ('aliased', 'org', 'Merged away', 'O', '2026-01-01'),
      ('removed', 'org', 'Removed', 'O', '2026-01-01'),
      ('merged-duplicate', 'org', 'Duplicate', 'O', '2026-01-01'),
      ('dismissed-duplicate', 'org', 'Not a duplicate', 'O', '2026-01-01'),
      ('other-org', 'org-2', 'Elsewhere', 'O', '2026-01-01');
    INSERT INTO project_route_aliases VALUES ('aliased', 'kept');
    INSERT INTO project_registry_removals VALUES ('r1', 'removed');
    INSERT INTO project_duplicate_decisions VALUES
      ('d1', 'merged-duplicate', 'merged'),
      ('d2', 'dismissed-duplicate', 'dismissed');
  `)
  return sqlite
}

describe("activeRegistryProject", () => {
  let sqlite: InstanceType<typeof Database> | null = null
  afterEach(() => {
    sqlite?.close()
    sqlite = null
  })

  it("hides merged, removed, and merged-duplicate projects only", async () => {
    sqlite = openDatabase()
    const db = createDb(sqlite, [])
    const rows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(activeRegistryProject(db))
    expect(rows.map((row) => row.id).sort()).toEqual([
      "dismissed-duplicate",
      "kept",
      "other-org",
    ])
    const scoped = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.organizationId, "org"))
    expect(scoped).toHaveLength(5)
  })
})

describe("loadProjectFollowUpSignals creation dates", () => {
  let sqlite: InstanceType<typeof Database> | null = null
  afterEach(() => {
    sqlite?.close()
    sqlite = null
  })

  function withNoContactClock(database: InstanceType<typeof Database>): void {
    database
      .prepare("INSERT INTO organization_feature_settings VALUES ('s1', 'org', 'project-aging', ?)")
      .run(JSON.stringify({ noContactClockStart: "2026-01-01T00:00:00.000Z" }))
  }

  function projectReads(statements: readonly string[]): readonly string[] {
    return statements.filter((query) => /from "projects"/.test(query))
  }

  it("skips the projects read when the caller already has creation dates", async () => {
    sqlite = openDatabase()
    withNoContactClock(sqlite)
    const statements: string[] = []
    await loadProjectFollowUpSignals(
      createDb(sqlite, statements),
      "org",
      [{ id: "kept", jobStatusId: "O", createdAt: "2026-01-01" }],
      new Date("2026-10-30T12:00:00.000Z"),
    )
    expect(projectReads(statements)).toEqual([])
  })

  it("reads only the jobs missing a creation date, not the whole company", async () => {
    sqlite = openDatabase()
    withNoContactClock(sqlite)
    const statements: string[] = []
    await loadProjectFollowUpSignals(
      createDb(sqlite, statements),
      "org",
      [{ id: "kept", jobStatusId: "O" }],
      new Date("2026-10-30T12:00:00.000Z"),
    )
    const reads = projectReads(statements)
    expect(reads).toHaveLength(1)
    expect(reads[0]).toMatch(/"projects"\."id" in \(\?\)/)
  })
})
