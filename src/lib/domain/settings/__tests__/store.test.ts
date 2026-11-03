import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { sqliteDb } from "@/lib/domain/__tests__/sqlite-d1"

import {
  clearSavedViewDefault,
  deleteOwnedProjectSavedView,
  deleteOwnScheduleSavedView,
  deleteProjectSavedViewsOwnedByStatements,
  deleteSavedViewDefaultsForUserStatement,
  deleteUserPushTokens,
  insertProjectSavedView,
  insertScheduleSavedView,
  registerPushToken,
  saveSavedViewDefault,
  updateOwnedProjectSavedView,
  updateScheduleSavedView,
} from "../store"

const SCHEMA = `
  CREATE TABLE push_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
    platform TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
`

let current: ReturnType<typeof sqliteDb> | null = null
function open(): ReturnType<typeof sqliteDb> {
  current = sqliteDb(SCHEMA)
  return current
}
afterEach(() => {
  current?.sqlite.close()
  current = null
})

describe("push tokens", () => {
  it("moves a device token to the account that registers it and keeps one token per platform", async () => {
    const { sqlite, db } = open()
    await registerPushToken(db, { id: "a", userId: "alice", token: "device-1", platform: "ios", now: "t1" })
    await registerPushToken(db, { id: "b", userId: "bob", token: "device-1", platform: "ios", now: "t2" })
    await registerPushToken(db, { id: "c", userId: "bob", token: "device-2", platform: "ios", now: "t3" })
    expect(sqlite.prepare("SELECT id, user_id, token FROM push_tokens").all()).toEqual([
      { id: "c", user_id: "bob", token: "device-2" },
    ])
  })

  it("removes one token, or every token on sign-out", async () => {
    const { sqlite, db } = open()
    await registerPushToken(db, { id: "a", userId: "alice", token: "device-1", platform: "ios", now: "t1" })
    await registerPushToken(db, { id: "b", userId: "alice", token: "device-2", platform: "android", now: "t1" })
    await deleteUserPushTokens(db, "alice", "device-1")
    expect(sqlite.prepare("SELECT id FROM push_tokens").all()).toEqual([{ id: "b" }])
    await deleteUserPushTokens(db, "alice", null)
    expect(sqlite.prepare("SELECT id FROM push_tokens").all()).toEqual([])
  })
})

