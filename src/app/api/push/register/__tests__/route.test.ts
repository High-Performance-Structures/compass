import { beforeEach, describe, expect, it, vi } from "vitest"
import { SQL } from "drizzle-orm"
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core"

const mocks = vi.hoisted(() => ({ user: vi.fn(), where: vi.fn(), values: vi.fn() }))
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: {} } }) }))
vi.mock("@/db", () => ({ getDb: () => ({ delete: () => ({ where: mocks.where }), insert: () => ({ values: mocks.values }) }) }))
import { POST } from "../route"

describe("push registration after switching accounts", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "new-user" }) })
  it("reassigns this device token from its previous owner without clearing other devices", async () => {
    const token = "this-device-token-123456789"
    const response = await POST(new Request("https://compass.example/api/push/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, platform: "ios" }) }))
    expect(response.status).toBe(200)
    const predicate: unknown = mocks.where.mock.calls[0]?.[0]
    expect(predicate).toBeInstanceOf(SQL)
    if (!(predicate instanceof SQL)) throw new Error("Expected a SQL predicate")
    const query = new SQLiteSyncDialect().sqlToQuery(predicate)
    expect(query.sql).toMatch(/"token" = \? or \("push_tokens"\."user_id" = \? and "push_tokens"\."platform" = \?\)/)
    expect(query.params).toEqual([token, "new-user", "ios"])
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ userId: "new-user", token, platform: "ios" }))
  })
  it("does not allow signed-out clients to reassign a token", async () => {
    mocks.user.mockResolvedValue(null)
    const response = await POST(new Request("https://compass.example/api/push/register", { method: "POST", body: "{}" }))
    expect(response.status).toBe(401)
    expect(mocks.where).not.toHaveBeenCalled()
  })
})
