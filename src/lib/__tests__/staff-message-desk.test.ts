import { describe, expect, it } from "vitest"

import {
  buildGotoStaffMessageDraft,
  buildStaffMessageAssignmentNotification,
  isEligibleStaffMessageAssignee,
  isStaffMessageDeskUser,
  parseStaffMessageStatus,
  staffMessageStatusLabel,
  type StaffMessageDeskUser,
} from "@/lib/staff-message-desk"

const internalStaff: StaffMessageDeskUser = {
  id: "staff-1",
  isActive: true,
  organizationId: "org-internal",
  organizationType: "internal",
  role: "office",
}

describe("Staff Message Desk authorization", () => {
  it("allows only active internal staff in an active organization", () => {
    expect(isStaffMessageDeskUser(internalStaff)).toBe(true)
    expect(isStaffMessageDeskUser({ ...internalStaff, isActive: false })).toBe(false)
    expect(isStaffMessageDeskUser({ ...internalStaff, organizationType: "client" })).toBe(false)
    expect(isStaffMessageDeskUser({ ...internalStaff, role: "developer" })).toBe(false)
    expect(isStaffMessageDeskUser({ ...internalStaff, organizationId: null })).toBe(false)
  })

  it("allows any active internal staff member in the current organization, including the current user", () => {
    expect(isEligibleStaffMessageAssignee(internalStaff, "org-internal")).toBe(true)
    expect(isEligibleStaffMessageAssignee(internalStaff, "org-other")).toBe(false)
    expect(
      isEligibleStaffMessageAssignee(
        { ...internalStaff, role: "client" },
        "org-internal"
      )
    ).toBe(false)
  })
})

describe("Staff Message Desk routing contracts", () => {
  it("targets exactly the selected recipient for the in-app assignment notification", () => {
    expect(
      buildStaffMessageAssignmentNotification({
        organizationId: "org-internal",
        recordId: "record-1",
        subject: "Call from supplier",
        assigneeUserId: "staff-2",
      })
    ).toEqual({
      organizationId: "org-internal",
      recordId: "record-1",
      recipientUserId: "staff-2",
      title: "Staff message assigned: Call from supplier",
      href: "/dashboard/office-maintenance/message-desk#message-record-1",
    })
  })

  it("builds a prefilled manual GoTo draft without claiming the source event", () => {
    expect(
      buildGotoStaffMessageDraft({
        eventId: "goto-1",
        senderPhone: "+1 (303) 555-0100",
        messageBody: "Please call me back\nabout the estimate.",
        assigneeUserId: "staff-2",
      })
    ).toEqual({
      sourceType: "message",
      gotoInboundEventId: "goto-1",
      callerName: "Inbound text caller",
      callerPhone: "+1 (303) 555-0100",
      subject: "Please call me back",
      body: "Please call me back\nabout the estimate.",
      assigneeUserId: "staff-2",
      sourceEventMutation: null,
    })
  })

})

describe("Staff Message Desk statuses", () => {
  it("accepts the supported workflow values and rejects arbitrary input", () => {
    expect(parseStaffMessageStatus("new")).toBe("new")
    expect(parseStaffMessageStatus("follow_up_needed")).toBe("follow_up_needed")
    expect(parseStaffMessageStatus("not-a-status")).toBeNull()
  })

  it("provides staff-facing labels", () => {
    expect(staffMessageStatusLabel("waiting_on_contact")).toBe("Waiting on Caller")
    expect(staffMessageStatusLabel("closed")).toBe("Closed")
  })
})
