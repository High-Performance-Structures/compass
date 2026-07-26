import { describe, expect, it } from "vitest"
import {
  effectivePercentComplete,
  normalizeScheduleProgress,
} from "../progress"

describe("schedule progress", () => {
  it("always presents a completed schedule item as 100 percent", () => {
    expect(effectivePercentComplete("COMPLETE", 0)).toBe(100)
    expect(normalizeScheduleProgress("COMPLETE", 35)).toEqual({
      status: "COMPLETE",
      percentComplete: 100,
    })
  })

  it("does not leave a non-complete item at 100 percent", () => {
    expect(effectivePercentComplete("IN_PROGRESS", 100)).toBe(99)
  })

  it("clamps invalid progress values", () => {
    expect(effectivePercentComplete("PENDING", -10)).toBe(0)
    expect(effectivePercentComplete("BLOCKED", Number.NaN)).toBe(0)
  })
})
