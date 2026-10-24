import { describe, expect, it } from "vitest"

import { cleanScheduleImpactDays } from "@/lib/change-orders/schedule-impact"

describe("change order schedule impact", () => {
  it("accepts bounded whole-day schedule impacts", () => {
    expect(cleanScheduleImpactDays(null)).toBeNull()
    expect(cleanScheduleImpactDays(0)).toBe(0)
    expect(cleanScheduleImpactDays(45)).toBe(45)
    expect(() => cleanScheduleImpactDays(1.5)).toThrow("whole number")
    expect(() => cleanScheduleImpactDays(-1)).toThrow("whole number")
  })
})
