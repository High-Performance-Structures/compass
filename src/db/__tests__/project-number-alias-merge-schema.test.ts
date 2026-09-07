import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

type TestStatement = {
  readonly all: () => unknown
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

function migrationSql(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8").replaceAll(
    "--> statement-breakpoint",
    "",
  )
}

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

  database.exec("PRAGMA foreign_keys = ON")
  database.exec(`
    CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE projects (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL,
      project_number TEXT
    );
    INSERT INTO organizations (id) VALUES ('org-1');
    INSERT INTO users (id) VALUES ('user-1');
    INSERT INTO projects (id, organization_id, project_number)
    VALUES
      ('kept', 'org-1', 'H100'),
      ('removed', 'org-1', 'H200'),
      ('kept-unnumbered', 'org-1', NULL),
      ('removed-numbered', 'org-1', 'H300');
  `)
  database.exec(migrationSql("drizzle/0104_project_number_aliases.sql"))
  database.exec(migrationSql("drizzle/0105_project_number_namespace.sql"))
  return database
}

describe("project number aliases during a registry merge", () => {
  it("releases the removed active number before reserving it on the kept project", async () => {
    const database = await createDatabase()

    expect(() =>
      database
        .prepare(`
          INSERT INTO project_number_aliases (
            id, organization_id, project_id, project_number, created_by, created_at
          ) VALUES ('blocked', 'org-1', 'kept', 'H200', 'user-1', 'now')
        `)
        .run(),
    ).toThrow(/project number is active on another project/)

    database.exec(`
      BEGIN;
      UPDATE projects SET project_number = NULL WHERE id = 'removed';
      INSERT INTO project_number_aliases (
        id, organization_id, project_id, project_number, created_by, created_at
      ) VALUES ('merge-alias', 'org-1', 'kept', 'H200', 'user-1', 'now');
      COMMIT;
    `)

    expect(
      database
        .prepare(`
          SELECT project_id AS projectId, project_number AS projectNumber
          FROM project_number_aliases
        `)
        .all(),
    ).toEqual([{ projectId: "kept", projectNumber: "H200" }])
    expect(
      database
        .prepare(`
          SELECT id, project_number AS projectNumber
          FROM projects
          WHERE id IN ('kept', 'removed')
          ORDER BY id
        `)
        .all(),
    ).toEqual([
      { id: "kept", projectNumber: "H100" },
      { id: "removed", projectNumber: null },
    ])
    database.close()
  })

  it("transfers the active number when the kept project is unnumbered", async () => {
    const database = await createDatabase()

    database.exec(`
      BEGIN;
      UPDATE projects SET project_number = NULL WHERE id = 'removed-numbered';
      UPDATE projects SET project_number = 'H300' WHERE id = 'kept-unnumbered';
      COMMIT;
    `)

    expect(
      database
        .prepare(`
          SELECT id, project_number AS projectNumber
          FROM projects
          WHERE id IN ('kept-unnumbered', 'removed-numbered')
          ORDER BY id
        `)
        .all(),
    ).toEqual([
      { id: "kept-unnumbered", projectNumber: "H300" },
      { id: "removed-numbered", projectNumber: null },
    ])
    expect(
      database
        .prepare(`
          SELECT COUNT(*) AS count
          FROM project_number_aliases
          WHERE project_number = 'H300'
        `)
        .all(),
    ).toEqual([{ count: 0 }])
    database.close()
  })
})
