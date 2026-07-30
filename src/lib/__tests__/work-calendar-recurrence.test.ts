import { describe, expect, it } from "vitest"

import { expandWorkCalendarRecurrence } from "@/lib/work-calendar-recurrence"

describe("work calendar recurrence", () => {
  it("expands weekly events inside the requested window", () => {
    expect(
      expandWorkCalendarRecurrence({
        startDate: "2026-07-06",
        endDate: "2026-07-06",
        recurrence: "weekly",
        recurrenceUntil: "2026-08-03",
        windowStart: "2026-07-20",
        windowEnd: "2026-07-31",
      })
    ).toEqual([
      { startDate: "2026-07-20", endDate: "2026-07-20" },
      { startDate: "2026-07-27", endDate: "2026-07-27" },
    ])
  })

  it("preserves multi-day event duration", () => {
    expect(
      expandWorkCalendarRecurrence({
        startDate: "2026-07-06",
        endDate: "2026-07-08",
        recurrence: "weekly",
        recurrenceUntil: "2026-07-20",
        windowStart: "2026-07-01",
        windowEnd: "2026-07-31",
      })
    ).toEqual([
      { startDate: "2026-07-06", endDate: "2026-07-08" },
      { startDate: "2026-07-13", endDate: "2026-07-15" },
      { startDate: "2026-07-20", endDate: "2026-07-22" },
    ])
  })

  it("skips monthly dates that do not exist", () => {
    expect(
      expandWorkCalendarRecurrence({
        startDate: "2026-01-31",
        endDate: "2026-01-31",
        recurrence: "monthly",
        recurrenceUntil: "2026-04-30",
        windowStart: "2026-01-01",
        windowEnd: "2026-04-30",
      })
    ).toEqual([
      { startDate: "2026-01-31", endDate: "2026-01-31" },
      { startDate: "2026-03-31", endDate: "2026-03-31" },
    ])
  })
})
