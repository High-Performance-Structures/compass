import { describe, expect, it } from "vitest"
import {
  addBusinessDays,
  calculateEndDate,
  countBusinessDays,
  isNonWorkday,
  workdaysFromEndDate,
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

describe("workdaysFromEndDate", () => {
  // 2026-10-26 is a Monday.
  it("counts workdays from the start to a chosen weekday end", () => {
    expect(workdaysFromEndDate("2026-10-26", "2026-10-30")).toEqual({
      success: true, workdays: 5, endDate: "2026-10-30", snapped: false,
    })
  })

  it("moves a weekend end back to Friday and says so", () => {
    expect(workdaysFromEndDate("2026-10-26", "2026-11-01")).toEqual({
      success: true, workdays: 5, endDate: "2026-10-30", snapped: true,
    })
  })

  it("skips company holidays like calculateEndDate does", () => {
    const holiday = exception({ startDate: "2026-10-28", endDate: "2026-10-28" })
    const result = workdaysFromEndDate("2026-10-26", "2026-10-30", [holiday])
    expect(result).toEqual({ success: true, workdays: 4, endDate: "2026-10-30", snapped: false })
    expect(calculateEndDate("2026-10-26", 4, [holiday])).toBe("2026-10-30")
  })

  it("moves an end on a holiday back to the workday before", () => {
    const holiday = exception({ startDate: "2026-10-30", endDate: "2026-10-30" })
    expect(workdaysFromEndDate("2026-10-26", "2026-10-30", [holiday])).toEqual({
      success: true, workdays: 4, endDate: "2026-10-29", snapped: true,
    })
  })

  it("treats the same day as one workday", () => {
    expect(workdaysFromEndDate("2026-10-26", "2026-10-26")).toEqual({
      success: true, workdays: 1, endDate: "2026-10-26", snapped: false,
    })
  })

  it("rejects an end before the start", () => {
    expect(workdaysFromEndDate("2026-10-26", "2026-10-23")).toEqual({
      success: false, error: "The end date can't be before the start date.",
    })
  })

  it("round-trips with calculateEndDate for every duration in a month", () => {
    for (let workdays = 1; workdays <= 22; workdays += 1) {
      const end = calculateEndDate("2026-10-26", workdays)
      expect(workdaysFromEndDate("2026-10-26", end)).toMatchObject({ success: true, workdays, endDate: end })
    }
  })
})
