import { describe, expect, it } from "vitest"

import { fullyBilledWorkOnRevision, lineAmountsOnRevision } from "../owner-pay-application-refresh"

describe("lineAmountsOnRevision", () => {
  it("adds an executed change order to a draft line as a current change", () => {
    expect(
      lineAmountsOnRevision(
        { totalChanges: 0, currentChanges: 0, totalCosts: 0, retainageHeld: 0 },
        { originalEstimateCents: 1_649_863, approvedChangeCents: 170_000, adjustedBudgetCents: 1_819_863 }
      )
    ).toEqual({
      originalEstimate: 16_498.63,
      priorChanges: 0,
      currentChanges: 1_700,
      totalChanges: 1_700,
      adjustedEstimate: 18_198.63,
      percentComplete: 0,
      balanceToFinish: 18_198.63,
      retainageHeld: 0,
    })
  })

  it("keeps work entered and the line's retainage rate", () => {
    const amounts = lineAmountsOnRevision(
      { totalChanges: 500, currentChanges: 0, totalCosts: 4_000, retainageHeld: 400 },
      { originalEstimateCents: 1_000_000, approvedChangeCents: 150_000, adjustedBudgetCents: 1_150_000 }
    )
    expect(amounts.priorChanges).toBe(500)
    expect(amounts.currentChanges).toBe(1_000)
    expect(amounts.balanceToFinish).toBe(7_500)
    expect(amounts.retainageHeld).toBe(400)
    expect(amounts.percentComplete).toBe(34.8)
  })
})

describe("fullyBilledWorkOnRevision", () => {
  const fullyBilled = { adjustedEstimate: 10_000, previousWorkCompleted: 0, storedMaterials: 0, totalCosts: 10_000, retainageHeld: 500 }

  it("keeps a fully billed line fully billed when a credit lowers its value", () => {
    expect(fullyBilledWorkOnRevision(fullyBilled, 800_000)).toEqual({
      currentWorkCompleted: 8_000,
      currentCosts: 8_000,
      totalCosts: 8_000,
      percentComplete: 100,
      balanceToFinish: 0,
      retainageHeld: 400,
    })
  })

  it("bills an added charge on a fully billed line this period", () => {
    const amounts = fullyBilledWorkOnRevision({ ...fullyBilled, previousWorkCompleted: 6_000, storedMaterials: 1_000 }, 1_250_000)
    expect(amounts?.currentWorkCompleted).toBe(5_500)
    expect(amounts?.currentCosts).toBe(6_500)
    expect(amounts?.totalCosts).toBe(12_500)
  })

  it("leaves partly billed and unchanged lines alone", () => {
    expect(fullyBilledWorkOnRevision({ ...fullyBilled, totalCosts: 5_000 }, 1_200_000)).toBeNull()
    expect(fullyBilledWorkOnRevision(fullyBilled, 1_000_000)).toBeNull()
  })

  it("never takes this period's work below zero", () => {
    expect(fullyBilledWorkOnRevision({ ...fullyBilled, previousWorkCompleted: 10_000 }, 800_000)).toBeNull()
  })
})
