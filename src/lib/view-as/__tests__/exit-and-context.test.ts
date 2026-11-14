import { beforeEach, describe, expect, it, vi } from "vitest"

import { VIEW_AS_COOKIE } from "@/lib/view-as/constants"

/*
 * Exit keeps every exited session revoked: the end entry is written before
 * the cookie goes, with one retry. And mutation contexts refuse during View
 * as, as a second layer behind the database guard.
 */

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  deleted: [] as string[],
  recordEnd: vi.fn(async () => undefined),
  viewing: false,
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.cookies.has(name) ? { value: state.cookies.get(name) } : undefined),
    delete: (name: string) => {
      state.deleted.push(name)
      state.cookies.delete(name)
    },
  }),
  headers: async () => ({ has: () => false }),
}))
vi.mock("@/lib/auth", () => ({
  getSignedInUser: vi.fn(async () => ({ id: "admin-1" })),
  getCurrentUser: vi.fn(async () => ({ id: "admin-1", role: "admin", isActive: true, organizationId: "org-1" })),
}))
vi.mock("@/lib/view-as/service", () => ({
  beginViewAs: vi.fn(),
  recordViewAsEnd: state.recordEnd,
  searchPeopleToViewAs: vi.fn(),
}))
vi.mock("@/lib/view-as/request", () => ({ isViewAsRequest: async () => state.viewing }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: {} } }) }))
vi.mock("@/db", () => ({ getDb: () => ({}) }))

const { exitViewAs } = await import("@/app/actions/view-as")
const { orgContext } = await import("@/lib/server/action-context")

describe("exitViewAs", () => {
  beforeEach(() => {
    state.cookies = new Map([[VIEW_AS_COOKIE, "token"]])
    state.deleted = []
    state.recordEnd.mockReset()
  })

  it("records the end, then clears the cookie", async () => {
    state.recordEnd.mockResolvedValue(undefined)
    expect(await exitViewAs()).toEqual({ success: true })
    expect(state.recordEnd).toHaveBeenCalledTimes(1)
    expect(state.deleted).toEqual([VIEW_AS_COOKIE])
  })

  it("retries once when the end entry fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    state.recordEnd.mockRejectedValueOnce(new Error("D1 busy")).mockResolvedValueOnce(undefined)
    expect(await exitViewAs()).toEqual({ success: true })
    expect(state.recordEnd).toHaveBeenCalledTimes(2)
    expect(state.deleted).toEqual([VIEW_AS_COOKIE])
  })

  it("keeps the session and says Exit didn't complete when it cannot be recorded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    state.recordEnd.mockRejectedValue(new Error("D1 down"))
    const result = await exitViewAs()
    expect(result.success).toBe(false)
    expect(result.success ? "" : result.error).toMatch(/didn't complete/)
    expect(state.deleted).toEqual([])
  })
})

describe("mutation contexts during View as", () => {
  it("refuse writes while viewing and allow them otherwise", async () => {
    state.viewing = true
    expect(await orgContext({ mutation: true })).toMatchObject({ success: false, error: expect.stringMatching(/read only/) })
    expect((await orgContext()).success).toBe(true)
    state.viewing = false
    expect((await orgContext({ mutation: true })).success).toBe(true)
  })
})
