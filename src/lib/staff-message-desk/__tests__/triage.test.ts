import { describe, expect, it } from "vitest"
import { businessDaysBetween, staffMessageAging } from "@/lib/staff-message-desk/triage"

// 2026-10-09 is a Friday.
const friday = "2026-10-09T15:00:00.000Z"

describe("businessDaysBetween", () => {
  it("skips weekends", () => {
    expect(businessDaysBetween(friday, new Date("2026-10-12T15:00:00.000Z"))).toBeCloseTo(1, 5)
    expect(businessDaysBetween(friday, new Date("2026-10-10T15:00:00.000Z"))).toBeCloseTo(0.375, 5)
  })
})

describe("staffMessageAging", () => {
  const base = { status: "new" as const, createdAt: friday, lastActivityAt: friday }

  it("is on track the same day", () => {
    expect(staffMessageAging(base, new Date("2026-10-09T20:00:00.000Z")).level).toBe("fresh")
  })

  it("needs a first response after a business day, not over the weekend", () => {
    expect(staffMessageAging(base, new Date("2026-10-11T20:00:00.000Z")).level).toBe("fresh")
    expect(staffMessageAging(base, new Date("2026-10-12T16:00:00.000Z")).level).toBe("needs_response")
  })

  it("flags open messages as aging, then stale", () => {
    const working = { ...base, status: "in_progress" as const }
    expect(staffMessageAging(working, new Date("2026-10-13T16:00:00.000Z")).level).toBe("aging")
    expect(staffMessageAging(working, new Date("2026-10-16T16:00:00.000Z")).level).toBe("stale")
  })

  it("never flags resolved messages", () => {
    expect(staffMessageAging({ ...base, status: "resolved" }, new Date("2026-11-30T16:00:00.000Z")).level).toBe("fresh")
  })
})