function savedViewsDb(): ReturnType<typeof sqliteDb> {
  const migrations = ["0075_schedule_saved_views.sql", "0260_project_saved_views.sql", "0282_saved_views.sql"]
    .map((file) => readFileSync(resolve(process.cwd(), "drizzle", file), "utf8").replaceAll("--> statement-breakpoint", ""))
  current = sqliteDb(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT);
    CREATE TABLE organizations (id TEXT PRIMARY KEY);
    CREATE TABLE user_view_preferences (user_id TEXT NOT NULL, view_key TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, view_key));
    INSERT INTO users VALUES ('alice', 'Alice'), ('bob', 'Bob');
    INSERT INTO organizations VALUES ('org'), ('other');
    ${migrations.join("\n")}
  `)
  return current
}

type Sqlite = ReturnType<typeof sqliteDb>["sqlite"]
const consolidated = (sqlite: Sqlite): unknown[] =>
  sqlite.prepare("SELECT id, organization_id, owner_user_id, scope, name, visibility, definition, updated_at FROM saved_views ORDER BY id").all()
const row = (id: string, name: string, extra: Partial<{ ownerUserId: string; visibility: "personal" | "shared" }> = {}) => ({
  id, organizationId: "org", ownerUserId: extra.ownerUserId ?? "alice", name, visibility: extra.visibility ?? "personal",
  definition: '{"v":1}', createdAt: "t0", updatedAt: "t0",
})

describe("saved project views", () => {
  function seed(sqlite: Sqlite): void {
    // A row from before 0282: only in the legacy table until the backfill.
    sqlite.exec(`INSERT INTO project_saved_views VALUES ('v1', 'org', 'alice', 'Mine', 'personal', '{"old":true}', 't0', 't0')`)
  }

  it("updates only the owner's view, keeps stored filters, and mirrors it into saved_views", async () => {
    const { sqlite, db } = savedViewsDb()
    seed(sqlite)
    const input = { id: "v1", organizationId: "org", name: "Renamed", visibility: "shared" as const, updatedAt: "t1" }
    expect(await updateOwnedProjectSavedView(db, { ...input, ownerUserId: "bob" })).toBeUndefined()
    const updated = await updateOwnedProjectSavedView(db, { ...input, ownerUserId: "alice" })
    expect(updated).toMatchObject({ name: "Renamed", visibility: "shared", definition: '{"old":true}', updatedAt: "t1" })
    expect(consolidated(sqlite)).toEqual([
      { id: "v1", organization_id: "org", owner_user_id: "alice", scope: "projects", name: "Renamed", visibility: "shared", definition: '{"old":true}', updated_at: "t1" },
    ])
    await updateOwnedProjectSavedView(db, { ...input, name: "Again", definition: '{"new":true}', updatedAt: "t2", ownerUserId: "alice" })
    expect(consolidated(sqlite)).toMatchObject([{ id: "v1", name: "Again", definition: '{"new":true}', updated_at: "t2" }])
  })

  it("inserts into both tables with one id, and a failed insert leaves neither", async () => {
    const { sqlite, db } = savedViewsDb()
    await insertProjectSavedView(db, row("v2", "Mine"))
    await expect(insertProjectSavedView(db, row("v3", "Mine"))).rejects.toThrow()
    expect(sqlite.prepare("SELECT id FROM project_saved_views").all()).toEqual([{ id: "v2" }])
    expect(consolidated(sqlite)).toMatchObject([{ id: "v2", scope: "projects" }])
  })

  it("deletes only a view the user owns in that organization, from both tables", async () => {
    const { sqlite, db } = savedViewsDb()
    await insertProjectSavedView(db, row("v1", "Mine"))
    expect(await deleteOwnedProjectSavedView(db, { id: "v1", organizationId: "other", ownerUserId: "alice" })).toBeUndefined()
    expect(consolidated(sqlite)).toHaveLength(1)
    expect(await deleteOwnedProjectSavedView(db, { id: "v1", organizationId: "org", ownerUserId: "alice" })).toEqual({ id: "v1" })
    expect(sqlite.prepare("SELECT id FROM project_saved_views").all()).toEqual([])
    expect(consolidated(sqlite)).toEqual([])
  })

  it("removes a person's project views and defaults on account deletion but leaves schedule views", async () => {
    const { sqlite, db } = savedViewsDb()
    await insertProjectSavedView(db, row("p1", "Mine"))
    await insertScheduleSavedView(db, row("s1", "Mine"))
    await saveSavedViewDefault(db, { userId: "alice", organizationId: "org", scope: "projects", legacyViewKey: "k", inlineDefinition: "{}", updatedAt: "t" })
    await db.batch([...deleteProjectSavedViewsOwnedByStatements(db, "alice"), deleteSavedViewDefaultsForUserStatement(db, "alice")])
    expect(consolidated(sqlite)).toMatchObject([{ id: "s1", scope: "schedule" }])
    expect(sqlite.prepare("SELECT * FROM saved_view_defaults").all()).toEqual([])
  })
})

describe("saved schedule views", () => {
  it("dual-writes insert, update and owner-only delete", async () => {
    const { sqlite, db } = savedViewsDb()
    await insertScheduleSavedView(db, row("s1", "Crew"))
    await updateScheduleSavedView(db, "s1", { visibility: "shared", definition: '{"v":2}', updatedAt: "t1" })
    expect(consolidated(sqlite)).toEqual([
      { id: "s1", organization_id: "org", owner_user_id: "alice", scope: "schedule", name: "Crew", visibility: "shared", definition: '{"v":2}', updated_at: "t1" },
    ])
    await deleteOwnScheduleSavedView(db, { id: "s1", organizationId: "org", ownerUserId: "bob" })
    expect(consolidated(sqlite)).toHaveLength(1)
    await deleteOwnScheduleSavedView(db, { id: "s1", organizationId: "org", ownerUserId: "alice" })
    expect(consolidated(sqlite)).toEqual([])
    expect(sqlite.prepare("SELECT id FROM schedule_saved_views").all()).toEqual([])
  })

  it("lets one name exist for a project view and a schedule view", async () => {
    const { sqlite, db } = savedViewsDb()
    await insertProjectSavedView(db, row("p1", "Same"))
    await insertScheduleSavedView(db, row("s1", "Same"))
    expect(consolidated(sqlite)).toHaveLength(2)
  })

  it("does not copy a legacy row whose visibility is not personal or shared", async () => {
    const { sqlite, db } = savedViewsDb()
    sqlite.exec(`INSERT INTO schedule_saved_views VALUES ('s9', 'org', 'alice', 'Odd', 'team', '{}', 't0', 't0')`)
    await updateScheduleSavedView(db, "s9", { visibility: "personal", definition: "{}", updatedAt: "t1" })
    expect(consolidated(sqlite)).toMatchObject([{ id: "s9", visibility: "personal" }])
  })
})

describe("saved view defaults", () => {
  it("writes the snapshot to both stores and clears both", async () => {
    const { sqlite, db } = savedViewsDb()
    const key = { userId: "alice", organizationId: "org", scope: "projects", legacyViewKey: "project-hub-default:org" } as const
    await saveSavedViewDefault(db, { ...key, inlineDefinition: '{"a":1}', updatedAt: "t1" })
    await saveSavedViewDefault(db, { ...key, inlineDefinition: '{"a":2}', updatedAt: "t2" })
    expect(sqlite.prepare("SELECT value FROM user_view_preferences").all()).toEqual([{ value: '{"a":2}' }])
    expect(sqlite.prepare("SELECT user_id, organization_id, scope, view_id, inline_definition FROM saved_view_defaults").all()).toEqual([
      { user_id: "alice", organization_id: "org", scope: "projects", view_id: null, inline_definition: '{"a":2}' },
    ])
    await clearSavedViewDefault(db, key)
    expect(sqlite.prepare("SELECT * FROM user_view_preferences").all()).toEqual([])
    expect(sqlite.prepare("SELECT * FROM saved_view_defaults").all()).toEqual([])
  })
})
