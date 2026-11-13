import Database from "better-sqlite3"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { applyMigrations, migratedDatabase } from "@/test/migrated-database"

type Sqlite = InstanceType<typeof Database>

function schema(db: Sqlite): unknown {
  return db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all()
}

describe("migrated test database", () => {
  let replayed: Sqlite
  // Two full migration replays (direct and the cached template): setup, not the assertion.
  beforeAll(() => {
    replayed = new Database(":memory:")
    applyMigrations((sql) => replayed.exec(sql))
    migratedDatabase().close()
  }, 60_000)
  afterAll(() => replayed.close())

  it("matches a database built by replaying every migration directly", () => {
    const copy = migratedDatabase()
    expect(schema(copy)).toEqual(schema(replayed))
    expect(copy.pragma("foreign_keys", { simple: true })).toBe(replayed.pragma("foreign_keys", { simple: true }))
    copy.close()
  })

  it("hands out independent, writable copies", () => {
    const first = migratedDatabase()
    const second = migratedDatabase()
    first.exec("CREATE TABLE copy_probe (id TEXT)")
    first.prepare("INSERT INTO copy_probe (id) VALUES (?)").run("a")
    expect(first.prepare("SELECT count(*) AS n FROM copy_probe").get()).toEqual({ n: 1 })
    expect(second.prepare("SELECT name FROM sqlite_master WHERE name = 'copy_probe'").get()).toBeUndefined()
    first.close()
    second.close()
  })
})
