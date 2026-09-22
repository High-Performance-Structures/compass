import { describe, expect, it } from "vitest"

import {
  getPublicationChangeReasonError,
  activePublishedScheduleSnapshot,
  hasScheduleDraftChanges,
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

  it("hides historical snapshots while draft and never serves live rows", () => {
    const snapshotData = JSON.stringify({ version: 1, tasks: [], dependencies: [], exceptions: [] })
    expect(activePublishedScheduleSnapshot(false, snapshotData)).toBeNull()
    expect(activePublishedScheduleSnapshot(true, null)).toBeNull()
    expect(activePublishedScheduleSnapshot(true, "bad-data")).toBeNull()
    expect(activePublishedScheduleSnapshot(true, snapshotData)?.tasks).toEqual([])
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

  it("detects audience changes but ignores response-only updates", () => {
    const task = {
      id: "task-1",
      projectId: "project-1",
      title: "Framing",
      startDate: "2026-07-01",
      workdays: 5,
      endDateCalculated: "2026-07-07",
      phase: "framing",
      displayColor: "blue",
      status: "PENDING",
      isCriticalPath: false,
      isMilestone: false,
      percentComplete: 0,
      assignedTo: "Crew",
      ownerVisible: true,
      subVendorVisible: true,
      sortOrder: 1,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    }
    const createSnapshot = (changes: Record<string, unknown> = {}) =>
      parsePublishedScheduleSnapshot(JSON.stringify({
        version: 1,
        tasks: [{ ...task, ...changes }],
        dependencies: [],
        exceptions: [],
      }))
    const published = createSnapshot()
    const responseOnly = createSnapshot({
      confirmationStatus: "confirmed",
      confirmationRespondedAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    })
    const visibilityChanged = createSnapshot({ subVendorVisible: false })
    const dateChanged = createSnapshot({ startDate: "2026-07-02" })
    expect(published && responseOnly && hasScheduleDraftChanges(published, responseOnly)).toBe(false)
    expect(published && visibilityChanged && hasScheduleDraftChanges(published, visibilityChanged)).toBe(true)
    expect(published && dateChanged && hasScheduleDraftChanges(published, dateChanged)).toBe(true)
  })
})
