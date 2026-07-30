import { describe, expect, it } from "vitest"

import { newScheduleConfirmationState } from "@/lib/schedule/confirmation"

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
})
