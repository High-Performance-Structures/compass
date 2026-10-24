import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

type SqliteStatement = Readonly<{
  readonly run: (...values: readonly unknown[]) => { readonly changes: number }
  readonly get: (...values: readonly unknown[]) => unknown
}>

type Sqlite = Readonly<{
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => SqliteStatement
  readonly close: () => void
}>

type SqliteConstructor = new (file: string) => Sqlite

const nodeRequire = createRequire(import.meta.url)
const migrationPath = resolve(
  process.cwd(),
  "drizzle/0245_owner_update_publish_attachment_atomicity.sql"
)

function isSqliteConstructor(value: unknown): value is SqliteConstructor {
  return typeof value === "function"
}

function newSqlite(path: string): Sqlite {
  const imported: unknown = nodeRequire("better-sqlite3")
  const constructor =
    typeof imported === "function"
      ? imported
      : imported !== null && typeof imported === "object"
        ? Reflect.get(imported, "default")
        : undefined
  if (!isSqliteConstructor(constructor)) {
    throw new Error("better-sqlite3 is required for the two-actor regression")
  }
  return new constructor(path)
}

function seedAtomicityFixture(sqlite: Sqlite): void {
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE owner_project_updates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      selected_photo_ids TEXT,
      schedule_snapshot TEXT,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL
    );
    CREATE TABLE daily_log_photos (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      review_status TEXT NOT NULL,
      owner_visible INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  const migration = readFileSync(migrationPath, "utf8").split(
    "--> statement-breakpoint"
  )[0]
  sqlite.exec(migration)
  sqlite
    .prepare(
      `INSERT INTO owner_project_updates
       (id, project_id, status, selected_photo_ids, updated_at, revision)
       VALUES (?, ?, 'draft', ?, ?, 0)`
    )
    .run(
      "update-1",
      "project-1",
      JSON.stringify(["photo-1"]),
      "2026-07-28T14:20:14.659Z"
    )
  sqlite
    .prepare(
      `INSERT INTO daily_log_photos
       (id, project_id, review_status, owner_visible, updated_at)
       VALUES (?, ?, 'pending', 0, ?)`
    )
    .run("photo-1", "project-1", "2026-07-28T14:20:14.659Z")
}

describe("owner-update publish atomicity migration", () => {
  it("moves attachment approval into the revision-fenced publish statement", () => {
    expect(existsSync(migrationPath)).toBe(true)
    const sql = readFileSync(migrationPath, "utf8")

    expect(sql).toContain("owner_update_publish_attachment_approval")
    expect(sql).toContain("AFTER UPDATE OF `status`")
    expect(sql).toContain("OLD.`status` = 'draft'")
    expect(sql).toContain("NEW.`status` = 'published'")
    expect(sql).toContain("json_each")
    expect(sql).toContain("$.documents")
  })

  it("keeps attachment approval and publication atomic across two SQLite actors", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "compass-owner-update-"))
    const databasePath = resolve(directory, "atomicity.sqlite")
    const actorA = newSqlite(databasePath)
    const actorB = newSqlite(databasePath)

    try {
      seedAtomicityFixture(actorA)
      actorA.exec("PRAGMA busy_timeout = 1")
      actorB.exec("PRAGMA busy_timeout = 1")
      actorA.exec("BEGIN IMMEDIATE")

      actorA
        .prepare(
          `UPDATE owner_project_updates
           SET status = 'published', updated_at = ?, revision = revision + 1
           WHERE id = ? AND status = 'draft' AND revision = 0`
        )
        .run("2026-07-28T14:30:00.000Z", "update-1")

      expect(
        actorA
          .prepare(
            "SELECT review_status, owner_visible FROM daily_log_photos WHERE id = ?"
          )
          .get("photo-1")
      ).toEqual({ review_status: "approved", owner_visible: 1 })

      expect(() =>
        actorB
          .prepare(
            "UPDATE owner_project_updates SET revision = revision + 1 WHERE id = ?"
          )
          .run("update-1")
      ).toThrow()

      actorA.exec("ROLLBACK")
      actorB
        .prepare(
          "UPDATE owner_project_updates SET revision = revision + 1 WHERE id = ?"
        )
        .run("update-1")

      expect(
        actorB
          .prepare(
            "SELECT status, revision FROM owner_project_updates WHERE id = ?"
          )
          .get("update-1")
      ).toEqual({ status: "draft", revision: 1 })
      expect(
        actorB
          .prepare(
            "SELECT review_status, owner_visible FROM daily_log_photos WHERE id = ?"
          )
          .get("photo-1")
      ).toEqual({ review_status: "pending", owner_visible: 0 })
    } finally {
      actorA.close()
      actorB.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
