import { describe, expect, it } from "vitest"

import {
  STAFF_MESSAGE_STATUSES,
  canTransitionStaffMessageStatus,
  isEligibleStaffMessageAssignee,
  isStaffMessageDeskUser,
  type StaffMessageDeskUser,
} from "@/lib/staff-message-desk"

const internalUser: StaffMessageDeskUser = {
  id: "user-1",
  isActive: true,
  organizationId: "org-internal",
  organizationType: "internal",
  role: "office",
}

describe("Staff Message Desk rules", () => {
  it("exposes only the governed statuses in workflow order", () => {
    expect(STAFF_MESSAGE_STATUSES).toEqual([
      "New",
      "Assigned",
      "In Progress",
      "Waiting",
      "Completed",
    ])
  })

  it("requires an active internal staff user in an active internal organization", () => {
    expect(isStaffMessageDeskUser(internalUser)).toBe(true)
    expect(
      isStaffMessageDeskUser({
        ...internalUser,
        isActive: false,
      })
    ).toBe(false)
    expect(
      isStaffMessageDeskUser({
        ...internalUser,
        organizationType: "client",
      })
    ).toBe(false)
    expect(
      isStaffMessageDeskUser({
        ...internalUser,
        role: "developer",
      })
    ).toBe(false)
    expect(
      isStaffMessageDeskUser({
        ...internalUser,
        organizationId: null,
      })
    ).toBe(false)
  })

  it("accepts only active internal staff assignees in the current organization", () => {
    expect(
      isEligibleStaffMessageAssignee(internalUser, "org-internal")
    ).toBe(true)
    expect(
      isEligibleStaffMessageAssignee(
        { ...internalUser, organizationId: "org-other" },
        "org-internal"
      )
    ).toBe(false)
    expect(
      isEligibleStaffMessageAssignee(
        { ...internalUser, role: "client" },
        "org-internal"
      )
    ).toBe(false)
    expect(
      isEligibleStaffMessageAssignee(
        { ...internalUser, isActive: false },
        "org-internal"
      )
    ).toBe(false)
  })

  it("allows only governed forward status transitions", () => {
    expect(canTransitionStaffMessageStatus("New", "Assigned")).toBe(true)
    expect(canTransitionStaffMessageStatus("Assigned", "In Progress")).toBe(true)
    expect(canTransitionStaffMessageStatus("In Progress", "Waiting")).toBe(true)
    expect(canTransitionStaffMessageStatus("Waiting", "Completed")).toBe(true)
    expect(canTransitionStaffMessageStatus("Completed", "In Progress")).toBe(false)
    expect(canTransitionStaffMessageStatus("New", "Completed")).toBe(false)
  })
})
