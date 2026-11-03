import { describe, expect, it } from "vitest"

import { budgetLineProgress, retainageAtPercent, retainageAtRate } from "../rules"

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
