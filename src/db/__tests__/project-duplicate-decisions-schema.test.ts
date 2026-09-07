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
    INSERT INTO organizations (id) VALUES ('org-1');
    INSERT INTO users (id) VALUES ('user-1');
  `)
  database.exec(
    readFileSync(
      resolve(process.cwd(), "drizzle/0157_project_duplicate_decisions.sql"),
      "utf8",
    ).replaceAll("--> statement-breakpoint", ""),
  )
  return database
}

describe("project duplicate decisions migration", () => {
  it("stores a reviewed non-duplicate pair once", async () => {
    const database = await createDatabase()
    database.exec(`
      INSERT INTO project_duplicate_decisions (
        id, organization_id, project_a_id, project_b_id, status, score,
        reasons_json, resolved_by_user_id, resolved_at, created_at, updated_at
      ) VALUES (
        'decision-1', 'org-1', 'project-a', 'project-b', 'not_duplicate', 70,
        '[]', 'user-1', 'now', 'now', 'now'
      );
    `)

    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM project_duplicate_decisions")
        .get(),
    ).toEqual({ count: 1 })
    expect(() =>
      database
        .prepare(`
          INSERT INTO project_duplicate_decisions (
            id, organization_id, project_a_id, project_b_id, status, score,
            reasons_json, resolved_at, created_at, updated_at
          ) VALUES (
            'decision-2', 'org-1', 'project-a', 'project-b', 'not_duplicate', 70,
            '[]', 'now', 'now', 'now'
          )
        `)
        .run(),
    ).toThrow(/UNIQUE constraint failed/)
    database.close()
  })

  it("requires an ordered pair and both merge selections", async () => {
    const database = await createDatabase()

    expect(() =>
      database
        .prepare(`
          INSERT INTO project_duplicate_decisions (
            id, organization_id, project_a_id, project_b_id, status,
            kept_project_id, removed_project_id, score, reasons_json,
            resolved_at, created_at, updated_at
          ) VALUES (
            'reversed', 'org-1', 'project-z', 'project-a', 'merged',
            'project-a', 'project-z', 100, '[]', 'now', 'now', 'now'
          )
        `)
        .run(),
    ).toThrow(/CHECK constraint failed/)

    expect(() =>
      database
        .prepare(`
          INSERT INTO project_duplicate_decisions (
            id, organization_id, project_a_id, project_b_id, status, score,
            reasons_json, resolved_at, created_at, updated_at
          ) VALUES (
            'missing-selection', 'org-1', 'project-a', 'project-z', 'merged',
            100, '[]', 'now', 'now', 'now'
          )
        `)
        .run(),
    ).toThrow(/CHECK constraint failed/)
    database.close()
  })
})
