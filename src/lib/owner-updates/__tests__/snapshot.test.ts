import { describe, expect, it } from "vitest"

import {
  dateRangeFromDates,
  isDateWithinOwnerUpdatePeriod,
  isValidOwnerUpdatePeriod,
  parseOwnerUpdateComposerSnapshot,
  parseOwnerUpdateScheduleSnapshot,
  selectRowsByIdOrder,
  serializeOwnerUpdateComposerSnapshot,
  serializeOwnerUpdateScheduleSnapshot,
  type OwnerUpdateComposerSnapshot,
} from "@/lib/owner-updates/snapshot"

describe("owner update snapshots", () => {
  it("treats an empty selection as empty instead of selecting every row", () => {
    const rows = [
      { id: "first", value: 1 },
      { id: "second", value: 2 },
    ]

    expect(selectRowsByIdOrder(rows, [])).toEqual([])
  })

  it("returns only exact selected rows in the saved order", () => {
    const rows = [
      { id: "first", value: 1 },
      { id: "second", value: 2 },
      { id: "third", value: 3 },
    ]

    expect(selectRowsByIdOrder(rows, ["third", "first", "missing"])).toEqual([
      { id: "third", value: 3 },
      { id: "first", value: 1 },
    ])
  })

  it("round-trips a valid schedule snapshot", () => {
    const schedule = [
      {
        title: "Install cabinets",
        startDate: "2026-07-27",
        endDate: "2026-07-29",
        assignedTo: "Finish crew",
      },
    ]

    expect(
      parseOwnerUpdateScheduleSnapshot(
        serializeOwnerUpdateScheduleSnapshot(schedule)
      )
    ).toEqual(schedule)
  })

  it("rejects malformed schedule snapshots without leaking live data", () => {
    expect(parseOwnerUpdateScheduleSnapshot("not-json")).toEqual([])
    expect(
      parseOwnerUpdateScheduleSnapshot(
        JSON.stringify([{ title: "Missing dates" }])
      )
    ).toEqual([])
  })

  it("round-trips curated schedule, to-do, and document selections", () => {
    const snapshot: OwnerUpdateComposerSnapshot = {
      version: 2,
      completedScheduleItems: [
        {
          id: "schedule-complete",
          title: "Framing completed",
          startDate: "2026-07-20",
          endDate: "2026-07-24",
          assignedTo: "Framing crew",
          status: "COMPLETE",
          percentComplete: 100,
          notes: "Ready for inspection.",
        },
      ],
      lookAheadScheduleItems: [],
      todos: [
        {
          id: "todo-one",
          title: "Confirm appliance delivery",
          description: "Coordinate delivery window.",
          status: "open",
          priority: "normal",
          assigneeName: "Rebekah",
          companyName: null,
          dueDate: "2026-07-29",
          timing: "upcoming",
          notes: "",
        },
      ],
      documents: [
        {
          id: "document-one",
          fileName: "selection.pdf",
          mimeType: "application/pdf",
          driveFileId: "drive-one",
          driveUrl: null,
          caption: "Approved selection",
          capturedAt: "2026-07-24T12:00:00.000Z",
          sourceSystem: "compass_upload",
        },
      ],
    }

    expect(
      parseOwnerUpdateComposerSnapshot(
        serializeOwnerUpdateComposerSnapshot(snapshot)
      )
    ).toEqual(snapshot)
  })

  it("derives reporting periods from selected log dates", () => {
    expect(
      dateRangeFromDates(["2026-07-24", "2026-07-21", "invalid"])
    ).toEqual({
      startDate: "2026-07-21",
      endDate: "2026-07-24",
    })
    expect(dateRangeFromDates([])).toBeNull()
  })

  it("validates and enforces reporting-period boundaries", () => {
    expect(isValidOwnerUpdatePeriod("2026-07-20", "2026-07-26")).toBe(true)
    expect(isValidOwnerUpdatePeriod("2026-07-27", "2026-07-26")).toBe(false)
    expect(isValidOwnerUpdatePeriod("07/20/2026", "2026-07-26")).toBe(false)
    expect(
      isDateWithinOwnerUpdatePeriod(
        "2026-07-23",
        "2026-07-20",
        "2026-07-26"
      )
    ).toBe(true)
    expect(
      isDateWithinOwnerUpdatePeriod(
        "2026-07-19",
        "2026-07-20",
        "2026-07-26"
      )
    ).toBe(false)
  })
})
