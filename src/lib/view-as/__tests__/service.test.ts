import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AuthUser } from "@/lib/auth"
import type { ViewAsSettings } from "@/lib/feature-settings/view-as-settings"
import type { OrgContext } from "@/lib/server/action-context"

const mocks = vi.hoisted(() => ({
  settings: { enabled: true, extraStaffUserIds: [] } as ViewAsSettings,
  recordRequiredActivityEvent: vi.fn(async () => undefined),
  viewAsTargetUser: vi.fn(),
}))

vi.mock("@/lib/feature-settings/server", () => ({
  readFeatureSettings: vi.fn(async () => mocks.settings),
}))
vi.mock("@/lib/activity-log", () => ({
  recordRequiredActivityEvent: mocks.recordRequiredActivityEvent,
}))
vi.mock("@/lib/view-as/session", () => ({
  viewAsSecret: () => "a-test-secret-that-is-long-enough",
  viewAsTargetUser: mocks.viewAsTargetUser,
}))
vi.mock("@/lib/db", () => ({
  getUnguardedCloudflareContext: async () => ({ env: { DB: {} } }),
}))
vi.mock("@/db", () => ({ getDb: () => ({}) }))
vi.mock("@/lib/domain/identity/view-as-people", () => ({
  searchViewAsPeople: vi.fn(async () => []),
  viewAsDisplayNames: vi.fn(async () => new Map([["owner-1", "Olive Owner"]])),
}))

const { beginViewAs, recordViewAsEnd } = await import("@/lib/view-as/service")
const { verifyViewAsToken } = await import("@/lib/view-as/token")

function user(overrides: Partial<AuthUser>): AuthUser {
  return {
    id: "admin-1",
    email: "admin@example.com",
    firstName: "Ada",
    lastName: "Admin",
    displayName: "Ada Admin",
    avatarUrl: null,
    role: "admin",
    googleEmail: null,
    isActive: true,
    lastLoginAt: null,
    organizationId: "org-1",
    organizationName: "Builder",
    organizationType: "internal",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function context(actor: AuthUser): OrgContext {
  return { user: actor, organizationId: "org-1", db: {} as OrgContext["db"], env: {} as CloudflareEnv }
}

const owner = user({ id: "owner-1", displayName: "Olive Owner", role: "owner", email: "olive@example.com" })

describe("beginViewAs", () => {
  beforeEach(() => {
    mocks.settings = { enabled: true, extraStaffUserIds: [] }
    mocks.recordRequiredActivityEvent.mockReset()
    mocks.recordRequiredActivityEvent.mockResolvedValue(undefined)
    mocks.viewAsTargetUser.mockReset()
    mocks.viewAsTargetUser.mockResolvedValue({ ok: true, user: owner })
  })

  it("records the start in Activity and returns a signed session for this admin and person", async () => {
    const now = new Date("2026-11-13T15:00:00.000Z")
    const result = await beginViewAs(context(user({})), true, "owner-1", now)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const payload = await verifyViewAsToken(result.value, "a-test-secret-that-is-long-enough", Math.floor(now.getTime() / 1000) + 1)
    expect(payload).toMatchObject({ adminId: "admin-1", targetId: "owner-1", orgId: "org-1" })
    expect(mocks.recordRequiredActivityEvent).toHaveBeenCalledTimes(1)
    expect(mocks.recordRequiredActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        category: "access",
        action: "view_as.started",
        entityType: "user",
        entityId: "owner-1",
        actor: expect.objectContaining({ id: "admin-1" }),
        summary: "Started viewing Compass as Olive Owner (read only).",
        metadata: expect.objectContaining({ viewAsSessionId: payload?.sid, viewedUserId: "owner-1" }),
        createdAt: now.toISOString(),
      }),
    )
  })

  it("refuses non-admins, a disabled setting and developer mode off, without recording anything", async () => {
    expect(await beginViewAs(context(user({ role: "project_manager" })), true, "owner-1")).toEqual({ ok: false, error: "View as is for admins." })
    expect(await beginViewAs(context(user({ role: "owner" })), true, "owner-1")).toMatchObject({ ok: false })
    expect(await beginViewAs(context(user({})), false, "owner-1")).toEqual({ ok: false, error: "Turn on developer mode to use View as." })
    mocks.settings = { enabled: false, extraStaffUserIds: [] }
    expect(await beginViewAs(context(user({})), true, "owner-1")).toEqual({ ok: false, error: "View as is turned off for this company." })
    expect(mocks.recordRequiredActivityEvent).not.toHaveBeenCalled()
    expect(mocks.viewAsTargetUser).not.toHaveBeenCalled()
  })

  it("refuses people outside the company and yourself", async () => {
    mocks.viewAsTargetUser.mockResolvedValue({ ok: false, reason: "That person is not part of this company." })
    expect(await beginViewAs(context(user({})), true, "stranger")).toEqual({ ok: false, error: "That person is not part of this company." })
    expect(await beginViewAs(context(user({})), true, "admin-1")).toMatchObject({ ok: false })
    expect(mocks.recordRequiredActivityEvent).not.toHaveBeenCalled()
  })

  it("does not start when the Activity entry cannot be written", async () => {
    mocks.recordRequiredActivityEvent.mockRejectedValue(new Error("D1 down"))
    await expect(beginViewAs(context(user({})), true, "owner-1")).rejects.toThrow("D1 down")
  })
})

describe("recordViewAsEnd", () => {
  beforeEach(() => {
    mocks.recordRequiredActivityEvent.mockReset()
    mocks.recordRequiredActivityEvent.mockResolvedValue(undefined)
    mocks.viewAsTargetUser.mockResolvedValue({ ok: true, user: owner })
  })

  it("records the end for the admin who started it, linked to the same session", async () => {
    const start = await beginViewAs(context(user({})), true, "owner-1")
    if (!start.ok) throw new Error(start.error)
    mocks.recordRequiredActivityEvent.mockClear()
    await recordViewAsEnd(start.value, user({}))
    expect(mocks.recordRequiredActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "view_as.ended", entityId: "owner-1", summary: "Stopped viewing Compass as Olive Owner (read only)." }),
    )
  })

  it("records why a session the middleware found over ended", async () => {
    const start = await beginViewAs(context(user({})), true, "owner-1")
    if (!start.ok) throw new Error(start.error)
    mocks.recordRequiredActivityEvent.mockClear()
    await recordViewAsEnd(start.value, user({}), "developer_mode_off")
    expect(mocks.recordRequiredActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "view_as.ended", metadata: expect.objectContaining({ endedBy: "developer_mode_off" }) }),
    )
  })

  it("records nothing for another admin's or a forged session", async () => {
    const start = await beginViewAs(context(user({})), true, "owner-1")
    if (!start.ok) throw new Error(start.error)
    mocks.recordRequiredActivityEvent.mockClear()
    await recordViewAsEnd(start.value, user({ id: "admin-2" }))
    await recordViewAsEnd("forged.token", user({}))
    expect(mocks.recordRequiredActivityEvent).not.toHaveBeenCalled()
  })
})
