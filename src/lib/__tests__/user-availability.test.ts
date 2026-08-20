import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { describe, expect, it } from "vitest"

import { users } from "@/db/schema"
import { getUserAvailabilityCondition } from "@/lib/user-availability"

function createUsersDatabase(): InstanceType<typeof Database> {
  const sqlite = new Database(":memory:")
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      is_active INTEGER NOT NULL,
      last_login_at TEXT
    );
    INSERT INTO users (id, is_active, last_login_at) VALUES
      ('user_active', 1, '2026-08-20T00:00:00.000Z'),
      ('user_deactivated', 0, NULL),
      ('pending-invitation-id', 0, NULL),
      ('legacy-deactivated-id', 0, '2026-08-19T00:00:00.000Z');
  `)
  return sqlite
}

describe("getUserAvailabilityCondition", () => {
  it("returns active users and pending invitation placeholders for Settings", () => {
    const sqlite = createUsersDatabase()
    try {
      const db = drizzle(sqlite)
      const result = db
        .select({ id: users.id })
        .from(users)
        .where(getUserAvailabilityCondition(true))
        .all()

      expect(result.map((row) => row.id).sort()).toEqual([
        "pending-invitation-id",
        "user_active",
      ])
    } finally {
      sqlite.close()
    }
  })

  it("returns only active users for collaboration surfaces", () => {
    const sqlite = createUsersDatabase()
    try {
      const db = drizzle(sqlite)
      const result = db
        .select({ id: users.id })
        .from(users)
        .where(getUserAvailabilityCondition(false))
        .all()

      expect(result).toEqual([{ id: "user_active" }])
    } finally {
      sqlite.close()
    }
  })
})
