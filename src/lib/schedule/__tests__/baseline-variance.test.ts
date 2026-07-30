import { describe, expect, it } from "vitest"

import {
  scheduleBaselineVariance,
  type BaselineTaskLike,
} from "@/lib/schedule/baseline-variance"

function task(
  id: string,
  startDate: string,
  endDateCalculated: string,
  workdays = 5
): BaselineTaskLike {
  return {
    id,
    title: `Item ${id}`,
    startDate,
    endDateCalculated,
    workdays,
  }
}

describe("scheduleBaselineVariance", () => {
  it("reports project finish slippage from dates rather than duration", () => {
    const baseline = [task("a", "2026-07-01", "2026-07-10", 5)]
    const current = [task("a", "2026-07-08", "2026-07-17", 5)]

    const report = scheduleBaselineVariance(current, baseline)

    expect(report.finishVarianceDays).toBe(7)
    expect(report.rows[0]?.durationVarianceDays).toBe(0)
    expect(report.rows[0]?.startVarianceDays).toBe(7)
    expect(report.rows[0]?.finishVarianceDays).toBe(7)
    expect(report.delayedItemCount).toBe(1)
  })

  it("reports early finishes and added or removed items", () => {
    const baseline = [
      task("a", "2026-07-01", "2026-07-20"),
      task("removed", "2026-07-21", "2026-07-25"),
    ]
    const current = [
      task("a", "2026-07-01", "2026-07-15"),
      task("new", "2026-07-16", "2026-07-18"),
    ]

    const report = scheduleBaselineVariance(current, baseline)

    expect(report.finishVarianceDays).toBe(-7)
    expect(report.aheadItemCount).toBe(1)
    expect(report.rows.map((row) => row.state)).toEqual([
      "existing",
      "new",
      "removed",
    ])
  })
})
