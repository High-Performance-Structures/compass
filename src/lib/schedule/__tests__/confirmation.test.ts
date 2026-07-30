import { describe, expect, it } from "vitest"

import {
  canViewerConfirmScheduleTask,
  isPublishedScheduleAssignmentVisible,
  newScheduleConfirmationState,
} from "@/lib/schedule/confirmation"

describe("schedule assignment confirmation", () => {
  const now = "2026-07-29T12:00:00.000Z"

  it("requests confirmation from an assigned Compass user", () => {
    expect(
      newScheduleConfirmationState({
        required: true,
        assignedUserId: "user-1",
        now,
      })
    ).toEqual({ status: "pending", requestedAt: now })
  })

  it("marks manual-name assignments as unavailable", () => {
    expect(
      newScheduleConfirmationState({
        required: true,
        assignedUserId: null,
        now,
      })
    ).toEqual({ status: "unavailable", requestedAt: now })
  })

  it("clears request state when confirmation is not required", () => {
    expect(
      newScheduleConfirmationState({
        required: false,
        assignedUserId: "user-1",
        now,
      })
    ).toEqual({ status: "not_requested", requestedAt: null })
  })

  it("only lets the assigned external user respond", () => {
    expect(
      canViewerConfirmScheduleTask({
        viewerIsInternal: false,
        viewerId: "assigned-user",
        assignedUserId: "assigned-user",
        confirmationRequired: true,
      })
    ).toBe(true)
    expect(
      canViewerConfirmScheduleTask({
        viewerIsInternal: true,
        viewerId: "assigned-user",
        assignedUserId: "assigned-user",
        confirmationRequired: true,
      })
    ).toBe(false)
    expect(
      canViewerConfirmScheduleTask({
        viewerIsInternal: false,
        viewerId: "different-user",
        assignedUserId: "assigned-user",
        confirmationRequired: true,
      })
    ).toBe(false)
  })

  it("gates assignment notifications on the published audience snapshot", () => {
    const shared = {
      currentAssignedUserId: "assigned-user",
      publishedAssignedUserId: "assigned-user",
      projectRole: "subcontractor",
      ownerVisible: true,
      subVendorVisible: true,
    } satisfies Parameters<typeof isPublishedScheduleAssignmentVisible>[0]

    expect(isPublishedScheduleAssignmentVisible(shared)).toBe(true)
    expect(
      isPublishedScheduleAssignmentVisible({
        ...shared,
        publishedAssignedUserId: "previous-user",
      })
    ).toBe(false)
    expect(
      isPublishedScheduleAssignmentVisible({
        ...shared,
        subVendorVisible: false,
      })
    ).toBe(false)
    expect(
      isPublishedScheduleAssignmentVisible({
        ...shared,
        confirmationRequired: true,
        publishedConfirmationRequired: false,
      })
    ).toBe(false)
  })
})
