import { describe, expect, it } from "vitest"

import { deidentifiedUserValues, externalOrganizationRole, isPendingInvitationPlaceholder } from "../rules"

describe("externalOrganizationRole", () => {
  it("files an invited owner as a client and keeps every other role", () => {
    expect(externalOrganizationRole("owner")).toBe("client")
    expect(externalOrganizationRole("client")).toBe("client")
    expect(externalOrganizationRole("subcontractor")).toBe("subcontractor")
    expect(externalOrganizationRole("supplier")).toBe("supplier")
  })
})

describe("isPendingInvitationPlaceholder", () => {
  const placeholder = { id: "3f1c0e7a-uuid", isActive: false, lastLoginAt: null }

  it("matches an inactive, never-signed-in row with a Compass id", () => {
    expect(isPendingInvitationPlaceholder(placeholder)).toBe(true)
  })

  it("rejects active, signed-in, or WorkOS-keyed rows", () => {
    expect(isPendingInvitationPlaceholder({ ...placeholder, isActive: true })).toBe(false)
    expect(isPendingInvitationPlaceholder({ ...placeholder, lastLoginAt: "2026-10-01T00:00:00.000Z" })).toBe(false)
    expect(isPendingInvitationPlaceholder({ ...placeholder, id: "user_01ABC" })).toBe(false)
  })
})

describe("deidentifiedUserValues", () => {
  it("clears identifying fields and frees the email address", () => {
    expect(deidentifiedUserValues("u-1", "2026-10-31T00:00:00.000Z")).toEqual({
      email: "deleted+u-1@deleted.invalid",
      firstName: null,
      lastName: null,
      displayName: "Deleted user",
      phone: null,
      address: null,
      avatarUrl: null,
      dashboardDeskPhotoUrl: null,
      sidebarDeskPhotoUrl: null,
      googleEmail: null,
      isActive: false,
      updatedAt: "2026-10-31T00:00:00.000Z",
    })
  })
})
