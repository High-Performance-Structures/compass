import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const canFeatureMock = vi.fn()

vi.mock("server-only", () => ({}))
vi.mock("@/lib/permission-enforcement", () => ({
  canFeature: canFeatureMock,
}))

import type { AuthUser } from "@/lib/auth"
import type { JarvisReadCapability } from "@/lib/jarvis/read-capabilities"

let jarvisReadCapabilitiesForUser: (
  user: AuthUser,
) => Promise<readonly JarvisReadCapability[]>
let parseJarvisReadCapabilities: (
  value: unknown,
) => ReadonlySet<JarvisReadCapability>

function user(role: string, isActive = true): AuthUser {
  return {
    id: "user-1",
    email: "staff@example.com",
    firstName: "Staff",
    lastName: "Member",
    displayName: "Staff Member",
    avatarUrl: null,
    role,
    googleEmail: null,
    isActive,
    lastLoginAt: null,
    organizationId: "org-1",
    organizationName: "Example",
    organizationType: "internal",
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
  }
}

describe("Jarvis read capabilities", () => {
  beforeAll(async () => {
    const capabilitiesModule = await import("@/lib/jarvis/read-capabilities")
    jarvisReadCapabilitiesForUser =
      capabilitiesModule.jarvisReadCapabilitiesForUser
    parseJarvisReadCapabilities =
      capabilitiesModule.parseJarvisReadCapabilities
  })

  beforeEach(() => {
    canFeatureMock.mockReset()
  })

  it("uses effective feature permissions, including overrides", async () => {
    canFeatureMock.mockImplementation(
      async (_user: AuthUser, featureId: string) => featureId !== "budget",
    )

    await expect(
      jarvisReadCapabilitiesForUser(user("project_manager")),
    ).resolves.toEqual([
      "project-hub",
      "daily-logs",
      "rfis",
      "owner-updates",
      "work-calendar",
    ])
    expect(canFeatureMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1" }),
      "budget",
      "read",
    )
  })

  it("rejects unknown or malformed capabilities from stored events", () => {
    expect(
      [
        ...parseJarvisReadCapabilities([
          "project-hub",
          "work-calendar",
          "root",
          42,
        ]),
      ],
    ).toEqual(["project-hub", "work-calendar"])
    expect([...parseJarvisReadCapabilities("project-hub")]).toEqual([])
  })
})
