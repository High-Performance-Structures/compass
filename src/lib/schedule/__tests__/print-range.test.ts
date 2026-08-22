import { describe, expect, it } from "vitest"

import {
  filterScheduleItemsForPrint,
  normalizeSchedulePrintRange,
  schedulePrintPresetRange,
} from "@/lib/schedule/print-range"

describe("schedule print ranges", () => {
  it("builds inclusive rolling presets", () => {
    expect(schedulePrintPresetRange("next_7", "2026-08-21", [])).toEqual({
      start: "2026-08-21",
      end: "2026-08-27",
    })
  })

  it("includes schedule items that overlap either edge", () => {
    const items = [
      { id: "old", startDate: "2026-08-01", endDate: "2026-08-10" },
      { id: "spanning", startDate: "2026-08-15", endDate: "2026-08-25" },
      { id: "inside", startDate: "2026-08-22", endDate: "2026-08-23" },
      { id: "future", startDate: "2026-09-01", endDate: "2026-09-02" },
    ]

    expect(
      filterScheduleItemsForPrint(items, {
        start: "2026-08-21",
        end: "2026-08-27",
      }).map((item) => item.id)
    ).toEqual(["spanning", "inside"])
  })

  it("rejects reversed and invalid custom ranges", () => {
    expect(
      normalizeSchedulePrintRange("2026-08-27", "2026-08-21")
    ).toBeNull()
    expect(
      normalizeSchedulePrintRange("2026-02-30", "2026-03-02")
    ).toBeNull()
  })
})
