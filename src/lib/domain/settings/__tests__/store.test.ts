import { afterEach, describe, expect, it } from "vitest"

import { sqliteDb } from "@/lib/domain/__tests__/sqlite-d1"

import { deleteOwnedProjectSavedView, deleteUserPushTokens, registerPushToken, updateOwnedProjectSavedView } from "../store"

const SCHEMA = `
  CREATE TABLE push_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
    platform TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE project_saved_views (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
    name TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'personal', definition TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
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

describe("saved project views", () => {
  function seed(sqlite: ReturnType<typeof sqliteDb>["sqlite"]): void {
    sqlite.exec(`INSERT INTO project_saved_views VALUES ('v1', 'org', 'alice', 'Mine', 'personal', '{"old":true}', 't0', 't0')`)
  }

  it("updates only the owner's view and keeps stored filters when no definition is given", async () => {
    const { sqlite, db } = open()
    seed(sqlite)
    const input = { id: "v1", organizationId: "org", name: "Renamed", visibility: "shared" as const, updatedAt: "t1" }
    expect(await updateOwnedProjectSavedView(db, { ...input, ownerUserId: "bob" })).toBeUndefined()
    const updated = await updateOwnedProjectSavedView(db, { ...input, ownerUserId: "alice" })
    expect(updated).toMatchObject({ name: "Renamed", visibility: "shared", definition: '{"old":true}', updatedAt: "t1" })
  })

  it("deletes only a view the user owns in that organization", async () => {
    const { sqlite, db } = open()
    seed(sqlite)
    expect(await deleteOwnedProjectSavedView(db, { id: "v1", organizationId: "other", ownerUserId: "alice" })).toBeUndefined()
    expect(await deleteOwnedProjectSavedView(db, { id: "v1", organizationId: "org", ownerUserId: "alice" })).toEqual({ id: "v1" })
    expect(sqlite.prepare("SELECT id FROM project_saved_views").all()).toEqual([])
  })
})
