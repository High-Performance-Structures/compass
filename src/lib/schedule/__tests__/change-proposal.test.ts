import { describe, expect, it } from "vitest"

import { validateScheduleChangeProposal } from "@/lib/schedule/change-proposal"

describe("schedule change proposals", () => {
  it("normalizes a valid proposed date, duration, and note", () => {
    expect(
      validateScheduleChangeProposal({
        startDate: " 2026-09-14 ",
        workdays: 8,
        note: "  Crew becomes available after inspection.  ",
      })
    ).toEqual({
      success: true,
      proposal: {
        startDate: "2026-09-14",
        workdays: 8,
        note: "Crew becomes available after inspection.",
      },
    })
  })

  it("rejects impossible dates and non-integer durations", () => {
    expect(
      validateScheduleChangeProposal({
        startDate: "2026-02-30",
        workdays: 5,
      }).success
    ).toBe(false)
    expect(
      validateScheduleChangeProposal({
        startDate: "2026-09-14",
        workdays: 2.5,
      }).success
    ).toBe(false)
  })

  it("limits proposal notes", () => {
    expect(
      validateScheduleChangeProposal({
        startDate: "2026-09-14",
        workdays: 5,
        note: "x".repeat(1001),
      }).success
    ).toBe(false)
  })
})
