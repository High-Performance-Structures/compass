import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { sqliteDb } from "@/lib/domain/__tests__/sqlite-d1"

import { findOwnScheduleSavedViewId, listVisibleSavedViews, readSavedViewDefault } from "../saved-views"
import { insertProjectSavedView, insertScheduleSavedView, saveSavedViewDefault } from "../store"

let current: ReturnType<typeof sqliteDb> | null = null
afterEach(() => {
  current?.sqlite.close()
  current = null
  vi.restoreAllMocks()
})

function open(options: { readonly withSavedViews: boolean } = { withSavedViews: true }): ReturnType<typeof sqliteDb> {
  const files = ["0075_schedule_saved_views.sql", "0260_project_saved_views.sql", ...(options.withSavedViews ? ["0282_saved_views.sql"] : [])]
  const migrations = files.map((file) => readFileSync(resolve(process.cwd(), "drizzle", file), "utf8").replaceAll("--> statement-breakpoint", ""))
  current = sqliteDb(`
    CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT);
    CREATE TABLE organizations (id TEXT PRIMARY KEY);
    CREATE TABLE user_view_preferences (user_id TEXT NOT NULL, view_key TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, view_key));
    INSERT INTO users VALUES ('alice', 'Alice'), ('bob', 'Bob');
    INSERT INTO organizations VALUES ('org'), ('other');
    ${migrations.join("\n")}
  `)
  return current
}

const view = (id: string, name: string, ownerUserId = "alice", visibility: "personal" | "shared" = "personal", organizationId = "org") => ({
  id, organizationId, ownerUserId, name, visibility, definition: `{"id":"${id}"}`, createdAt: "t0", updatedAt: "t0",
})
const reader = { organizationId: "org", userId: "bob" }

describe("listVisibleSavedViews", () => {
  it("shows the reader's views and shared views in their organization, by name, with owner names", async () => {
    const { db } = open()
    await insertProjectSavedView(db, view("p2", "Zeta", "alice", "shared"))
    await insertProjectSavedView(db, view("p1", "Alpha", "bob"))
    await insertProjectSavedView(db, view("p3", "Private", "alice"))
    await insertProjectSavedView(db, view("p4", "Elsewhere", "alice", "shared", "other"))
    await insertScheduleSavedView(db, view("s1", "Schedule", "bob"))
    const rows = await listVisibleSavedViews(db, { ...reader, scope: "projects" })
    expect(rows.map((row) => [row.id, row.ownerName])).toEqual([["p1", "Bob"], ["p2", "Alice"]])
  })

  it("keeps showing views the backfill has not copied yet", async () => {
    const { sqlite, db } = open()
    sqlite.exec(`INSERT INTO project_saved_views VALUES ('legacy', 'org', 'bob', 'Before', 'personal', '{}', 't0', 't0')`)
    await insertProjectSavedView(db, view("new", "After", "bob"))
    const before = await listVisibleSavedViews(db, { ...reader, scope: "projects" })
    expect(before.map((row) => row.id)).toEqual(["new", "legacy"])
    // The backfill copies the row; reads then come from saved_views.
    sqlite.exec(`INSERT INTO saved_views SELECT id, organization_id, owner_user_id, 'projects', name, visibility, definition, created_at, updated_at FROM project_saved_views WHERE id = 'legacy'`)
    sqlite.exec(`UPDATE saved_views SET name = 'From saved_views' WHERE id = 'legacy'`)
    const after = await listVisibleSavedViews(db, { ...reader, scope: "projects" })
    expect(after.map((row) => row.name)).toEqual(["After", "From saved_views"])
  })

  it("drops legacy schedule rows with an unknown visibility, as the schedule screen always did", async () => {
    const { sqlite, db } = open()
    sqlite.exec(`INSERT INTO schedule_saved_views VALUES ('odd', 'org', 'bob', 'Odd', 'team', '{}', 't0', 't0')`)
    await insertScheduleSavedView(db, view("s1", "Crew", "bob"))
    const rows = await listVisibleSavedViews(db, { ...reader, scope: "schedule" })
    expect(rows.map((row) => row.id)).toEqual(["s1"])
  })

  it("reads the legacy table when saved_views does not exist yet", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { sqlite, db } = open({ withSavedViews: false })
    sqlite.exec(`INSERT INTO schedule_saved_views VALUES ('s1', 'org', 'bob', 'Crew', 'personal', '{}', 't0', 't0')`)
    expect((await listVisibleSavedViews(db, { ...reader, scope: "schedule" })).map((row) => row.id)).toEqual(["s1"])
    expect(await findOwnScheduleSavedViewId(db, "bob", "Crew")).toBe("s1")
  })
})

describe("readSavedViewDefault", () => {
  const key = { userId: "bob", organizationId: "org", scope: "projects", legacyViewKey: "project-hub-default:org" } as const

  it("reads saved_view_defaults, falling back to the legacy preference", async () => {
    const { sqlite, db } = open()
    expect(await readSavedViewDefault(db, key)).toBeNull()
    sqlite.exec(`INSERT INTO user_view_preferences VALUES ('bob', 'project-hub-default:org', '{"legacy":true}', 't0')`)
    expect(await readSavedViewDefault(db, key)).toBe('{"legacy":true}')
    await saveSavedViewDefault(db, { ...key, inlineDefinition: '{"new":true}', updatedAt: "t1" })
    expect(await readSavedViewDefault(db, key)).toBe('{"new":true}')
    expect(await readSavedViewDefault(db, { ...key, organizationId: "other", legacyViewKey: "project-hub-default:other" })).toBeNull()
  })

  it("uses a named view's filters when the default points at one", async () => {
    const { sqlite, db } = open()
    await insertProjectSavedView(db, view("p1", "Named", "bob"))
    sqlite.exec(`INSERT INTO saved_view_defaults VALUES ('bob', 'org', 'projects', 'p1', NULL, 't1')`)
    expect(await readSavedViewDefault(db, key)).toBe('{"id":"p1"}')
  })
})
