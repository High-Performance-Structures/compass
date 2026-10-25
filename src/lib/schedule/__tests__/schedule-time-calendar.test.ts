import { describe, expect, it } from "vitest"

import { scheduleItem } from "@/lib/my-compass-calendar/items"
import { projectEventBody, scheduleTaskItem } from "@/lib/project-calendars/items"

const task = {
  id: "task-1",
  projectId: "project-1",
  title: "Pour footings",
  startDate: "2026-10-27",
  endDate: "2026-10-27",
  phase: "foundation",
  isMilestone: false,
  assignedTo: "Wes Jones",
  status: "PENDING",
}
const project = { name: "Loomis", projectNumber: "O-170" }
const baseUrl = "https://compass.example"

describe("schedule item times on Google calendars", () => {
  it("sends a timed project calendar event for a single-day item with a time", () => {
    const item = scheduleTaskItem({ baseUrl, task: { ...task, startTime: "08:00", endTime: "12:00" }, timeZone: "America/Denver" })
    expect(item.timing).toEqual({
      kind: "time",
      startsAt: "2026-10-27T08:00:00",
      endsAt: "2026-10-27T12:00:00",
      timeZone: "America/Denver",
    })
    expect(JSON.parse(projectEventBody(item)).start).toEqual({ dateTime: "2026-10-27T08:00:00", timeZone: "America/Denver" })
  })

  it("keeps all-day and multi-day items as dates, noting a multi-day time", () => {
    expect(scheduleTaskItem({ baseUrl, task, timeZone: "America/Denver" }).timing.kind).toBe("date")
    const multiDay = scheduleTaskItem({
      baseUrl,
      task: { ...task, endDate: "2026-10-29", startTime: "07:00" },
      timeZone: "America/Denver",
    })
    expect(multiDay.timing).toEqual({ kind: "date", startDate: "2026-10-27", endDateExclusive: "2026-10-30" })
    expect(multiDay.description).toContain("Time: 7:00 AM")
  })

  it("times a My Compass item the same way", () => {
    const timed = scheduleItem({ baseUrl, task: { ...task, startTime: "08:00" }, project, timeZone: "America/Denver" })
    expect(timed.timed).toEqual({ startsAt: "2026-10-27T08:00:00", endsAt: "2026-10-27T09:00:00", timeZone: "America/Denver" })
    const allDay = scheduleItem({ baseUrl, task, project, timeZone: "America/Denver" })
    expect(allDay.timed).toBeUndefined()
    expect(allDay).toMatchObject({ startDate: "2026-10-27", endDateExclusive: "2026-10-28" })
  })
})
