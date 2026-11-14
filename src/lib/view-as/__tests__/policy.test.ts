import { describe, expect, it } from "vitest"

import type { AuthUser } from "@/lib/auth"
import { DEMO_ORG_ID } from "@/lib/demo"
import type { ViewAsSettings } from "@/lib/feature-settings/view-as-settings"
import { canUseDeveloperModeWith, canViewTargetRole, isViewAsEligible, viewAsPermission } from "@/lib/view-as/policy"

function person(overrides: Partial<AuthUser>): AuthUser {
  return {
    id: "user-1",
    email: "person@example.com",
    firstName: null,
    lastName: null,
    displayName: "Person",
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

const DEFAULTS: ViewAsSettings = { enabled: true, extraStaffUserIds: [] }

describe("View as permission", () => {
  it("allows an admin with developer mode on, by default", () => {
    expect(viewAsPermission({ user: person({ role: "admin" }), settings: DEFAULTS, developerModeEnabled: true })).toEqual({ allowed: true })
    expect(viewAsPermission({ user: person({ role: "secondary_admin" }), settings: DEFAULTS, developerModeEnabled: true }).allowed).toBe(true)
  })

  it("refuses non-admin staff, owners, vendors and nobody", () => {
    for (const role of ["project_manager", "office", "field_crew", "owner", "client", "subcontractor", "supplier", "guest"]) {
      expect(viewAsPermission({ user: person({ role }), settings: DEFAULTS, developerModeEnabled: true }).allowed).toBe(false)
    }
    expect(viewAsPermission({ user: null, settings: DEFAULTS, developerModeEnabled: true }).allowed).toBe(false)
  })

  it("refuses everyone when the company setting is off", () => {
    const off = { ...DEFAULTS, enabled: false }
    expect(viewAsPermission({ user: person({ role: "admin" }), settings: off, developerModeEnabled: true })).toMatchObject({
      allowed: false,
      reason: "View as is turned off for this company.",
    })
  })

  it("refuses when developer mode is off", () => {
    expect(viewAsPermission({ user: person({ role: "admin" }), settings: DEFAULTS, developerModeEnabled: false })).toMatchObject({
      allowed: false,
      reason: "Turn on developer mode to use View as.",
    })
  })

  it("refuses an inactive admin and the demo company", () => {
    expect(isViewAsEligible(person({ isActive: false }), DEFAULTS)).toBe(false)
    expect(isViewAsEligible(person({ organizationId: DEMO_ORG_ID }), DEFAULTS)).toBe(false)
  })

  it("lets a company add named staff, never owners or vendors", () => {
    const widened = { ...DEFAULTS, extraStaffUserIds: ["pm-1", "owner-1", "vendor-1"] }
    expect(isViewAsEligible(person({ id: "pm-1", role: "project_manager" }), widened)).toBe(true)
    expect(isViewAsEligible(person({ id: "pm-2", role: "project_manager" }), widened)).toBe(false)
    expect(isViewAsEligible(person({ id: "owner-1", role: "owner" }), widened)).toBe(false)
    expect(isViewAsEligible(person({ id: "vendor-1", role: "subcontractor" }), widened)).toBe(false)
    // Staff role but not in an internal company (for example a personal workspace).
    expect(isViewAsEligible(person({ id: "pm-1", role: "project_manager", organizationType: "personal" }), widened)).toBe(false)
    // Listed staff still need developer mode.
    expect(viewAsPermission({ user: person({ id: "pm-1", role: "project_manager" }), settings: widened, developerModeEnabled: false }).allowed).toBe(false)
  })

  it("gives listed staff the developer mode switch, and only them", () => {
    const widened = { ...DEFAULTS, extraStaffUserIds: ["pm-1"] }
    expect(canUseDeveloperModeWith(person({ id: "pm-1", role: "project_manager" }), widened)).toBe(true)
    expect(canUseDeveloperModeWith(person({ id: "pm-2", role: "project_manager" }), widened)).toBe(false)
    expect(canUseDeveloperModeWith(person({ role: "admin" }), { ...DEFAULTS, enabled: false })).toBe(true)
  })

  it("never reaches broader access than the viewer (privilege ceiling)", () => {
    const admin = person({ role: "admin" })
    const secondary = person({ id: "sa-1", role: "secondary_admin" })
    const listed = person({ id: "pm-1", role: "project_manager" })
    // Only the full admin may view an admin or secondary admin.
    expect(canViewTargetRole(admin, "admin")).toBe(true)
    expect(canViewTargetRole(admin, "secondary_admin")).toBe(true)
    expect(canViewTargetRole(secondary, "admin")).toBe(false)
    expect(canViewTargetRole(secondary, "secondary_admin")).toBe(false)
    expect(canViewTargetRole(listed, "admin")).toBe(false)
    expect(canViewTargetRole(listed, "secondary_admin")).toBe(false)
    // Non-admin staff, owners and vendors are fine for any allowed viewer.
    for (const role of ["project_manager", "executive", "owner", "subcontractor", "supplier"]) {
      expect(canViewTargetRole(secondary, role)).toBe(true)
      expect(canViewTargetRole(listed, role)).toBe(true)
    }
  })
})
