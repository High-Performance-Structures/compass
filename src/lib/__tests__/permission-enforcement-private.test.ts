import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))

import type { AuthUser } from "@/lib/auth"
import { canFeature } from "@/lib/permission-enforcement"

const staff: AuthUser = {
  id: "staff-1",
  email: "staff@example.test",
  firstName: null,
  lastName: null,
  displayName: "Staff",
  avatarUrl: null,
  role: "office",
  googleEmail: null,
  isActive: true,
  lastLoginAt: null,
  organizationId: "org-1",
  organizationName: "Example",
  organizationType: "internal",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

describe("individual employee contact permission", () => {
  beforeEach(() => {
    mocks.getCloudflareContext.mockReset()
    mocks.getDb.mockReset()
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
  })

  it("fails closed without an individual grant", async () => {
    mocks.getDb.mockReturnValue({
      select: () => ({ from: () => ({ where: () => ({ get: async () => null }) }) }),
    })
    for (const featureId of [
      "employee-contact-private",
      "cherish-review",
      "greeting-card-approval",
      "project-archive-access",
    ]) {
      expect(await canFeature(staff, featureId, "read")).toBe(false)
      expect(await canFeature({ ...staff, email: "martine@hps-colorado.com" }, featureId, "approve")).toBe(false)
      expect(await canFeature({ ...staff, role: "admin" }, featureId, "read")).toBe(false)
    }
  })

  it("separates viewing from approving", async () => {
    mocks.getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({ get: async () => ({ accessLevel: "view" }) }),
        }),
      }),
    })
    for (const featureId of [
      "employee-contact-private", "cherish-review",
      "greeting-card-approval", "project-archive-access",
    ]) {
      expect(await canFeature(staff, featureId, "read")).toBe(true)
      expect(await canFeature(staff, featureId, "approve")).toBe(false)
    }
  })

  it("lets an individually approved staff member use elevated actions", async () => {
    mocks.getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({ get: async () => ({ accessLevel: "approve" }) }),
        }),
      }),
    })
    for (const featureId of [
      "employee-contact-private", "cherish-review",
      "greeting-card-approval", "project-archive-access",
    ]) {
      expect(await canFeature(staff, featureId, "read")).toBe(true)
      expect(await canFeature(staff, featureId, "approve")).toBe(true)
    }
  })

  it("does not let an external account use a stored staff grant", async () => {
    expect(await canFeature(
      { ...staff, role: "client" },
      "employee-contact-private",
      "read"
    )).toBe(false)
    expect(mocks.getDb).not.toHaveBeenCalled()
  })
})
