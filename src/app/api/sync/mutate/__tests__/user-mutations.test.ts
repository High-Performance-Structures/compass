import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getCloudflareContext: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))

import { POST } from "../route"
import {
  openCorrespondenceTestDatabase,
  type CorrespondenceTestDatabase,
} from "../../../../../../__tests__/helpers/correspondence-core"

let database: CorrespondenceTestDatabase | null = null

afterEach(() => {
  database?.close()
  database = null
  vi.clearAllMocks()
})

/** staff-a is an admin in org-a; owner-a is in org-a; staff-b/owner-b are in org-b. */
function open(): CorrespondenceTestDatabase {
  const opened = openCorrespondenceTestDatabase()
  const { sqlite } = opened
  for (const column of [
    "phone TEXT",
    "address TEXT",
    "avatar_url TEXT",
    "dashboard_desk_photo_url TEXT",
    "sidebar_desk_photo_url TEXT",
    "google_email TEXT",
    "last_login_at TEXT",
  ]) {
    sqlite.exec(`ALTER TABLE users ADD COLUMN ${column}`)
  }
  const migration = readFileSync(resolve(process.cwd(), "drizzle/0024_thankful_slayback.sql"), "utf8")
  sqlite.exec(migration.replaceAll("--> statement-breakpoint", ""))
  mocks.getCloudflareContext.mockResolvedValue({ env: { DB: opened.d1 } })
  mocks.getCurrentUser.mockResolvedValue({ id: "staff-a", role: "admin", organizationId: "org-a", isActive: true })
  return opened
}

async function mutate(body: Record<string, unknown>): Promise<{ readonly status: number; readonly json: unknown }> {
  const response = await POST(
    new NextRequest("http://localhost/api/sync/mutate", {
      method: "POST",
      body: JSON.stringify({ vectorClock: { client: 1 }, payload: null, ...body }),
    })
  )
  return { status: response.status, json: await response.json() }
}

function userRow(db: CorrespondenceTestDatabase, id: string): unknown {
  return db.sqlite.prepare("SELECT email, google_email, display_name, is_active FROM users WHERE id = ?").get(id)
}

describe("sync mutate: users", () => {
  it("can't modify a user in another organization", async () => {
    database = open()
    const result = await mutate({ operation: "update", table: "users", recordId: "owner-b", payload: { isActive: false } })
    expect(result.status).toBe(403)
    expect(userRow(database, "owner-b")).toMatchObject({ is_active: 1 })

    const deleted = await mutate({ operation: "delete", table: "users", recordId: "owner-b" })
    expect(deleted.status).toBe(403)
    expect(userRow(database, "owner-b")).toBeDefined()
  })

  it("can't set email or googleEmail, even for a user in the caller's organization", async () => {
    database = open()
    const email = await mutate({ operation: "update", table: "users", recordId: "owner-a", payload: { email: "ceo@example.test" } })
    expect(email.status).toBe(403)
    const google = await mutate({ operation: "update", table: "users", recordId: "owner-a", payload: { googleEmail: "ceo@example.test" } })
    expect(google.status).toBe(403)
    expect(userRow(database, "owner-a")).toMatchObject({ email: "owner-a@example.test", google_email: null })
  })

  it("can't create users", async () => {
    database = open()
    const result = await mutate({
      operation: "insert",
      table: "users",
      recordId: "new-user",
      payload: { email: "new@example.test", role: "admin" },
    })
    expect(result.status).toBe(403)
    expect(userRow(database, "new-user")).toBeUndefined()
  })

  it("refuses user writes when the caller has no active organization", async () => {
    database = open()
    mocks.getCurrentUser.mockResolvedValue({ id: "staff-a", role: "admin", organizationId: null, isActive: true })
    const result = await mutate({ operation: "update", table: "users", recordId: "owner-a", payload: { displayName: "Renamed" } })
    expect(result.status).toBe(403)
  })

  it("still updates other fields for a user in the caller's organization", async () => {
    database = open()
    const result = await mutate({ operation: "update", table: "users", recordId: "owner-a", payload: { displayName: "Renamed" } })
    expect(result).toEqual({ status: 200, json: { success: true } })
    expect(userRow(database, "owner-a")).toMatchObject({ display_name: "Renamed" })
  })
})
