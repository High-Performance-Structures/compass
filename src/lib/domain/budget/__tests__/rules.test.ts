import { describe, expect, it } from "vitest"

import { budgetLineProgress, payApplicationLineEntry, retainageAtPercent, retainageAtRate } from "../rules"

describe("budgetLineProgress", () => {
  it("totals prior, current and stored work against the adjusted budget", () => {
    expect(
      budgetLineProgress({
        previousWorkCompleted: 1_000,
        currentWorkCompleted: 500,
        storedMaterials: 250,
        adjustedEstimate: 4_000,
      })
    ).toEqual({
      priorCosts: 1_000,
      currentCosts: 750,
      totalCosts: 1_750,
      percentComplete: 43.8,
      balanceToFinish: 2_250,
    })
  })

  it("reports 0% when the line has no budget", () => {
    const progress = budgetLineProgress({
      previousWorkCompleted: 0,
      currentWorkCompleted: 100,
      storedMaterials: 0,
      adjustedEstimate: 0,
    })
    expect(progress.percentComplete).toBe(0)
    expect(progress.balanceToFinish).toBe(-100)
  })

  it("matches the previous inline formula", () => {
    const line = { previousWorkCompleted: 333.33, currentWorkCompleted: 123.45, storedMaterials: 10.01, adjustedEstimate: 1_234.56 }
    const total = line.previousWorkCompleted + line.currentWorkCompleted + line.storedMaterials
    expect(budgetLineProgress(line).percentComplete).toBe(Math.round((total / line.adjustedEstimate) * 1_000) / 10)
    expect(budgetLineProgress(line).totalCosts).toBe(total)
  })
})

describe("retainage", () => {
  it("holds a percent of completed work to the cent", () => {
    expect(retainageAtPercent(1_750, 10)).toBe(175)
    expect(retainageAtPercent(1_234.56, 5)).toBe(61.73)
  })

  it("keeps a line's existing rate to the cent", () => {
    expect(retainageAtRate(2_000, 0.1)).toBe(200)
    expect(retainageAtRate(1_234.56, 0.05)).toBe(61.73)
    expect(retainageAtRate(500, 0)).toBe(0)
  })
})

describe("payApplicationLineEntry", () => {
  const line = { previousWorkCompleted: 4_000, adjustedEstimate: 9_000 }
  const entry = (
    currentWorkCompleted: number | null,
    storedMaterials: number | null = 0,
    retainagePercent: number | null = 10
  ): ReturnType<typeof payApplicationLineEntry> =>
    payApplicationLineEntry({ ...line, currentWorkCompleted, storedMaterials, retainagePercent })

  it("accepts a negative current amount that credits back earlier billing", () => {
    expect(entry(-1_500)).toEqual({
      success: true,
      entry: { currentWorkCompleted: -1_500, storedMaterials: 0, retainagePercent: 10, totalCompletedStored: 2_500 },
    })
  })

  it("allows crediting the line all the way back to zero", () => {
    expect(
      payApplicationLineEntry({ ...line, previousWorkCompleted: 0.3, currentWorkCompleted: -0.3, storedMaterials: 0, retainagePercent: 0 })
    ).toEqual({
      success: true,
      entry: { currentWorkCompleted: -0.3, storedMaterials: 0, retainagePercent: 0, totalCompletedStored: 0 },
    })
  })

  it("counts stored materials toward the floor", () => {
    expect(entry(-4_500, 600).success).toBe(true)
    expect(entry(-4_500, 400).success).toBe(false)
  })

  it("rejects a credit that takes completed and stored to date below zero", () => {
    const result = entry(-4_000.01)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/cannot go below zero/)
  })

  it("keeps stored materials and retainage non-negative", () => {
    expect(entry(100, -1)).toEqual({ success: false, error: "Stored materials must be zero or greater." })
    expect(entry(100, 0, -5)).toEqual({ success: false, error: "Retainage must be zero or greater." })
    expect(entry(100, 0, 101)).toEqual({ success: false, error: "Retainage cannot exceed 100%." })
  })

  it("rejects a current amount that is not a number", () => {
    expect(entry(null)).toEqual({ success: false, error: "Current work must be a dollar amount." })
    expect(entry(Number.NaN).success).toBe(false)
  })

  it("still caps the total at the adjusted scheduled value", () => {
    expect(entry(5_000).success).toBe(true)
    expect(entry(5_000.02).success).toBe(false)
  })

  it("rounds to the cent", () => {
    expect(entry(-12.346)).toMatchObject({ success: true, entry: { currentWorkCompleted: -12.35, totalCompletedStored: 3_987.65 } })
  })

  it("feeds line progress and retainage that reflect the credit", () => {
    const result = entry(-1_500)
    if (!result.success) throw new Error(result.error)
    expect(budgetLineProgress({ ...line, ...result.entry })).toEqual({
      priorCosts: 4_000,
      currentCosts: -1_500,
      totalCosts: 2_500,
      percentComplete: 27.8,
      balanceToFinish: 6_500,
    })
    expect(retainageAtPercent(result.entry.totalCompletedStored, result.entry.retainagePercent)).toBe(250)
  })
})
