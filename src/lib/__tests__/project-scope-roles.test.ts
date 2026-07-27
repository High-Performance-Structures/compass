import { describe, expect, it } from "vitest"

import {
  canUseOrganizationProjectScopeRole,
  isExternalProjectRole,
} from "@/lib/user-roles"

describe("organization-wide project scope", () => {
  it.each([
    "admin",
    "secondary_admin",
    "project_manager",
    "office",
    "field_superintendent",
  ])("allows internal staff role %s", (role) => {
    expect(canUseOrganizationProjectScopeRole(role)).toBe(true)
  })

  it.each([
    "client",
    "owner",
    "subcontractor",
    "supplier",
    "guest",
    "developer",
    "unknown",
  ])("denies project-wide scope to %s", (role) => {
    expect(canUseOrganizationProjectScopeRole(role)).toBe(false)
  })
})

describe("external project roles", () => {
  it.each(["client", "owner", "subcontractor", "supplier", "guest"])(
    "recognizes %s as project-scoped",
    (role) => {
      expect(isExternalProjectRole(role)).toBe(true)
    }
  )

  it.each(["admin", "office", "developer", "unknown"])(
    "does not classify %s as external",
    (role) => {
      expect(isExternalProjectRole(role)).toBe(false)
    }
  )
})
