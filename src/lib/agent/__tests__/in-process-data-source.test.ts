import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  queryPOST: vi.fn<(request: Request) => Promise<Response>>(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/app/api/compass/query/route", () => ({ POST: mocks.queryPOST }))
vi.mock("@/app/api/compass/dashboards/route", () => ({ POST: vi.fn() }))
vi.mock("@/app/api/compass/github/route", () => ({ POST: vi.fn() }))
vi.mock("@/app/api/compass/memory/route", () => ({ POST: vi.fn() }))
vi.mock("@/app/api/compass/messages/route", () => ({ POST: vi.fn() }))
vi.mock("@/app/api/compass/schedule/route", () => ({ POST: vi.fn() }))
vi.mock("@/app/api/compass/skills/route", () => ({ POST: vi.fn() }))
vi.mock("@/app/api/compass/themes/route", () => ({ POST: vi.fn() }))

import { createInProcessDataSource } from "@/lib/agent/in-process-data-source"

describe("createInProcessDataSource", () => {
  it("calls the route handler directly with the agent token and body", async () => {
    mocks.queryPOST.mockResolvedValueOnce(Response.json({ data: [], count: 0 }))

    const result = await createInProcessDataSource("agent-token").fetch(
      "/api/compass/query",
      { queryType: "daily_logs" },
    )

    expect(result).toEqual({ data: [], count: 0 })
    const request = mocks.queryPOST.mock.calls.at(0)?.[0]
    expect(request?.method).toBe("POST")
    expect(request?.headers.get("authorization")).toBe("Bearer agent-token")
    expect(await request?.json()).toEqual({ queryType: "daily_logs" })
  })

  it("turns an error response into the route's error message", async () => {
    mocks.queryPOST.mockResolvedValueOnce(
      Response.json({ error: "Compass search is unavailable for this account" }, { status: 403 }),
    )

    await expect(
      createInProcessDataSource("agent-token").fetch("/api/compass/query", {}),
    ).rejects.toThrow("Compass search is unavailable for this account")
  })

  it("rejects a path with no handler", async () => {
    await expect(
      createInProcessDataSource("agent-token").fetch("/api/compass/nope", {}),
    ).rejects.toThrow("No Compass API handler for /api/compass/nope")
  })
})
