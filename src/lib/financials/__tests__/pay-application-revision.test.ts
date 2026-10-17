import { describe, expect, it } from "vitest"

import { lineAmountsOnRevision } from "../owner-pay-application-refresh"

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
