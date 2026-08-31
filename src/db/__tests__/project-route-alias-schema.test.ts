import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

type TestStatement = {
  readonly get: () => unknown
  readonly run: () => unknown
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

function migrationSql(): string {
  return readFileSync(
    resolve(process.cwd(), "drizzle/0143_project_route_aliases.sql"),
    "utf8",
  ).replaceAll("--> statement-breakpoint", "")
}

async function createDatabase(): Promise<TestDatabase> {
  if ("Bun" in globalThis) {
    const sqliteSpecifier = "bun:sqlite"
    const sqliteModule: unknown = await import(sqliteSpecifier)
    if (!isTestDatabaseModule(sqliteModule)) {
      throw new Error("bun:sqlite did not provide a Database constructor")
    }
    return initializeDatabase(new sqliteModule.Database(":memory:"))
  }

  const { default: Database } = await import("better-sqlite3")
  return initializeDatabase(new Database(":memory:"))
}

function initializeDatabase(database: TestDatabase): TestDatabase {
  database.exec("PRAGMA foreign_keys = ON")
  database.exec(`
    CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE projects (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE
    );
  `)
  database.exec(migrationSql())
  database.exec(`
    INSERT INTO organizations (id) VALUES ('org-1'), ('org-2');
    INSERT INTO projects (id, organization_id)
    VALUES
      ('canonical-project', 'org-1'),
      ('other-org-project', 'org-2');
  `)
  return database
}

describe("project route alias migration", () => {
  it("allows an alias for a deleted source while requiring a live target", async () => {
    const database = await createDatabase()

    database.exec(`
      INSERT INTO project_route_aliases (
        source_project_id,
        target_project_id,
        organization_id,
        source_system,
        source_external_id,
        reason,
        created_at
      ) VALUES (
        'deleted-lead-project',
        'canonical-project',
        'org-1',
        'buildertrend',
        'lead-123',
        'exact_project_number_merge',
        '2026-08-31T00:00:00.000Z'
      );
    `)

    const aliasCount = database
      .prepare("SELECT COUNT(*) AS count FROM project_route_aliases")
      .get()
    expect(aliasCount).toEqual({ count: 1 })

    expect(() =>
      database
        .prepare(`
          INSERT INTO project_route_aliases (
            source_project_id,
            target_project_id,
            organization_id,
            created_at
          ) VALUES ('another-source', 'missing-target', 'org-1', 'now')
        `)
        .run(),
    ).toThrow(/target must belong to the same organization/)

    expect(() =>
      database
        .prepare(`
          INSERT INTO project_route_aliases (
            source_project_id,
            target_project_id,
            organization_id,
            created_at
          ) VALUES ('cross-org-source', 'other-org-project', 'org-1', 'now')
        `)
        .run(),
    ).toThrow(/target must belong to the same organization/)

    database.close()
  })

  it("rejects self-aliases and cascades aliases when the target is deleted", async () => {
    const database = await createDatabase()

    expect(() =>
      database
        .prepare(`
          INSERT INTO project_route_aliases (
            source_project_id,
            target_project_id,
            organization_id,
            created_at
          ) VALUES ('canonical-project', 'canonical-project', 'org-1', 'now')
        `)
        .run(),
    ).toThrow(/CHECK constraint failed/)

    database.exec(`
      INSERT INTO project_route_aliases (
        source_project_id,
        target_project_id,
        organization_id,
        created_at
      ) VALUES ('deleted-lead-project', 'canonical-project', 'org-1', 'now');
      DELETE FROM projects WHERE id = 'canonical-project';
    `)

    const aliasCount = database
      .prepare("SELECT COUNT(*) AS count FROM project_route_aliases")
      .get()
    expect(aliasCount).toEqual({ count: 0 })

    database.close()
  })
})
