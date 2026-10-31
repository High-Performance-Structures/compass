import { describe, expect, it } from "vitest"

import {
  attendeesByEvent,
  compassEventEntries,
  personalGoogleEventEntries,
  projectAudience,
  projectSourceEntries,
  sortCalendarEntries,
  type CalendarViewer,
} from "../assemble"
import type { CalendarEventRow, CalendarProjectRow, PersonalGoogleEventRow } from "../types"

const range = { today: "2026-11-01", rangeStart: "2026-10-18", rangeEnd: "2026-12-16" }
const staff: CalendarViewer = {
  userId: "u1",
  role: "office",
  canManageEvents: true,
  canUseManagedGoogleCalendar: true,
  canViewWorkingSchedule: true,
}
const project: CalendarProjectRow = {
  id: "p1",
  name: "Smith Residence",
  projectNumber: "O-1",
  schedulePublished: false,
  ownerScheduleView: "items",
}

function event(overrides: Partial<CalendarEventRow> = {}): CalendarEventRow {
  return {
    id: "e1",
    projectId: "p1",
    title: "Walkthrough",
    eventType: "company_event",
    visibility: "organization",
    description: "Bring plans",
    startDate: "2026-11-03",
    endDateExclusive: "2026-11-04",
    startsAt: null,
    endsAt: null,
    allDay: true,
    timeZone: "America/Denver",
    location: null,
    meetingUrl: null,
    recurrence: "none",
    recurrenceUntil: null,
    status: "open",
    version: 2,
    createdBy: "u2",
    ...overrides,
  }
}

describe("work calendar assembler", () => {
  it("maps member roles to schedule audiences", () => {
    expect(projectAudience("client")).toBe("owner")
    expect(projectAudience("supplier")).toBe("sub_vendor")
    expect(projectAudience("manager")).toBeNull()
    expect(projectAudience(undefined)).toBeNull()
  })

  it("builds schedule, RFI and to-do entries per project", () => {
    const entries = projectSourceEntries(
      staff,
      {
        projects: [project],
        projectRoles: new Map(),
        publishedSnapshots: new Map(),
        workingTasks: [
          { projectId: "p1", id: "t1", title: "Framing", status: "in_progress", startDate: "2026-11-02", endDate: "2026-11-05", assignedTo: null, isCriticalPath: true },
          { projectId: "p1", id: "t2", title: "Done", status: "complete", startDate: "2026-11-02", endDate: "2026-11-05", assignedTo: null, isCriticalPath: false },
        ],
        rfis: [
          { projectId: "p1", id: "r1", rfiNumber: "4", subject: "Beam size", status: "open", priority: "high", dueDate: "2026-11-04", assignedToName: "Ann", companyName: "Eng" },
          { projectId: "p1", id: "r2", rfiNumber: "5", subject: "No date", status: "open", priority: "low", dueDate: null, assignedToName: null, companyName: null },
        ],
        operations: [
          { projectId: "p1", id: "o1", sourceRecordType: "purchase_order", sourceRecordId: null, sourceRecordNumber: "PO-1", title: "Lumber", status: "open", priority: "normal", assigneeName: null, companyName: "Yard", startDate: null, dueDate: "2026-11-06" },
          { projectId: "p1", id: "e1", sourceRecordType: "calendar_event", sourceRecordId: null, sourceRecordNumber: null, title: "Dup", status: "open", priority: "normal", assigneeName: null, companyName: null, startDate: "2026-11-06", dueDate: null },
          { projectId: "p1", id: "o3", sourceRecordType: "calendar_event", sourceRecordId: null, sourceRecordNumber: null, title: "Legacy", status: "closed", priority: "normal", assigneeName: null, companyName: null, startDate: "2026-11-07", dueDate: null },
        ],
        dedicatedEventIds: new Set(["e1"]),
      },
      range,
    )
    expect(entries.map((entry) => [entry.kind, entry.id, entry.sourceLabel])).toEqual([
      ["schedule", "t1", "Project schedule"],
      ["rfi", "r1", "RFI 4"],
      ["purchase_order", "o1", "Purchase Order PO-1"],
      // Legacy calendar rows stay visible whatever their status.
      ["event", "o3", "Legacy calendar event"],
    ])
    expect(entries[0]?.priority).toBe("critical")
  })

  it("shows busy projections without leaking details", () => {
    const viewer: CalendarViewer = { ...staff, userId: "u9" }
    const entries = compassEventEntries(
      viewer,
      {
        events: [event({ visibility: "busy" })],
        projectById: new Map([["p1", project]]),
        attendeesByEventId: new Map(),
        linkedEventById: new Map(),
      },
      range,
    )
    expect(entries).toHaveLength(1)
    const [entry] = entries
    expect(entry?.title).toBe("Busy")
    expect(entry?.projectLabel).toBe("Private")
    expect(entry?.eventDetails?.visibility).toBe("busy")
    expect(entry?.eventDetails?.description).toBeNull()
  })

  it("labels full events and joins attendee names", () => {
    const attendees = attendeesByEvent(
      [{ eventId: "e1", userId: "u3", email: "b@x", displayName: "Bea", firstName: null, lastName: null }],
      false,
    )
    const [entry] = compassEventEntries(
      staff,
      { events: [event()], projectById: new Map([["p1", project]]), attendeesByEventId: attendees, linkedEventById: new Map() },
      range,
    )
    expect(entry?.sourceLabel).toBe("Company Event")
    expect(entry?.assignedTo).toBe("Bea")
    expect(entry?.eventDetails?.attendees).toEqual([{ userId: "u3", name: "Bea", email: "" }])
    expect(entry?.eventDetails?.managed).toBe(true)
    expect(entry?.startDate).toBe("2026-11-03")
  })

  it("keeps other people's opaque Google events as busy and drops free ones", () => {
    const row: PersonalGoogleEventRow = {
      id: "g1",
      ownerUserId: "u2",
      ownerEmail: "o@x",
      ownerDisplayName: "Owen",
      ownerFirstName: null,
      ownerLastName: null,
      calendarName: "Personal",
      title: "Dentist",
      description: null,
      location: null,
      htmlLink: "https://calendar.google.com/x",
      meetingUrl: null,
      startDate: "2026-11-04",
      endDateExclusive: "2026-11-05",
      startsAt: null,
      endsAt: null,
      allDay: true,
      timeZone: null,
      visibility: null,
      transparency: "opaque",
      status: "confirmed",
    }
    const entries = personalGoogleEventEntries("u1", [row, { ...row, id: "g2", transparency: "transparent" }], "all", "America/Denver", range)
    expect(entries.map((entry) => [entry.id, entry.title, entry.href])).toEqual([["google-g1", "Busy", "/dashboard/schedule"]])
    expect(personalGoogleEventEntries("u1", [row], "me", "America/Denver", range)).toEqual([])
  })

  it("sorts by date, project label, then title", () => {
    const [entry] = compassEventEntries(
      staff,
      { events: [event()], projectById: new Map([["p1", project]]), attendeesByEventId: new Map(), linkedEventById: new Map() },
      range,
    )
    if (!entry) throw new Error("expected an entry")
    const sorted = sortCalendarEntries([
      { ...entry, id: "b", startDate: "2026-11-03", projectLabel: "B" },
      { ...entry, id: "a2", startDate: "2026-11-03", projectLabel: "A", title: "Z" },
      { ...entry, id: "a1", startDate: "2026-11-03", projectLabel: "A", title: "A" },
      { ...entry, id: "first", startDate: "2026-11-01" },
    ])
    expect(sorted.map((item) => item.id)).toEqual(["first", "a1", "a2", "b"])
  })
})
