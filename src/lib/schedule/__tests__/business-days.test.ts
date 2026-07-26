import { describe, expect, it } from "vitest"
import {
  addBusinessDays,
  calculateEndDate,
  countBusinessDays,
  isNonWorkday,
} from "../business-days"
import type { WorkdayExceptionData } from "../types"

function exception(
  overrides: Partial<WorkdayExceptionData>
): WorkdayExceptionData {
  return {
    id: "exception-1",
    projectId: "project-1",
    title: "Exception",
    startDate: "2026-07-25",
    endDate: "2026-07-25",
    type: "non_working",
    category: "company_holiday",
    recurrence: "one_time",
    notes: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("business-day calendar", () => {
  it("skips weekends by default", () => {
    expect(addBusinessDays("2026-07-24", 1)).toBe("2026-07-27")
    expect(countBusinessDays("2026-07-24", "2026-07-27")).toBe(2)
  })

  it("allows a weekend to be made into a working day", () => {
    const exceptions = [exception({ type: "working" })]

    expect(isNonWorkday(new Date("2026-07-25T12:00:00"), exceptions)).toBe(false)
    expect(calculateEndDate("2026-07-24", 2, exceptions)).toBe("2026-07-25")
    expect(addBusinessDays("2026-07-24", 1, exceptions)).toBe("2026-07-25")
  })

  it("lets a working override take precedence over a shutdown", () => {
    const exceptions = [
      exception({
        id: "shutdown",
        startDate: "2026-07-24",
        endDate: "2026-07-26",
      }),
      exception({ id: "override", type: "working" }),
    ]

    expect(isNonWorkday(new Date("2026-07-25T12:00:00"), exceptions)).toBe(false)
  })

  it("applies yearly exceptions in future years", () => {
    const christmas = exception({
      startDate: "2026-12-25",
      endDate: "2026-12-25",
      recurrence: "yearly",
    })

    expect(isNonWorkday(new Date("2027-12-25T12:00:00"), [christmas])).toBe(true)
  })

  it("supports negative leads when counting business days", () => {
    expect(addBusinessDays("2026-07-27", -1)).toBe("2026-07-24")
  })
})
