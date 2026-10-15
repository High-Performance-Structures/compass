import { describe, expect, it } from "vitest"

import {
  emptyWorkLine,
  parseWorkLineHours,
  totalWorkLineHours,
  validateDailyLogForm,
  type DailyLogFormValues,
} from "@/lib/daily-logs/daily-log-form"

const codes = [{ code: "01 71 13" }, { code: "03 31 00" }]

function values(overrides: Partial<DailyLogFormValues> = {}): DailyLogFormValues {
  return {
    logDate: "2026-10-13",
    workCompleted: "Set forms",
    workLines: [{ costCode: "01 71 13", hours: "2.5", description: "Moved in" }],
    crewPresent: "",
    materialsUsed: "",
    issues: "",
    safetyIncidents: "",
    visitorLog: "",
    notes: "",
    ...overrides,
  }
}

describe("validateDailyLogForm", () => {
  it("accepts a complete log and cleans its lines", () => {
    const result = validateDailyLogForm(values(), { requireCostCodeTime: true, requiredFields: [] }, codes)
    expect(result.errors).toEqual([])
    expect(result.workLines).toEqual([{ costCode: "01 71 13", hours: 2.5, description: "Moved in", todoId: null }])
  })

  it("requires a cost code line when the company does, ignoring blank rows", () => {
    const result = validateDailyLogForm(values({ workLines: [emptyWorkLine()] }), { requireCostCodeTime: true, requiredFields: [] }, codes)
    expect(result.errors.map((error) => error.key)).toEqual(["workLines"])
  })

  it("lets a log through without lines when not required", () => {
    const result = validateDailyLogForm(values({ workLines: [emptyWorkLine()] }), { requireCostCodeTime: false, requiredFields: [] }, codes)
    expect(result.errors).toEqual([])
    expect(result.workLines).toEqual([])
  })

  it("flags each part of a half-filled line", () => {
    const result = validateDailyLogForm(
      values({ workLines: [{ costCode: "", hours: "", description: "Something" }, { costCode: "99", hours: "30", description: "" }] }),
      { requireCostCodeTime: true, requiredFields: [] },
      codes,
    )
    expect(result.errors.map((error) => error.key)).toEqual([
      "workLines.0.costCode",
      "workLines.0.hours",
      "workLines.1.costCode",
      "workLines.1.hours",
    ])
  })

  it("lists errors in form order with required fields from settings", () => {
    const result = validateDailyLogForm(
      values({ logDate: "", workCompleted: " " }),
      { requireCostCodeTime: true, requiredFields: ["crewPresent", "safetyIncidents"] },
      codes,
    )
    expect(result.errors.map((error) => error.key)).toEqual(["logDate", "workCompleted", "crewPresent", "safetyIncidents"])
    expect(result.errors[2]?.message).toBe("Who was on site is required.")
  })
})

describe("hours", () => {
  it("rounds to the quarter hour and totals", () => {
    expect(parseWorkLineHours("1.1")).toEqual({ ok: true, hours: 1 })
    expect(parseWorkLineHours("0")).toEqual({ ok: false, error: "Enter hours greater than zero." })
    expect(totalWorkLineHours([{ hours: 1.5 }, { hours: 2 }])).toBe(3.5)
    expect(totalWorkLineHours([])).toBeNull()
  })
})
