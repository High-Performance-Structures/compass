import { describe, expect, it } from "vitest"

import {
  calculateEndDate,
  calculateStartDate,
  countBusinessDays,
  addBusinessDays,
} from "@/lib/schedule/business-days"
import type { WorkdayExceptionData } from "@/lib/schedule/types"

function exception(
  date: string,
  type: WorkdayExceptionData["type"]
): WorkdayExceptionData {
  return {
    id: `${type}-${date}`,
    projectId: "project-1",
    title: type === "working" ? "Approved Saturday work" : "Day off",
    startDate: date,
    endDate: date,
    type,
    category: type === "working" ? "extra_workday" : "company_holiday",
    recurrence: "one_time",
    notes: null,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  }
}

describe("business day exceptions", () => {
  it("counts an approved weekend date as a working day", () => {
    const saturday = exception("2026-07-25", "working")

    expect(countBusinessDays("2026-07-24", "2026-07-25", [saturday])).toBe(2)
    expect(calculateEndDate("2026-07-24", 2, [saturday])).toBe("2026-07-25")
  })

  it("continues to omit non-working weekdays", () => {
    const monday = exception("2026-07-27", "non_working")

    expect(calculateEndDate("2026-07-24", 2, [monday])).toBe("2026-07-28")
  })

  it("calculates a start date backward from a required finish", () => {
    expect(calculateStartDate("2026-07-24", 5)).toBe("2026-07-20")
  })

  it("supports negative lag as a business-day lead", () => {
    expect(addBusinessDays("2026-07-27", -2)).toBe("2026-07-23")
  })
})
