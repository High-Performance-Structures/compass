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

type OverrideRow = { readonly featureId: string; readonly accessLevel: string }

// Overrides are read in one batch: role rows, team rows, then this
// person's own rows. The query builders only need to chain.
function mockOverrides(rows: {
  readonly role?: readonly OverrideRow[]
  readonly team?: readonly OverrideRow[]
  readonly user?: readonly OverrideRow[]
}): void {
  const query = {
    from: () => query,
    innerJoin: () => query,
    where: () => query,
  }
  mocks.getDb.mockReturnValue({
    select: () => query,
    batch: async () => [rows.role ?? [], rows.team ?? [], rows.user ?? []],
  })
}

const INDIVIDUAL_FEATURES = [
  "employee-contact-private",
  "sage-contact-review",
  "cherish-review",
  "greeting-card-approval",
  "project-archive-access",
]

function individualGrants(accessLevel: string): readonly OverrideRow[] {
  return INDIVIDUAL_FEATURES.map((featureId) => ({ featureId, accessLevel }))
}

describe("individual employee contact permission", () => {
  beforeEach(() => {
    mocks.getCloudflareContext.mockReset()
    mocks.getDb.mockReset()
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
  })

  it("fails closed without an individual grant", async () => {
    mockOverrides({})
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
    mockOverrides({ user: individualGrants("view") })
    for (const featureId of [
      "employee-contact-private", "sage-contact-review", "cherish-review",
      "greeting-card-approval", "project-archive-access",
    ]) {
      expect(await canFeature(staff, featureId, "read")).toBe(true)
      expect(await canFeature(staff, featureId, "approve")).toBe(false)
    }
  })

  it("lets an individually approved staff member use elevated actions", async () => {
    mockOverrides({ user: individualGrants("approve") })
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

  function mockUserOverride(featureId: string, accessLevel: string | null): void {
    mockOverrides({ user: accessLevel ? [{ featureId, accessLevel }] : [] })
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
    mockUserOverride("customers", "none")
    expect(await canFeature(staff, "customers", "update")).toBe(false)
    mockUserOverride("vendors", null)
    expect(await canFeature(staff, "vendors", "update")).toBe(true)
  })

  it("applies role, team, and personal overrides for the feature being checked", async () => {
    mockOverrides({
      role: [{ featureId: "vendors", accessLevel: "view" }],
      team: [
        { featureId: "vendors", accessLevel: "edit" },
        { featureId: "customers", accessLevel: "none" },
      ],
      user: [{ featureId: "internal-directory", accessLevel: "none" }],
    })
    // Team grants can only raise a role level.
    expect(await canFeature(staff, "vendors", "update")).toBe(true)
    expect(await canFeature(staff, "customers", "read")).toBe(true)
    // A personal staff choice may still deny.
    expect(await canFeature(staff, "internal-directory", "read")).toBe(false)
  })

  it("allows internal contacts to have a different staff edit grant", async () => {
    mockUserOverride("internal-directory", "edit")
    expect(await canFeature(staff, "internal-directory", "update")).toBe(true)
  })

  it("does not carry a stored staff edit grant into an external role", async () => {
    mockUserOverride("internal-directory", "edit")
    expect(await canFeature({ ...staff, role: "client" }, "internal-directory", "update")).toBe(false)
  })
})
