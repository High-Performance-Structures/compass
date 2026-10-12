import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { getTableConfig } from "drizzle-orm/sqlite-core"
import type { SQLiteTable } from "drizzle-orm/sqlite-core"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { users } from "@/db/schema"
import {
  channelMembers,
  channelReadState,
  channels,
  messages,
} from "@/db/schema-conversations"

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  resolveAgentUser: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: {} } }) }))
vi.mock("@/lib/agent/api-auth", () => ({
  validateAgentAuth: async () => ({
    valid: true,
    userId: "staff",
    orgId: "org-1",
    role: "office",
    isDemoUser: false,
  }),
}))
vi.mock("@/lib/agent/agent-user", () => ({ resolveAgentUser: mocks.resolveAgentUser }))

import { POST } from "../route"

const at = "2026-10-01T00:00:00.000Z"
const staff = { id: "staff", role: "office", organizationId: "org-1" }
const guest = { id: "guest", role: "guest", organizationId: "org-1" }

function createTable(sqlite: InstanceType<typeof Database>, table: SQLiteTable): void {
  const config = getTableConfig(table)
  const columns = config.columns.map((column) => {
    const value = column.default
    const defaultSql =
      typeof value === "number"
        ? ` DEFAULT ${value}`
        : typeof value === "boolean"
          ? ` DEFAULT ${Number(value)}`
          : typeof value === "string"
            ? ` DEFAULT '${value.replaceAll("'", "''")}'`
            : ""
    return `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${column.notNull ? " NOT NULL" : ""}${defaultSql}`
  })
  sqlite.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`)
}

function channel(id: string, overrides: Partial<typeof channels.$inferInsert> = {}) {
  return {
    id,
    name: id,
    organizationId: "org-1",
    createdBy: "staff",
    createdAt: at,
    updatedAt: at,
    ...overrides,
  }
}

function message(id: string, channelId: string, content: string, createdAt = at) {
  return { id, channelId, userId: "staff", content, createdAt }
}

beforeEach(() => {
  vi.clearAllMocks()
  const sqlite = new Database(":memory:")
  for (const table of [users, channels, channelMembers, channelReadState, messages]) {
    createTable(sqlite, table)
  }
  const db = drizzle(sqlite)
  db.insert(users).values([
    { id: "staff", email: "staff@example.com", displayName: "Staff Person", createdAt: at, updatedAt: at },
    { id: "guest", email: "guest@example.com", displayName: "Guest Person", createdAt: at, updatedAt: at },
  ]).run()
  db.insert(channels).values([
    channel("general"),
    channel("leadership", { isPrivate: true }),
    channel("estimating", { isPrivate: true }),
    channel("old", { archivedAt: at }),
    channel("bt-message-archive-1"),
    channel("other-org", { organizationId: "org-2" }),
  ]).run()
  db.insert(channelMembers).values([
    { id: "m1", channelId: "estimating", userId: "staff", joinedAt: at },
    { id: "m2", channelId: "general", userId: "guest", joinedAt: at },
    { id: "m3", channelId: "bt-message-archive-1", userId: "guest", joinedAt: at },
  ]).run()
  db.insert(channelReadState).values([
    { id: "r1", userId: "staff", channelId: "general", lastReadAt: at, unreadCount: 3 },
  ]).run()
  db.insert(messages).values([
    message("g1", "general", "Framing inspection passed", "2026-10-02T00:00:00.000Z"),
    message("g2", "general", "Roof is 50% done", "2026-10-03T00:00:00.000Z"),
    message("g3", "general", "Roof is 500 squares", "2026-10-04T00:00:00.000Z"),
    { ...message("g4", "general", "Deleted roof note"), deletedAt: at },
    message("l1", "leadership", "Roof budget concern"),
    message("e1", "estimating", "Roof bid sent"),
    message("o1", "old", "Roof archived chatter"),
    message("x1", "other-org", "Roof in another org"),
  ]).run()
  mocks.getDb.mockReturnValue(db)
})

async function call(body: unknown, viewer: unknown): Promise<{ status: number; json: unknown }> {
  mocks.resolveAgentUser.mockResolvedValue(viewer)
  const response = await POST(
    new Request("https://compass.internal/api/compass/messages", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify(body),
    }),
  )
  return { status: response.status, json: await response.json() }
}

function ids(json: unknown): string[] {
  if (typeof json !== "object" || json === null || !("data" in json) || !Array.isArray(json.data)) {
    return []
  }
  return json.data.map((row: unknown) =>
    typeof row === "object" && row !== null && "id" in row ? String(row.id) : "",
  )
}

describe("agent messages route", () => {
  it("shows staff public channels and their private memberships, with unread counts", async () => {
    const { status, json } = await call({ action: "channels" }, staff)

    expect(status).toBe(200)
    expect(ids(json).sort()).toEqual(["bt-message-archive-1", "estimating", "general"])
    expect(json).toMatchObject({ totalUnread: 3 })
    const unread = await call({ action: "channels", unreadOnly: true }, staff)
    expect(ids(unread.json)).toEqual(["general"])
  })

  it("shows outside users only their memberships and never the message archive", async () => {
    const { json } = await call({ action: "channels" }, guest)

    expect(ids(json)).toEqual(["general"])
  })

  it("searches only visible, undeleted messages, newest first", async () => {
    const { json } = await call({ action: "search", search: "roof" }, staff)

    expect(ids(json)).toEqual(["g3", "g2", "e1"])
  })

  it("treats % in a search as literal text", async () => {
    const { json } = await call({ action: "search", search: "50%" }, staff)

    expect(ids(json)).toEqual(["g2"])
  })

  it("refuses a conversation the user cannot see", async () => {
    const { status } = await call({ action: "search", channelId: "leadership" }, staff)

    expect(status).toBe(404)
  })

  it("rejects a token whose user is no longer active", async () => {
    const { status } = await call({ action: "channels" }, null)

    expect(status).toBe(401)
  })
})
