import { describe, expect, it } from "vitest"

import {
  ALL_DAILY_LOG_AUTHORS,
  matchesDailyLogPrintFilters,
  UNKNOWN_DAILY_LOG_AUTHOR,
} from "@/lib/daily-logs/print-selection"

const logs = [
  { logDate: "2026-07-21", authorName: "Rebekah" },
  { logDate: "2026-07-22", authorName: null },
  { logDate: "2026-07-23", authorName: "Sylvi" },
] as const

describe("matchesDailyLogPrintFilters", () => {
  it("includes both boundaries of a date range", () => {
    expect(
      logs.filter((log) =>
        matchesDailyLogPrintFilters(
          log,
          "2026-07-21",
          "2026-07-22",
          ALL_DAILY_LOG_AUTHORS
        )
      )
    ).toEqual([logs[0], logs[1]])
  })

  it("filters by author", () => {
    expect(
      logs.filter((log) =>
        matchesDailyLogPrintFilters(
          log,
          "",
          "",
          "Sylvi"
        )
      )
    ).toEqual([logs[2]])
  })

  it("supports imported logs without an author", () => {
    expect(
      logs.filter((log) =>
        matchesDailyLogPrintFilters(
          log,
          "",
          "",
          UNKNOWN_DAILY_LOG_AUTHOR
        )
      )
    ).toEqual([logs[1]])
  })
})
