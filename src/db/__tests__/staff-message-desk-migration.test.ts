import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const migration = [
  readFileSync(
    resolve(process.cwd(), "drizzle/0109_staff_message_desk.sql"),
    "utf8"
  ),
  readFileSync(
    resolve(process.cwd(), "drizzle/0110_staff_message_desk_integrity.sql"),
    "utf8"
  ),
]
  .join("\n")
  .replaceAll("--> statement-breakpoint", "")

describe("Staff Message Desk migration", () => {
  it("enforces active internal assignees, governed statuses, and immutable history", async () => {
    const database = await openDatabase()
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE organizations (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          is_active INTEGER NOT NULL
        );
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          is_active INTEGER NOT NULL
        );
        CREATE TABLE organization_members (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL
        );
        CREATE TABLE goto_inbound_events (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'needs_review',
          review_reason TEXT,
          processed_at TEXT
        );
        INSERT INTO organizations VALUES ('org-internal', 'internal', 1), ('org-client', 'client', 1);
        INSERT INTO users VALUES
          ('staff', 1), ('replacement', 1), ('role-staff', 1),
          ('moved-staff', 1), ('user-staff', 1), ('inactive', 0), ('external', 1);
        INSERT INTO organization_members VALUES
          ('member-staff', 'org-internal', 'staff', 'office'),
          ('member-replacement', 'org-internal', 'replacement', 'office'),
          ('member-role-staff', 'org-internal', 'role-staff', 'office'),
          ('member-moved-staff', 'org-internal', 'moved-staff', 'office'),
          ('member-user-staff', 'org-internal', 'user-staff', 'office'),
          ('member-inactive', 'org-internal', 'inactive', 'office'),
          ('member-external', 'org-client', 'external', 'client');
      `)
      database.exec(migration)
      const insert = database.prepare(`
        INSERT INTO staff_message_records (
          id, organization_id, source_type, caller_name, subject, body,
          status, assignee_user_id, goto_inbound_event_id, deleted_at,
          created_at, updated_at
        ) VALUES (?, ?, 'call', 'Caller', 'Subject', 'Body', ?, ?, ?, ?, '2026-08-16', '2026-08-16')
      `)
      insert.run("record-1", "org-internal", "New", "staff", null, null)
      expect(() =>
        database.prepare("UPDATE users SET is_active = 0 WHERE id = 'staff'").run()
      ).toThrow(/Reassign active staff message records/)
      expect(() =>
        database.prepare("DELETE FROM organization_members WHERE id = 'member-staff'").run()
      ).toThrow(/Reassign active staff message records/)
      expect(() =>
        database.prepare("UPDATE organization_members SET role = 'client' WHERE id = 'member-staff'").run()
      ).toThrow(/Reassign active staff message records/)
      database.prepare("UPDATE staff_message_records SET assignee_user_id = 'replacement' WHERE id = 'record-1'").run()
      database.prepare("DELETE FROM organization_members WHERE id = 'member-staff'").run()

      expect(() => insert.run("record-2", "org-internal", "New", "inactive", null, null)).toThrow(
        /active internal staff assignee/
      )
      insert.run("record-3", "org-internal", "New", "role-staff", null, null)
      expect(() =>
        database.prepare("UPDATE organization_members SET role = 'client' WHERE id = 'member-role-staff'").run()
      ).toThrow(/Reassign active staff message records/)
      database.prepare("UPDATE staff_message_records SET assignee_user_id = 'replacement' WHERE id = 'record-3'").run()
      database.prepare("UPDATE organization_members SET role = 'client' WHERE id = 'member-role-staff'").run()

      insert.run("record-4", "org-internal", "New", "moved-staff", null, null)
      expect(() =>
        database.prepare("UPDATE organization_members SET organization_id = 'org-client' WHERE id = 'member-moved-staff'").run()
      ).toThrow(/Reassign active staff message records/)
      database.prepare("UPDATE staff_message_records SET assignee_user_id = 'replacement' WHERE id = 'record-4'").run()
      database.prepare("UPDATE organization_members SET organization_id = 'org-client' WHERE id = 'member-moved-staff'").run()

      insert.run("record-5", "org-internal", "New", "user-staff", null, null)
      expect(() =>
        database.prepare("UPDATE organization_members SET user_id = 'replacement' WHERE id = 'member-user-staff'").run()
      ).toThrow(/Reassign active staff message records/)
      database.prepare("UPDATE staff_message_records SET assignee_user_id = 'replacement' WHERE id = 'record-5'").run()
      database.prepare("UPDATE organization_members SET user_id = 'replacement' WHERE id = 'member-user-staff'").run()

      expect(() => insert.run("record-6", "org-internal", "Not a status", "replacement", null, null)).toThrow()

      database.prepare("INSERT INTO goto_inbound_events (id) VALUES ('goto-1')").run()
      insert.run("linked-1", "org-internal", "New", "replacement", "goto-1", null)
      expect(() => insert.run("linked-2", "org-internal", "New", "replacement", "goto-1", null)).toThrow()
      database.prepare("UPDATE goto_inbound_events SET status = 'processed', processed_at = '2026-08-17T12:00:00.000Z' WHERE id = 'goto-1'").run()
      expect(database.prepare("SELECT status, processed_at FROM goto_inbound_events WHERE id = 'goto-1'").get()).toEqual({
        status: "processed",
        processed_at: "2026-08-17T12:00:00.000Z",
      })
      database.prepare("UPDATE staff_message_records SET deleted_at = '2026-08-17' WHERE id = 'linked-1'").run()
      database.prepare("UPDATE goto_inbound_events SET status = 'needs_review', processed_at = NULL WHERE id = 'goto-1'").run()
      expect(database.prepare("SELECT status, processed_at FROM goto_inbound_events WHERE id = 'goto-1'").get()).toEqual({
        status: "needs_review",
        processed_at: null,
      })
      insert.run("linked-2", "org-internal", "New", "replacement", "goto-1", null)
      database.prepare(`
        INSERT INTO staff_message_history (
          id, organization_id, record_id, actor_user_id, action, to_status, created_at
        ) VALUES ('history-1', 'org-internal', 'record-1', 'staff', 'created', 'New', '2026-08-16')
      `).run()
      expect(() =>
        database.prepare("UPDATE staff_message_history SET note = 'tampered' WHERE id = 'history-1'").run()
      ).toThrow(/immutable/)
      expect(() =>
        database.prepare("DELETE FROM staff_message_history WHERE id = 'history-1'").run()
      ).toThrow(/immutable/)
    } finally {
      database.close()
    }
  })
})

type TestDatabase = {
  readonly exec: (sql: string) => unknown
  readonly prepare: (sql: string) => {
    readonly run: (...values: unknown[]) => unknown
    readonly get: (...values: unknown[]) => unknown
  }
  readonly close: () => void
}

type BunDatabaseModule = {
  readonly Database: new (filename: string) => TestDatabase
}

function isBunDatabaseModule(value: unknown): value is BunDatabaseModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "Database" in value &&
    typeof value.Database === "function"
  )
}

async function openDatabase(): Promise<TestDatabase> {
  if ("Bun" in globalThis) {
    const bunSqliteSpecifier = "bun:sqlite"
    const sqliteModule: unknown = await import(bunSqliteSpecifier)
    if (!isBunDatabaseModule(sqliteModule)) {
      throw new Error("bun:sqlite did not provide a Database constructor")
    }
    return new sqliteModule.Database(":memory:")
  }
  const { default: Database } = await import("better-sqlite3")
  return new Database(":memory:")
}
