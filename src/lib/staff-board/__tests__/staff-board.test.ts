import { describe, expect, it } from "vitest"

import {
  canAccessStaffBoard,
  isActiveInternalStaffMembership,
  selectStaffBoardRecipients,
  validateStaffBoardPost,
} from "@/lib/staff-board"

describe("staff board access", () => {
  it("allows only an active internal staff member in the active internal organization", () => {
    expect(canAccessStaffBoard("office", true, "internal")).toBe(true)
    expect(
      isActiveInternalStaffMembership({
        userId: "staff-1",
        requestedUserId: "staff-1",
        memberOrganizationId: "org-1",
        requestedOrganizationId: "org-1",
        userIsActive: true,
        organizationIsActive: true,
        organizationType: "internal",
        memberRole: "office",
      })
    ).toBe(true)
  })

  it("rejects inactive, external, mismatched, and unbound memberships", () => {
    const base = {
      userId: "staff-1",
      requestedUserId: "staff-1",
      memberOrganizationId: "org-1",
      requestedOrganizationId: "org-1",
      userIsActive: true,
      organizationIsActive: true,
      organizationType: "internal",
      memberRole: "office",
    } as const

    expect(isActiveInternalStaffMembership({ ...base, userIsActive: false })).toBe(false)
    expect(isActiveInternalStaffMembership({ ...base, organizationIsActive: false })).toBe(false)
    expect(isActiveInternalStaffMembership({ ...base, organizationType: "client" })).toBe(false)
    expect(isActiveInternalStaffMembership({ ...base, memberRole: "client" })).toBe(false)
    expect(isActiveInternalStaffMembership({ ...base, memberOrganizationId: "org-2" })).toBe(false)
    expect(isActiveInternalStaffMembership({ ...base, requestedUserId: "other-user" })).toBe(false)
  })
})

describe("staff board recipients", () => {
  it("keeps only active internal members of the same organization and excludes the author", () => {
    expect(
      selectStaffBoardRecipients(
        [
          { userId: "author", email: "author@example.com", organizationId: "org-1", isActive: true, role: "office" },
          { userId: "staff", email: "staff@example.com", organizationId: "org-1", isActive: true, role: "field_crew" },
          { userId: "inactive", email: "inactive@example.com", organizationId: "org-1", isActive: false, role: "office" },
          { userId: "external", email: "external@example.com", organizationId: "org-1", isActive: true, role: "client" },
          { userId: "other-org", email: "other@example.com", organizationId: "org-2", isActive: true, role: "office" },
        ],
        "author",
        "org-1"
      )
    ).toEqual([{ userId: "staff", email: "staff@example.com" }])
  })
})

describe("staff board post validation", () => {
  it("trims valid titles and bodies", () => {
    expect(
      validateStaffBoardPost({
        title: "  Monday update  ",
        body: "  The office is closed Friday.  ",
      })
    ).toEqual({
      success: true,
      data: {
        title: "Monday update",
        body: "The office is closed Friday.",
      },
    })
  })

  it("rejects missing or oversized content", () => {
    expect(validateStaffBoardPost({ title: "", body: "A post" })).toEqual({
      success: false,
      error: "Add a title.",
    })
    expect(validateStaffBoardPost({ title: "Update", body: "" })).toEqual({
      success: false,
      error: "Add a message.",
    })
    expect(validateStaffBoardPost({ title: "x".repeat(121), body: "A post" })).toEqual({
      success: false,
      error: "Titles must be 120 characters or fewer.",
    })
    expect(validateStaffBoardPost({ title: "Update", body: "x".repeat(5001) })).toEqual({
      success: false,
      error: "Messages must be 5,000 characters or fewer.",
    })
  })
})
