import { describe, expect, it } from "vitest"

import {
  calendarWindow,
  canChangeLinkedGoogleEvent,
  cleanOptionalUrl,
  configuredDefaultProject,
  eventStartLabel,
  intersectsCalendarWindow,
  isClosedStatus,
  localTimeInZone,
  normalizedAttendeeIds,
  operationSourceLabel,
  resolveEventProject,
  userDisplayName,
  validateEventFields,
  writableGoogleDestinations,
} from "../rules"
import type { WorkCalendarEventMutationInput } from "../types"

const baseInput: WorkCalendarEventMutationInput = {
  title: "  Site walk ",
  eventType: "meeting",
  visibility: "organization",
  description: null,
  projectId: null,
  allDay: true,
  startDate: "2026-11-02",
  endDate: "2026-11-02",
  startTime: "",
  endTime: "",
  startsAt: null,
  endsAt: null,
  timeZone: "America/Denver",
  location: null,
  meetingUrl: null,
  createGoogleMeet: false,
  recurrence: "none",
  recurrenceUntil: null,
  attendeeUserIds: [],
  calendarSelectionId: null,
}

describe("work calendar rules", () => {
  it("loads two weeks back and 45 days ahead of the reference date", () => {
    expect(calendarWindow("2026-11-01")).toEqual({ rangeStart: "2026-10-18", rangeEnd: "2026-12-16" })
  })

  it("keeps items in the window or covering today", () => {
    expect(intersectsCalendarWindow("2026-10-01", "2026-10-05", "2026-10-18", "2026-12-16", "2026-11-01")).toBe(false)
    expect(intersectsCalendarWindow("2026-10-01", "2026-10-20", "2026-10-18", "2026-12-16", "2026-11-01")).toBe(true)
    expect(intersectsCalendarWindow("2026-01-01", "2027-01-01", "2027-02-01", "2027-03-01", "2026-06-01")).toBe(true)
  })

  it("treats closed statuses case-insensitively", () => {
    expect(isClosedStatus(" Completed ")).toBe(true)
    expect(isClosedStatus("open")).toBe(false)
  })

  it("labels to-do sources", () => {
    expect(operationSourceLabel("calendar_event", "1")).toBe("Calendar event")
    expect(operationSourceLabel("schedule_task", null)).toBe("Schedule item follow-up")
    expect(operationSourceLabel("schedule_task", "7")).toBe("Schedule item follow-up 7")
    expect(operationSourceLabel("purchase_order", "PO-3")).toBe("Purchase Order PO-3")
  })

  it("prefers display name, then full name, then email", () => {
    expect(userDisplayName({ displayName: " ", firstName: "Ann", lastName: "Lee", email: "a@x" })).toBe("Ann Lee")
    expect(userDisplayName({ displayName: null, firstName: null, lastName: null, email: "a@x" })).toBe("a@x")
    expect(userDisplayName({ displayName: "Annie", firstName: "Ann", lastName: null, email: "a@x" })).toBe("Annie")
  })

  it("formats local times and start labels", () => {
    expect(localTimeInZone("2026-11-02T15:30:00.000Z", "America/Denver")).toBe("08:30")
    expect(localTimeInZone(null, "UTC")).toBe("")
    expect(eventStartLabel({ startDate: "2026-11-02", startsAt: null, timeZone: "UTC" })).toBe("Nov 2, 2026")
    expect(eventStartLabel({ startDate: null, startsAt: null, timeZone: "UTC" })).toBe("its scheduled time")
  })

  it("lets owners, and staff on shared calendars with permission, change linked events", () => {
    const base = { role: "office", userId: "u1", ownerUserId: "u2", calendarScope: "organization" }
    expect(canChangeLinkedGoogleEvent({ ...base, ownerUserId: "u1", calendarScope: "personal", allowedForInternalUsers: false })).toBe(true)
    expect(canChangeLinkedGoogleEvent({ ...base, calendarScope: "personal", allowedForInternalUsers: true })).toBe(false)
    expect(canChangeLinkedGoogleEvent({ ...base, allowedForInternalUsers: true })).toBe(true)
    expect(canChangeLinkedGoogleEvent({ ...base, role: "admin", allowedForInternalUsers: false })).toBe(true)
  })

  it("lists only writable destinations the viewer may create in", () => {
    const rows = [
      { selectionId: "a", summary: "Mine", calendarScope: "personal", accessRole: "owner", ownerUserId: "u1", internalCanCreate: false },
      { selectionId: "b", summary: "Theirs", calendarScope: "personal", accessRole: "owner", ownerUserId: "u2", internalCanCreate: true },
      { selectionId: "c", summary: "Office", calendarScope: "organization", accessRole: "writer", ownerUserId: "u2", internalCanCreate: true },
      { selectionId: "d", summary: "Read", calendarScope: "organization", accessRole: "reader", ownerUserId: "u2", internalCanCreate: true },
    ]
    expect(writableGoogleDestinations(rows, "u1")).toEqual([
      { selectionId: "a", label: "Mine", calendarScope: "personal" },
      { selectionId: "c", label: "Office", calendarScope: "organization" },
    ])
  })

  it("ignores a configured default project the viewer cannot see", () => {
    const projects = [{ id: "p1", name: "One", projectNumber: null }]
    expect(configuredDefaultProject("p1", projects)).toBe("p1")
    expect(configuredDefaultProject("p2", projects)).toBeNull()
    expect(configuredDefaultProject(null, projects)).toBeNull()
  })

  it("resolves the event project and whether to remember the H-Office default", () => {
    const projects = [
      { id: "p1", name: "H-Office", projectNumber: "H-OFFICE" },
      { id: "p2", name: "Smith", projectNumber: "O-1" },
    ]
    expect(resolveEventProject({ projectId: "p2" }, projects, null)).toEqual({ project: projects[1], rememberAsDefault: false })
    expect(() => resolveEventProject({ projectId: "nope" }, projects, null)).toThrow("Project not found")
    expect(resolveEventProject({ projectId: null }, projects, "p2")).toEqual({ project: projects[1], rememberAsDefault: false })
  })

  it("normalizes attendee ids and caps them at 100", () => {
    expect(normalizedAttendeeIds([" a ", "a", "", "b"])).toEqual(["a", "b"])
    expect(() => normalizedAttendeeIds(Array.from({ length: 101 }, (_, index) => `u${index}`))).toThrow(
      "An event can include up to 100 attendees",
    )
  })

  it("validates URLs and event fields with the original messages", () => {
    expect(cleanOptionalUrl("https://meet.example.com/x", "Meeting link")).toBe("https://meet.example.com/x")
    expect(() => cleanOptionalUrl("ftp://x", "Meeting link")).toThrow("Meeting link must be a valid web address")
    expect(validateEventFields(baseInput).title).toBe("Site walk")
    expect(() => validateEventFields({ ...baseInput, title: " " })).toThrow("Event title is required")
    expect(() => validateEventFields({ ...baseInput, createGoogleMeet: true, eventType: "company_event" })).toThrow(
      "Google Meet can only be added to meeting events",
    )
    expect(() =>
      validateEventFields({ ...baseInput, recurrence: "weekly", recurrenceUntil: "2026-10-01" }),
    ).toThrow("Repeat-until date must be on or after the first event")
    expect(() =>
      validateEventFields({ ...baseInput, recurrence: "weekly", recurrenceUntil: "2037-01-01" }),
    ).toThrow("A recurring series can span up to 10 years")
  })
})
