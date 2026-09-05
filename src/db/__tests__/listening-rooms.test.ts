import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

type Statement = {
  readonly get: () => Record<string, unknown> | undefined
  readonly run: () => unknown
}

type TestDatabase = {
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => Statement
  readonly close: () => void
}

type TestDatabaseModule = {
  readonly Database: new (filename: string) => TestDatabase
}

type NodeTestDatabaseModule = {
  readonly DatabaseSync: new (filename: string) => TestDatabase
}

function isTestDatabaseModule(value: unknown): value is TestDatabaseModule {
  return (
    value !== null &&
    typeof value === "object" &&
    "Database" in value &&
    typeof value.Database === "function"
  )
}

function isNodeTestDatabaseModule(value: unknown): value is NodeTestDatabaseModule {
  return (
    value !== null &&
    typeof value === "object" &&
    "DatabaseSync" in value &&
    typeof value.DatabaseSync === "function"
  )
}

async function openDatabase(): Promise<TestDatabase> {
  if ("Bun" in globalThis) {
    const sqliteSpecifier = "bun:sqlite"
    const sqliteModule: unknown = await import(sqliteSpecifier)
    if (!isTestDatabaseModule(sqliteModule)) {
      throw new Error("bun:sqlite did not provide a Database constructor")
    }
    return new sqliteModule.Database(":memory:")
  }

  const sqliteSpecifier = "node:sqlite"
  const sqliteModule: unknown = await import(sqliteSpecifier)
  if (!isNodeTestDatabaseModule(sqliteModule)) {
    throw new Error("node:sqlite did not provide a DatabaseSync constructor")
  }
  return new sqliteModule.DatabaseSync(":memory:")
}

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0148_listening_rooms.sql"),
  "utf8"
).replaceAll("--> statement-breakpoint", "")

describe("listening room schema", () => {
  it("supports a collaborative multi-provider queue and cascades room cleanup", async () => {
    const database = await openDatabase()
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE channels (id TEXT PRIMARY KEY NOT NULL);
        INSERT INTO users (id) VALUES ('host'), ('listener');
        INSERT INTO channels (id) VALUES ('office-talk');
      `)
      database.exec(migration)
      database.exec(`
        INSERT INTO listening_rooms (
          id, channel_id, host_user_id, playback_state,
          anchor_position_ms, created_at, updated_at
        ) VALUES (
          'room-1', 'office-talk', 'host', 'paused',
          0, '2026-09-03T18:00:00.000Z', '2026-09-03T18:00:00.000Z'
        );
        INSERT INTO listening_queue_items (
          id, room_id, title, sort_order, added_by, created_at
        ) VALUES
          (
            'track-1', 'room-1', 'Shared song', 0, 'listener',
            '2026-09-03T18:01:00.000Z'
          ),
          (
            'track-2', 'room-1', 'Concurrent song', 0, 'host',
            '2026-09-03T18:01:00.000Z'
          );
        INSERT INTO listening_track_links (
          id, queue_item_id, provider, url, added_by, created_at
        ) VALUES
          ('link-spotify', 'track-1', 'spotify', 'https://open.spotify.com/track/1', 'listener', '2026-09-03T18:01:00.000Z'),
          ('link-apple', 'track-1', 'apple_music', 'https://music.apple.com/us/song/1', 'host', '2026-09-03T18:02:00.000Z');
        INSERT INTO listening_room_participants (
          id, room_id, user_id, preferred_provider, joined_at, updated_at
        ) VALUES
          ('participant-host', 'room-1', 'host', 'apple_music', '2026-09-03T18:00:00.000Z', '2026-09-03T18:00:00.000Z'),
          ('participant-listener', 'room-1', 'listener', 'spotify', '2026-09-03T18:01:00.000Z', '2026-09-03T18:01:00.000Z');
      `)

      expect(
        database.prepare("SELECT COUNT(*) AS value FROM listening_track_links").get()?.value
      ).toBe(2)
      expect(
        database.prepare("SELECT COUNT(*) AS value FROM listening_room_participants").get()?.value
      ).toBe(2)
      expect(
        database.prepare(`
          SELECT id
          FROM listening_queue_items
          WHERE room_id = 'room-1'
            AND played_at IS NULL
            AND (
              sort_order > 0
              OR (sort_order = 0 AND created_at > '2026-09-03T18:01:00.000Z')
              OR (
                sort_order = 0
                AND created_at = '2026-09-03T18:01:00.000Z'
                AND id > 'track-1'
              )
            )
          ORDER BY sort_order, created_at, id
          LIMIT 1
        `).get()?.id
      ).toBe("track-2")

      database.prepare("DELETE FROM listening_rooms WHERE id = 'room-1'").run()
      expect(
        database.prepare("SELECT COUNT(*) AS value FROM listening_queue_items").get()?.value
      ).toBe(0)
      expect(
        database.prepare("SELECT COUNT(*) AS value FROM listening_track_links").get()?.value
      ).toBe(0)
      expect(
        database.prepare("SELECT COUNT(*) AS value FROM listening_room_participants").get()?.value
      ).toBe(0)
    } finally {
      database.close()
    }
  })

  it("allows only one link per provider for each queued track", async () => {
    const database = await openDatabase()
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE channels (id TEXT PRIMARY KEY NOT NULL);
        INSERT INTO users (id) VALUES ('host');
        INSERT INTO channels (id) VALUES ('office-talk');
      `)
      database.exec(migration)
      database.exec(`
        INSERT INTO listening_rooms (
          id, channel_id, host_user_id, created_at, updated_at
        ) VALUES ('room-1', 'office-talk', 'host', 'now', 'now');
        INSERT INTO listening_queue_items (
          id, room_id, title, sort_order, added_by, created_at
        ) VALUES ('track-1', 'room-1', 'Song', 0, 'host', 'now');
        INSERT INTO listening_track_links (
          id, queue_item_id, provider, url, added_by, created_at
        ) VALUES ('link-1', 'track-1', 'spotify', 'https://open.spotify.com/track/1', 'host', 'now');
      `)

      expect(() => database.prepare(`
        INSERT INTO listening_track_links (
          id, queue_item_id, provider, url, added_by, created_at
        ) VALUES ('link-2', 'track-1', 'spotify', 'https://open.spotify.com/track/2', 'host', 'now');
      `).run()).toThrow()
    } finally {
      database.close()
    }
  })
})
