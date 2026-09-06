import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AuthUser } from "@/lib/auth"
import { getEffectiveHelpGuideAccess } from "@/lib/help/server-access"

const canFeatureMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/permission-enforcement", () => ({
  canFeature: canFeatureMock,
}))

function user(role: string): AuthUser {
  return {
    id: `user-${role}`,
    email: `${role}@example.com`,
    firstName: null,
    lastName: null,
    displayName: role,
    avatarUrl: null,
    role,
    googleEmail: null,
    isActive: true,
    lastLoginAt: null,
    organizationId: "org-1",
    organizationName: "Example",
    organizationType: "external",
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
  }
}

describe("effective Help guide server access", () => {
  beforeEach(() => {
    canFeatureMock.mockReset()
    canFeatureMock.mockResolvedValue(true)
  })

  it.each([
    ["client", ["audience.owner", "support"]],
    ["subcontractor", ["support", "audience.trade"]],
    ["supplier", ["support", "audience.trade"]],
  ])("returns only audience-safe guides for %s", async (role, expected) => {
    const access = await getEffectiveHelpGuideAccess(user(role))

    expect(access.canViewHelp).toBe(true)
    expect(access.allowedGuideIds).toEqual(expected)
  })

  it("fails closed when broad Help access is denied", async () => {
    canFeatureMock.mockResolvedValue(false)

    await expect(getEffectiveHelpGuideAccess(user("client"))).resolves.toEqual({
      canViewHelp: false,
      allowedGuideIds: [],
    })
  })

  it("does not show an empty Help entry for an unknown role", async () => {
    const access = await getEffectiveHelpGuideAccess(user("unknown"))

    expect(access).toEqual({ canViewHelp: false, allowedGuideIds: [] })
  })
})
