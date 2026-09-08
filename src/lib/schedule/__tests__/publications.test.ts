import { describe, expect, it } from "vitest"

import {
  getPublicationChangeReasonError,
  isDraftScheduleAction,
  parsePublishedScheduleSnapshot,
} from "@/lib/schedule/publications"

describe("schedule publications", () => {
  it("parses a versioned external schedule snapshot", () => {
    const snapshot = parsePublishedScheduleSnapshot(JSON.stringify({
      version: 1,
      tasks: [{
        id: "task-1",
        projectId: "project-1",
        title: "Framing",
        startDate: "2026-07-01",
        workdays: 5,
        endDateCalculated: "2026-07-07",
        phase: "framing",
        displayColor: "blue",
        status: "IN_PROGRESS",
        isCriticalPath: true,
        isMilestone: false,
        percentComplete: 50,
        assignedTo: "Crew",
        sortOrder: 1,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
      }],
      dependencies: [],
      exceptions: [],
    }))

    expect(snapshot?.tasks[0]).toMatchObject({
      title: "Framing",
      confirmationRequired: false,
      confirmationStatus: "not_requested",
      proposedStartDate: null,
      proposedWorkdays: null,
    })
    expect(snapshot?.tasks[0]?.ownerVisible).toBeUndefined()
    expect(snapshot?.tasks[0]?.subVendorVisible).toBeUndefined()
  })

  it("preserves a proposed subcontractor response in a publication", () => {
    const baseTask = {
      id: "task-1",
      projectId: "project-1",
      title: "Framing",
      startDate: "2026-07-01",
      workdays: 5,
      endDateCalculated: "2026-07-07",
      phase: "framing",
      displayColor: "orange",
      status: "PENDING",
      isCriticalPath: false,
      isMilestone: false,
      percentComplete: 0,
      assignedTo: "Crew",
      confirmationRequired: true,
      confirmationStatus: "proposed",
      proposedStartDate: "2026-07-08",
      proposedWorkdays: 7,
      proposalNote: "Crew conflict",
      proposalSubmittedAt: "2026-07-02T00:00:00.000Z",
      sortOrder: 1,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    }
    const snapshot = parsePublishedScheduleSnapshot(
      JSON.stringify({
        version: 1,
        tasks: [baseTask],
        dependencies: [],
        exceptions: [],
      })
    )

    expect(snapshot?.tasks[0]).toMatchObject({
      displayColor: "orange",
      confirmationStatus: "proposed",
      proposedStartDate: "2026-07-08",
      proposedWorkdays: 7,
    })
  })

  it("rejects malformed publication data", () => {
    expect(parsePublishedScheduleSnapshot('{"version":2}')).toBeNull()
    expect(parsePublishedScheduleSnapshot("not-json")).toBeNull()
  })

  it("distinguishes draft-changing schedule activity", () => {
    expect(isDraftScheduleAction("schedule.item_updated")).toBe(true)
    expect(isDraftScheduleAction("schedule.dependency_updated")).toBe(true)
    expect(isDraftScheduleAction("schedule.baseline_created")).toBe(false)
    expect(isDraftScheduleAction("schedule.published")).toBe(false)
  })

  it("allows the first publication without a change reason", () => {
    expect(getPublicationChangeReasonError("", false)).toBeNull()
    expect(getPublicationChangeReasonError("  ", false)).toBeNull()
  })

  it("requires a change reason after the schedule has been published", () => {
    expect(getPublicationChangeReasonError("", true)).toBe(
      "Enter a publish reason between 3 and 500 characters."
    )
    expect(
      getPublicationChangeReasonError("Updated framing dates", true)
    ).toBeNull()
  })

  it("limits optional and required publication reasons to 500 characters", () => {
    const reason = "a".repeat(501)
    expect(getPublicationChangeReasonError(reason, false)).toBe(
      "Enter a publish reason of 500 characters or less."
    )
    expect(getPublicationChangeReasonError(reason, true)).toBe(
      "Enter a publish reason of 500 characters or less."
    )
  })
})
