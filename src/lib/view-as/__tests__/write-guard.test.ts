import { describe, expect, it, vi } from "vitest"

import { ViewAsReadOnlyError } from "@/lib/view-as/errors"
import { isReadOnlySql, readOnlyD1, readOnlyEnv } from "@/lib/view-as/write-guard"

/** A tiny stand-in for a D1 binding that records what actually ran. */
function fakeD1() {
  const ran: string[] = []
  const statement = (sql: string, values: unknown[] = []): D1PreparedStatement => {
    const run = async () => {
      ran.push(sql)
      return { success: true, results: [], meta: {} }
    }
    return {
      bind: (...next: unknown[]) => statement(sql, [...values, ...next]),
      run,
      all: run,
      first: async () => {
        ran.push(sql)
        return null
      },
      raw: async () => {
        ran.push(sql)
        return []
      },
    } satisfies Record<string, unknown> as unknown as D1PreparedStatement
  }
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: vi.fn(async (statements: D1PreparedStatement[]) => statements.map(() => ({ success: true, results: [], meta: {} }))),
    exec: vi.fn(async () => ({ count: 1, duration: 0 })),
  }
  return { db, ran }
}

describe("isReadOnlySql", () => {
  it("allows plain reads", () => {
    expect(isReadOnlySql("select * from users")).toBe(true)
    expect(isReadOnlySql("  /* note */ SELECT 1")).toBe(true)
    expect(isReadOnlySql("-- comment\nselect 1")).toBe(true)
    expect(isReadOnlySql("(select 1) union (select 2)")).toBe(true)
    expect(isReadOnlySql("with x as (select 1) select * from x")).toBe(true)
    expect(isReadOnlySql("pragma table_info(users)")).toBe(true)
    expect(isReadOnlySql("PRAGMA table_info('users')")).toBe(true)
    expect(isReadOnlySql("pragma user_version")).toBe(true)
    expect(isReadOnlySql('select "updated_at" from projects')).toBe(true)
  })

  it("refuses writes, unknown SQL and stacked statements", () => {
    expect(isReadOnlySql("insert into users values (1)")).toBe(false)
    expect(isReadOnlySql("UPDATE users SET name = 'x'")).toBe(false)
    expect(isReadOnlySql("delete from users")).toBe(false)
    expect(isReadOnlySql("replace into users values (1)")).toBe(false)
    expect(isReadOnlySql("with x as (select 1) insert into users select * from x")).toBe(false)
    expect(isReadOnlySql("pragma foreign_keys = off")).toBe(false)
    expect(isReadOnlySql("PRAGMA foreign_keys(OFF)")).toBe(false)
    expect(isReadOnlySql("pragma optimize")).toBe(false)
    expect(isReadOnlySql("pragma user_version(5)")).toBe(false)
    expect(isReadOnlySql("pragma wal_checkpoint(TRUNCATE)")).toBe(false)
    expect(isReadOnlySql("select 1; delete from users")).toBe(false)
    expect(isReadOnlySql("create table t (id text)")).toBe(false)
    expect(isReadOnlySql("")).toBe(false)
  })
})

describe("readOnlyD1", () => {
  it("runs reads against the real binding", async () => {
    const { db, ran } = fakeD1()
    const guarded = readOnlyD1(db as unknown as D1Database)
    await guarded.prepare("select * from users where id = ?").bind("u1").all()
    expect(ran).toEqual(["select * from users where id = ?"])
  })

  it("rejects writes while viewing as, without touching the database", async () => {
    const { db, ran } = fakeD1()
    const guarded = readOnlyD1(db as unknown as D1Database)
    await expect(guarded.prepare("insert into users (id) values (?)").bind("u1").run()).rejects.toBeInstanceOf(ViewAsReadOnlyError)
    await expect(guarded.prepare("update users set name = ?").bind("x").first()).rejects.toBeInstanceOf(ViewAsReadOnlyError)
    await expect(guarded.prepare("delete from users").raw()).rejects.toBeInstanceOf(ViewAsReadOnlyError)
    await expect(guarded.exec("delete from users")).rejects.toBeInstanceOf(ViewAsReadOnlyError)
    expect(ran).toEqual([])
    expect(db.exec).not.toHaveBeenCalled()
  })

  it("rejects a batch that contains any write and passes read batches through", async () => {
    const { db } = fakeD1()
    const guarded = readOnlyD1(db as unknown as D1Database)
    await expect(
      guarded.batch([guarded.prepare("select 1"), guarded.prepare("insert into users (id) values ('x')")]),
    ).rejects.toBeInstanceOf(ViewAsReadOnlyError)
    expect(db.batch).not.toHaveBeenCalled()
    await guarded.batch([guarded.prepare("select 1"), guarded.prepare("select 2")])
    expect(db.batch).toHaveBeenCalledTimes(1)
  })

  it("rejects batch statements that did not come through the guard", async () => {
    const { db } = fakeD1()
    const guarded = readOnlyD1(db as unknown as D1Database)
    await expect(guarded.batch([db.prepare("select 1")])).rejects.toBeInstanceOf(ViewAsReadOnlyError)
  })
})

describe("skip mode (page renders)", () => {
  it("drops writes without running them and still runs the reads of a mixed batch", async () => {
    const { db, ran } = fakeD1()
    const guarded = readOnlyD1(db as unknown as D1Database, "skip")
    await expect(guarded.prepare("insert into seen values (1)").run()).resolves.toMatchObject({ success: true, results: [] })
    await expect(guarded.prepare("update seen set at = 1 returning *").first()).resolves.toBeNull()
    const results = await guarded.batch([guarded.prepare("select 1"), guarded.prepare("delete from seen")])
    expect(results).toHaveLength(2)
    expect(db.batch).toHaveBeenCalledWith([expect.anything()])
    expect(ran).toEqual([])
    await expect(guarded.exec("delete from seen")).resolves.toEqual({ count: 0, duration: 0 })
    expect(db.exec).not.toHaveBeenCalled()
  })
})

describe("readOnlyEnv", () => {
  it("guards the database and storage bindings and leaves secrets alone", async () => {
    const { db, ran } = fakeD1()
    const bucket = { put: vi.fn(), get: vi.fn(async () => null), delete: vi.fn() }
    const env = { DB: db, HELP_VIDEOS: bucket, AGENT_AUTH_SECRET: "secret" } as unknown as CloudflareEnv
    const guarded = readOnlyEnv(env)
    await expect(guarded.DB.prepare("insert into x values (1)").run()).rejects.toBeInstanceOf(ViewAsReadOnlyError)
    await guarded.DB.prepare("select 1").all()
    expect(ran).toEqual(["select 1"])
    const videos = guarded.HELP_VIDEOS
    if (!videos) throw new Error("missing bucket")
    await expect(videos.put("k", "v")).rejects.toBeInstanceOf(ViewAsReadOnlyError)
    await expect(videos.delete("k")).rejects.toBeInstanceOf(ViewAsReadOnlyError)
    await videos.get("k")
    expect(bucket.put).not.toHaveBeenCalled()
    expect(bucket.get).toHaveBeenCalled()
    expect(Reflect.get(guarded, "AGENT_AUTH_SECRET")).toBe("secret")
    expect(readOnlyEnv(env)).toBe(guarded)
  })
})
