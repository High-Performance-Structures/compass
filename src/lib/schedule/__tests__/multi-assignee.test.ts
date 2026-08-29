import { describe, expect, it } from "vitest"
import {
  isPublishedScheduleVisibleToAssignee,
  resolveImportedScheduleAssignees,
  sameScheduleAssigneeSet,
  scheduleAssigneeResponseState,
} from "@/lib/schedule/multi-assignee"

describe("multi-assignee schedule responses", () => {
  it("tracks a proposal for date and duration independently", () => {
    expect(
      scheduleAssigneeResponseState({
        response: "proposed",
        proposedStartDate: "2026-09-14",
        message: "Crew conflict",
      }),
    ).toEqual({
      responseStatus: "proposed",
      dateResponseStatus: "proposed",
      durationResponseStatus: "pending",
    })
  })

  it("requires a meaningful proposal and bounds duration", () => {
    expect(scheduleAssigneeResponseState({ response: "proposed" })).toEqual({
      error: "Provide a proposed start date or duration.",
    })
    expect(
      scheduleAssigneeResponseState({ response: "proposed", proposedWorkdays: 0 }),
    ).toEqual({ error: "Proposed workdays must be between 1 and 3650." })
    expect(
      scheduleAssigneeResponseState({
        response: "proposed",
        proposedStartDate: "2026-02-30",
      }),
    ).toEqual({ error: "Choose a valid proposed start date." })
  })

  it("resolves only exact source identities and retains unmatched names", () => {
    expect(
      resolveImportedScheduleAssignees({
        imported: [
          { sourceParticipantId: "bt-1", rawName: "Known Crew" },
          { sourceParticipantId: null, rawName: "Unknown Crew" },
          { sourceParticipantId: "bt-missing", rawName: "Renamed Crew" },
        ],
        canonical: [{ sourceParticipantId: "bt-1", participantId: "p-1" }],
      }),
    ).toEqual({
      matched: [{ sourceParticipantId: "bt-1", participantId: "p-1" }],
      unmatchedRawNames: ["Unknown Crew", "Renamed Crew"],
    })
  })

  it("fails closed when a published child-assignee set changes", () => {
    expect(sameScheduleAssigneeSet(["p-2", "p-1"], ["p-1", "p-2"])).toBe(true)
    expect(sameScheduleAssigneeSet(["p-1"], ["p-1", "p-2"])).toBe(false)
    expect(sameScheduleAssigneeSet(["p-1"], ["p-3"])).toBe(false)
  })

  it("enforces the published visibility for each assignee audience", () => {
    expect(
      isPublishedScheduleVisibleToAssignee({
        audience: "internal",
        ownerVisible: false,
        subVendorVisible: false,
        hasExplicitPartnerSelection: true,
      }),
    ).toBe(true)
    expect(
      isPublishedScheduleVisibleToAssignee({
        audience: "owner",
        ownerVisible: false,
        subVendorVisible: true,
        hasExplicitPartnerSelection: true,
      }),
    ).toBe(false)
    expect(
      isPublishedScheduleVisibleToAssignee({
        audience: "sub_vendor",
        ownerVisible: true,
        subVendorVisible: false,
        hasExplicitPartnerSelection: true,
      }),
    ).toBe(false)
    expect(
      isPublishedScheduleVisibleToAssignee({
        audience: "sub_vendor",
        ownerVisible: true,
        subVendorVisible: false,
        hasExplicitPartnerSelection: false,
      }),
    ).toBe(true)
  })
})
