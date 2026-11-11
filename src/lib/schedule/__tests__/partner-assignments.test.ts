import { describe, expect, it } from "vitest"
import { partnerAssignedTaskIds } from "@/lib/schedule/partner-assignments"

const assignees = [
  // An imported job assigns the company's project contact, not the person.
  { scheduleTaskId: "slab", participantId: "p-groninger", assignedUserId: null, projectContactId: "c-groninger-company" },
  { scheduleTaskId: "gas", participantId: "p-plumber", assignedUserId: null, projectContactId: "c-plumber" },
  { scheduleTaskId: "walk", participantId: "p-doug", assignedUserId: "doug", projectContactId: null },
]

describe("partnerAssignedTaskIds", () => {
  it("finds items assigned to the person, their contact, or their company", () => {
    const ids = partnerAssignedTaskIds({ viewerId: "doug", contactIds: new Set(["c-doug", "c-groninger-company"]), assignees, publishedTasks: null })
    expect([...ids].sort()).toEqual(["slab", "walk"])
  })

  it("uses the published assignment, so an unpublished reassignment doesn't show", () => {
    const ids = partnerAssignedTaskIds({
      viewerId: "doug",
      contactIds: new Set(["c-groninger-company"]),
      assignees,
      publishedTasks: [
        { id: "slab", assignedUserId: null, assigneeParticipantIds: ["p-plumber"] },
        { id: "gas", assignedUserId: null, assigneeParticipantIds: ["p-groninger"] },
        { id: "walk", assignedUserId: "doug", assigneeParticipantIds: [] },
      ],
    })
    expect([...ids].sort()).toEqual(["gas", "walk"])
  })

  it("matches nothing for staff previewing with no person picked", () => {
    expect(partnerAssignedTaskIds({ viewerId: "", contactIds: new Set(), assignees, publishedTasks: null }).size).toBe(0)
  })
})
