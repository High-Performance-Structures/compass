import { describe, expect, it } from "vitest"

import {
  formatScheduleTime,
  scheduleItemTimedWindow,
  normalizeScheduleItemTimes,
  scheduleItemTimeLabel,
} from "../item-time"

describe("normalizeScheduleItemTimes", () => {
  it("keeps an item all-day when no times are given", () => {
    expect(normalizeScheduleItemTimes("", null)).toEqual({ success: true, startTime: null, endTime: null })
  })

  it("accepts a start time alone or a later end time", () => {
    expect(normalizeScheduleItemTimes("08:00", undefined)).toEqual({ success: true, startTime: "08:00", endTime: null })
    expect(normalizeScheduleItemTimes("08:00", "16:30")).toEqual({ success: true, startTime: "08:00", endTime: "16:30" })
  })

  it("rejects bad or out-of-order times", () => {
    expect(normalizeScheduleItemTimes("8am", null).success).toBe(false)
    expect(normalizeScheduleItemTimes("", "10:00")).toEqual({ success: false, error: "Add a start time before an end time." })
    expect(normalizeScheduleItemTimes("10:00", "09:00")).toEqual({ success: false, error: "The end time must be after the start time." })
    expect(normalizeScheduleItemTimes("10:00", "10:00").success).toBe(false)
  })
})

describe("schedule item time labels", () => {
  it("formats 12-hour times", () => {
    expect(formatScheduleTime("00:05")).toBe("12:05 AM")
    expect(formatScheduleTime("12:00")).toBe("12:00 PM")
    expect(formatScheduleTime("13:30")).toBe("1:30 PM")
  })

  it("labels a start, a range, or nothing for all-day", () => {
    expect(scheduleItemTimeLabel({ startTime: "08:00" })).toBe("8:00 AM")
    expect(scheduleItemTimeLabel({ startTime: "08:00", endTime: "16:30" })).toBe("8:00 AM–4:30 PM")
    expect(scheduleItemTimeLabel({ startTime: null, endTime: null })).toBeNull()
  })
})

describe("scheduleItemTimedWindow", () => {
  const day = { startDate: "2026-10-27", endDate: "2026-10-27", isMilestone: false }

  it("keeps all-day and multi-day items all day", () => {
    expect(scheduleItemTimedWindow(day)).toBeNull()
    expect(scheduleItemTimedWindow({ ...day, endDate: "2026-10-29", startTime: "08:00" })).toBeNull()
  })

  it("times a single-day item, defaulting to one hour", () => {
    expect(scheduleItemTimedWindow({ ...day, startTime: "08:00", endTime: "16:30" })).toEqual({
      startsAt: "2026-10-27T08:00:00", endsAt: "2026-10-27T16:30:00",
    })
    expect(scheduleItemTimedWindow({ ...day, startTime: "23:30" })).toEqual({
      startsAt: "2026-10-27T23:30:00", endsAt: "2026-10-27T23:59:00",
    })
  })

  it("times a milestone on its end day", () => {
    expect(scheduleItemTimedWindow({ startDate: "2026-10-26", endDate: "2026-10-30", isMilestone: true, startTime: "09:00" }))
      .toEqual({ startsAt: "2026-10-30T09:00:00", endsAt: "2026-10-30T10:00:00" })
  })
})
