import { describe, expect, it } from "vitest"

import {
  dependencyType,
  exceptionData,
  isIsoDate,
  nonNegative,
  requiredText,
} from "@/lib/domain/templates/rules"

describe("template rules", () => {
  it("requires trimmed text", () => {
    expect(requiredText("  Deck  ", "Template name")).toBe("Deck")
    expect(() => requiredText("   ", "Template name")).toThrow("Template name is required.")
    expect(() => requiredText(null, "Cost code")).toThrow("Cost code is required.")
  })

  it("accepts non-negative numbers and falls back when empty", () => {
    expect(nonNegative(null, 1)).toBe(1)
    expect(nonNegative(0, 1)).toBe(0)
    expect(() => nonNegative(-1, 0)).toThrow("Quantity, cost, and markup cannot be negative.")
    expect(() => nonNegative(Number.NaN, 0)).toThrow()
  })

  it("accepts only real YYYY-MM-DD dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true)
    expect(isIsoDate("2026-02-30")).toBe(false)
    expect(isIsoDate("2026-2-3")).toBe(false)
  })

  it("narrows stored schedule values", () => {
    expect(dependencyType("SS")).toBe("SS")
    expect(dependencyType("XX")).toBe("FS")
    const row = {
      id: "x",
      projectId: "p",
      title: "Holiday",
      startDate: "2026-12-25",
      endDate: "2026-12-25",
      type: "other",
      category: "unknown",
      recurrence: "monthly",
      notes: null,
      createdAt: "",
      updatedAt: "",
    }
    expect(exceptionData(row as Parameters<typeof exceptionData>[0])).toMatchObject({
      type: "non_working",
      category: "company_holiday",
      recurrence: "one_time",
    })
    expect(
      exceptionData({ ...row, type: "working", category: "weather_day", recurrence: "yearly" } as Parameters<
        typeof exceptionData
      >[0])
    ).toMatchObject({ type: "working", category: "weather_day", recurrence: "yearly" })
  })
})
