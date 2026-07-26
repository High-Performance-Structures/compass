import { describe, expect, it } from "vitest"

import {
  dateRangeFromDates,
  isDateWithinOwnerUpdatePeriod,
  isValidOwnerUpdatePeriod,
  parseOwnerUpdateScheduleSnapshot,
  selectRowsByIdOrder,
  serializeOwnerUpdateScheduleSnapshot,
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
