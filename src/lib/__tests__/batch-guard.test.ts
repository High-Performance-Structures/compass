import { eq, sql } from "drizzle-orm"
import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { describe, expect, it } from "vitest"

import { batchGuardStatement, isBatchGuardFailure } from "@/lib/d1-query"
import { sqliteDb } from "@/lib/domain/__tests__/sqlite-d1"

const t = sqliteTable("t", { id: text("id").primaryKey(), status: text("status").notNull() })
const log = sqliteTable("log", { id: text("id") })

/* The batch guard fails (and rolls back) a D1 batch when its condition no longer holds. */
describe("batchGuardStatement", () => {
  function setup() {
    const { sqlite, db } = sqliteDb("CREATE TABLE t (id TEXT PRIMARY KEY, status TEXT NOT NULL); CREATE TABLE log (id TEXT);")
    sqlite.exec("INSERT INTO t VALUES ('a', 'open')")
    return { sqlite, db }
  }

  it("lets the batch run while the condition holds", async () => {
    const { sqlite, db } = setup()
    await db.batch([
      batchGuardStatement(db, sql`EXISTS (SELECT 1 FROM t WHERE id = 'a' AND status = 'open')`, "still open"),
      db.update(t).set({ status: "done" }).where(eq(t.id, "a")),
      db.insert(log).values({ id: "done" }),
    ])
    expect(sqlite.prepare("SELECT status FROM t").get()).toEqual({ status: "done" })
    expect(sqlite.prepare("SELECT count(*) AS n FROM log").get()).toEqual({ n: 1 })
  })

  it("rolls the whole batch back when it no longer holds", async () => {
    const { sqlite, db } = setup()
    sqlite.exec("UPDATE t SET status = 'void'")
    const run = db.batch([
      db.insert(log).values({ id: "before" }),
      batchGuardStatement(db, sql`EXISTS (SELECT 1 FROM t WHERE id = 'a' AND status = 'open')`, "still open"),
      db.insert(log).values({ id: "after" }),
    ])
    const error = await run.catch((caught: unknown) => caught)
    expect(isBatchGuardFailure(error)).toBe(true)
    expect(sqlite.prepare("SELECT count(*) AS n FROM log").get()).toEqual({ n: 0 })
  })
})
