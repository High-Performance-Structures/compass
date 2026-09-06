import { describe, expect, it } from "vitest"

import {
  isOwnerScheduleView,
  selectOwnScheduleCommitments,
  summarizeOwnerScheduleByPhase,
  type OwnerScheduleSourceItem,
} from "../owner-visibility"

const ITEMS: readonly OwnerScheduleSourceItem[] = [
  {
    id: "task-1",
    title: "Private foundation detail",
    startDate: "2026-07-01",
    endDate: "2026-07-05",
    status: "COMPLETE",
    phase: "foundation",
    assignedTo: "Vendor One",
    percentComplete: 100,
    isMilestone: false,
    workdays: 5,
    displayColor: null,
  },
  {
    id: "task-2",
    title: "Private foundation follow-up",
    startDate: "2026-07-06",
    endDate: "2026-07-15",
    status: "IN_PROGRESS",
    phase: "foundation",
    assignedTo: "Vendor Two",
    percentComplete: 50,
    isMilestone: false,
    workdays: 10,
    displayColor: null,
  },
  {
    id: "task-3",
    title: "Private framing detail",
    startDate: "2026-07-16",
    endDate: "2026-07-20",
    status: "PENDING",
    phase: "custom_phase",
    assignedTo: null,
    percentComplete: 0,
    isMilestone: false,
    workdays: 5,
    displayColor: null,
  },
]

describe("owner schedule visibility", () => {
  it("recognizes the supported persisted values", () => {
    expect(isOwnerScheduleView("items")).toBe(true)
    expect(isOwnerScheduleView("phases")).toBe(true)
    expect(isOwnerScheduleView("client")).toBe(false)
  })

  it("rolls item details into date-bounded phase summaries", () => {
    const summaries = summarizeOwnerScheduleByPhase(ITEMS)

    expect(summaries).toEqual([
      {
        id: "owner-phase-foundation",
        title: "Foundation",
        startDate: "2026-07-01",
        endDate: "2026-07-15",
        status: "IN_PROGRESS",
        phase: "foundation",
        assignedTo: null,
        percentComplete: 67,
        isMilestone: false,
        workdays: 15,
        displayColor: null,
      },
      {
        id: "owner-phase-custom-phase",
        title: "Custom Phase",
        startDate: "2026-07-16",
        endDate: "2026-07-20",
        status: "PENDING",
        phase: "custom_phase",
        assignedTo: null,
        percentComplete: 0,
        isMilestone: false,
        workdays: 5,
        displayColor: null,
      },
    ])
  })

  it("does not expose item titles or assignees in phase mode", () => {
    const serialized = JSON.stringify(summarizeOwnerScheduleByPhase(ITEMS))

    expect(serialized).not.toContain("Private")
    expect(serialized).not.toContain("Vendor")
  })
})


describe("personal commitments beside the owner phase overview", () => {
  it("retains legacy and individual assignments, including confirmed commitments", () => {
    const items = [
      { id: "legacy-owner", viewerCanConfirm: true, assignees: [] },
      { id: "owner-delivery", viewerCanConfirm: false, assignees: [{ viewerCanRespond: true, responseStatus: "confirmed" }] },
      { id: "other-party", viewerCanConfirm: false, assignees: [{ viewerCanRespond: false, responseStatus: "pending" }] },
      { id: "phase-summary", viewerCanConfirm: false, assignees: [] },
    ]
    expect(selectOwnScheduleCommitments(items).map((item) => item.id))
      .toEqual(["legacy-owner", "owner-delivery"])
  })
})
