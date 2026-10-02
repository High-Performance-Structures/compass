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
      "sage-contact-review",
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
      "employee-contact-private", "sage-contact-review", "cherish-review",
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
      "employee-contact-private", "sage-contact-review", "cherish-review",
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

describe("staff directory permissions", () => {
  beforeEach(() => {
    mocks.getCloudflareContext.mockReset()
    mocks.getDb.mockReset()
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
  })

  function mockUserOverride(accessLevel: string | null): void {
    let selection = 0
    mocks.getDb.mockReturnValue({
      select: () => {
        selection += 1
        const current = selection
        return {
          from: () => ({
            where: () => ({ get: async () => current === 3 && accessLevel ? { accessLevel } : null }),
            innerJoin: () => ({ where: async () => [] }),
          }),
        }
      },
    })
  }

  it("does not expose shared client, vendor, or internal lists to external accounts", async () => {
    for (const role of ["client", "subcontractor", "supplier", "guest"]) {
      for (const featureId of ["customers", "vendors", "internal-directory"]) {
        expect(await canFeature({ ...staff, role }, featureId, "read")).toBe(false)
      }
    }
    expect(mocks.getDb).not.toHaveBeenCalled()
  })

  it("fails closed for shared directories when grant storage is unavailable", async () => {
    mocks.getCloudflareContext.mockRejectedValue(new Error("D1 unavailable"))
    for (const featureId of ["customers", "vendors", "internal-directory"]) {
      expect(await canFeature(staff, featureId, "read")).toBe(false)
    }
  })

  it("allows an individual staff denial of customer edits without affecting vendors", async () => {
    mockUserOverride("none")
    expect(await canFeature(staff, "customers", "update")).toBe(false)
    mockUserOverride(null)
    expect(await canFeature(staff, "vendors", "update")).toBe(true)
  })

  it("allows internal contacts to have a different staff edit grant", async () => {
    mockUserOverride("edit")
    expect(await canFeature(staff, "internal-directory", "update")).toBe(true)
  })

  it("does not carry a stored staff edit grant into an external role", async () => {
    mockUserOverride("edit")
    expect(await canFeature({ ...staff, role: "client" }, "internal-directory", "update")).toBe(false)
  })
})
