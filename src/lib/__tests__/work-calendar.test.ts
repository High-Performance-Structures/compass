import { describe, expect, it } from "vitest"

import {
  instantForLocalDateTime,
  isValidDateKey,
  normalizeWorkCalendarEventTiming,
  projectTodoHref,
  resolveHOfficeProjectId,
  scheduleItemHref,
  workCalendarEntryMatches,
} from "@/lib/work-calendar"

const entry = {
  projectLabel: "O-202",
  projectName: "Loeffler Residence",
  title: "Confirm cabinet delivery",
  status: "open",
  priority: "normal",
  assignedTo: "Rebekah",
  companyName: "HPS",
  sourceLabel: "Staff Task TASK-014",
}

describe("work calendar navigation and search", () => {
  it("accepts only canonical calendar date keys", () => {
    expect(isValidDateKey("2026-07-27")).toBe(true)
    expect(isValidDateKey("2026-02-30")).toBe(false)
    expect(isValidDateKey("07/27/2026")).toBe(false)
  })

  it("matches a project name even when the display label is its project number", () => {
    expect(workCalendarEntryMatches(entry, "Loeffler")).toBe(true)
    expect(workCalendarEntryMatches(entry, "O-202")).toBe(true)
    expect(workCalendarEntryMatches(entry, "cabinet delivery")).toBe(true)
    expect(workCalendarEntryMatches(entry, "Loomis")).toBe(false)
  })

  it("builds focused links for to-dos and schedule items", () => {
    expect(projectTodoHref("proj/o 202", "todo/14")).toBe(
      "/dashboard/projects/proj%2Fo%20202/todos?item=todo%2F14#todo-todo%2F14"
    )
    expect(scheduleItemHref("proj/o 202", "task/8")).toBe(
      "/dashboard/projects/proj%2Fo%20202/schedule?view=list&item=task%2F8#schedule-item-task%2F8"
    )
  })
})

describe("H-Office default project resolution", () => {
  it("resolves one exact H-Office identity", () => {
    expect(
      resolveHOfficeProjectId([
        { id: "loeffler", name: "Loeffler", projectNumber: "O-202" },
        { id: "office", name: "H-Office", projectNumber: "H-OFFICE" },
      ])
    ).toBe("office")
  })

  it("fails closed when the default is missing or ambiguous", () => {
    expect(
      resolveHOfficeProjectId([
        { id: "loeffler", name: "Loeffler", projectNumber: "O-202" },
      ])
    ).toBeNull()
    expect(
      resolveHOfficeProjectId([
        { id: "office-1", name: "H-Office", projectNumber: null },
        { id: "office-2", name: "H Office Project", projectNumber: null },
      ])
    ).toBeNull()
  })
})

describe("work calendar event timing", () => {
  it("resolves wall-clock times in the organization time zone", () => {
    expect(
      instantForLocalDateTime(
        "2026-07-27",
        "09:30",
        "America/Denver"
      )
    ).toEqual({
      success: true,
      instant: "2026-07-27T15:30:00.000Z",
      ambiguous: false,
    })
  })

  it("rejects the spring-forward gap and marks the fall-back fold", () => {
    expect(
      instantForLocalDateTime(
        "2026-03-08",
        "02:30",
        "America/Denver"
      )
    ).toEqual({
      success: false,
      error: "That local time does not exist in the selected time zone.",
    })

    expect(
      instantForLocalDateTime(
        "2026-11-01",
        "01:30",
        "America/Denver"
      )
    ).toEqual({
      success: true,
      instant: "2026-11-01T07:30:00.000Z",
      ambiguous: true,
    })
  })

  it("normalizes all-day date ranges without inventing a time", () => {
    expect(
      normalizeWorkCalendarEventTiming({
        allDay: true,
        startDate: "2026-07-27",
        endDate: "2026-07-29",
        startTime: "",
        endTime: "",
        startsAt: null,
        endsAt: null,
        timeZone: "America/Denver",
      })
    ).toEqual({
      success: true,
      startDate: "2026-07-27",
      endDateExclusive: "2026-07-30",
      startsAt: null,
      endsAt: null,
      timeZone: "America/Denver",
    })
  })

  it("normalizes timed events and rejects zero or negative durations", () => {
    expect(
      normalizeWorkCalendarEventTiming({
        allDay: false,
        startDate: "2026-07-27",
        endDate: "2026-07-27",
        startTime: "09:30",
        endTime: "10:15",
        startsAt: "2026-07-27T15:30:00.000Z",
        endsAt: "2026-07-27T16:15:00.000Z",
        timeZone: "America/Denver",
      })
    ).toMatchObject({
      success: true,
      startDate: null,
      endDateExclusive: null,
      startsAt: "2026-07-27T15:30:00.000Z",
      endsAt: "2026-07-27T16:15:00.000Z",
    })

    expect(
      normalizeWorkCalendarEventTiming({
        allDay: false,
        startDate: "2026-07-27",
        endDate: "2026-07-27",
        startTime: "10:15",
        endTime: "10:15",
        startsAt: "2026-07-27T16:15:00.000Z",
        endsAt: "2026-07-27T16:15:00.000Z",
        timeZone: "America/Denver",
      })
    ).toEqual({
      success: false,
      error: "A timed event must end after it starts.",
    })
  })

  it("rejects impossible dates and backwards all-day ranges", () => {
    expect(
      normalizeWorkCalendarEventTiming({
        allDay: true,
        startDate: "2026-02-30",
        endDate: "2026-03-01",
        startTime: "",
        endTime: "",
        startsAt: null,
        endsAt: null,
        timeZone: "UTC",
      })
    ).toEqual({
      success: false,
      error: "Enter valid event dates.",
    })

    expect(
      normalizeWorkCalendarEventTiming({
        allDay: true,
        startDate: "2026-07-29",
        endDate: "2026-07-27",
        startTime: "",
        endTime: "",
        startsAt: null,
        endsAt: null,
        timeZone: "UTC",
      })
    ).toEqual({
      success: false,
      error: "End date must be on or after the start date.",
    })

    expect(
      normalizeWorkCalendarEventTiming({
        allDay: true,
        startDate: "2026-07-27",
        endDate: "2026-07-27",
        startTime: "",
        endTime: "",
        startsAt: null,
        endsAt: null,
        timeZone: "Not/A_Time_Zone",
      })
    ).toEqual({
      success: false,
      error: "The event time zone is invalid.",
    })
  })
})
