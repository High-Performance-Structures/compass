import Database from "better-sqlite3"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

function ids(sqlite: InstanceType<typeof Database>, table: string): readonly string[] {
  return sqlite
    .prepare(`SELECT id FROM ${table} ORDER BY id`)
    .all()
    .map((row) => (typeof row === "object" && row !== null && "id" in row ? String(row.id) : ""))
}

function migrationSql(): string {
  return readFileSync(resolve(process.cwd(), "drizzle/0277_channel_membership_unique.sql"), "utf8").replaceAll(
    "--> statement-breakpoint",
    "",
  )
}

function openDatabase(): InstanceType<typeof Database> {
  const sqlite = new Database(":memory:")
  sqlite.exec(`
    CREATE TABLE channel_members (id TEXT PRIMARY KEY, channel_id TEXT, user_id TEXT, role TEXT, notify_level TEXT, joined_at TEXT);
    CREATE TABLE channel_read_state (id TEXT PRIMARY KEY, user_id TEXT, channel_id TEXT, last_read_message_id TEXT, last_read_at TEXT, unread_count INTEGER);
    INSERT INTO channel_members VALUES
      ('keep', 'c1', 'u1', 'moderator', 'mentions', '2026-07-01T02:57:17.608Z'),
      ('later', 'c1', 'u1', 'moderator', 'mentions', '2026-07-01T02:57:17.636Z'),
      ('other-user', 'c1', 'u2', 'member', 'all', '2026-07-01T02:57:17.636Z'),
      ('other-channel', 'c2', 'u1', 'member', 'all', '2026-07-01T02:57:17.636Z');
    INSERT INTO channel_read_state VALUES
      ('keep-rs', 'u1', 'c1', NULL, '2026-07-01T02:57:17.608Z', 0),
      ('later-rs', 'u1', 'c1', NULL, '2026-07-01T02:57:17.636Z', 0),
      ('tie-a', 'u3', 'c1', NULL, '2026-07-02T00:00:00.000Z', 0),
      ('tie-b', 'u3', 'c1', NULL, '2026-07-02T00:00:00.000Z', 0);
  `)
  return sqlite
}

describe("0277 channel membership uniqueness", () => {
  it("keeps the earliest row of each duplicate pair and nothing else changes", () => {
    const sqlite = openDatabase()
    sqlite.exec(migrationSql())
    expect(ids(sqlite, "channel_members")).toEqual([
      "keep",
      "other-channel",
      "other-user",
    ])
    expect(ids(sqlite, "channel_read_state")).toEqual(["keep-rs", "tie-a"])
    sqlite.close()
  })

  it("then refuses a second membership for the same person and channel", () => {
    const sqlite = openDatabase()
    sqlite.exec(migrationSql())
    expect(() =>
      sqlite.prepare("INSERT INTO channel_members VALUES ('again', 'c1', 'u1', 'member', 'all', '2026-10-30')").run(),
    ).toThrow(/UNIQUE/)
    sqlite.exec(migrationSql())
    sqlite.close()
  })
})
