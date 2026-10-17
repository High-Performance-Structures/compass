import { describe, expect, it } from "vitest"

import { draftSplitIsStale } from "../owner-pay-application-refresh"
import {
  distributeCents,
  g703ByCostCode,
  payApplicationShares,
  priorAmountsForShares,
} from "../pay-application-shares"

const mobilization = {
  id: "rev-line-1",
  costCode: "01 71 13",
  divisionCode: "01",
  divisionName: "General Requirements",
  description: "Mobilization",
  originalEstimateCents: 1_000_000,
  approvedChangeCents: 0,
  adjustedBudgetCents: 1_000_000,
  ownerVisible: true,
  sortOrder: 1,
}

const waterproofing = {
  ...mobilization,
  id: "rev-line-2",
  costCode: "07 10 00",
  divisionCode: "07",
  description: "Waterproofing",
  originalEstimateCents: 500_000,
  approvedChangeCents: 170_000,
  adjustedBudgetCents: 670_000,
}

describe("payApplicationShares", () => {
  const shares = payApplicationShares({
    revisionLines: [mobilization, waterproofing],
    estimateAllocations: [
      { costCode: "01 71 13", key: "asm:footer", name: "Footer", sort: 1, cents: 250_000 },
      { costCode: "01 71 13", key: "asm:icf", name: "ICF Walls", sort: 2, cents: 700_000 },
      { costCode: "07 10 00", key: "asm:wp", name: "Waterproofing", sort: 3, cents: 500_000 },
    ],
    changeAllocations: [{ costCode: "07 10 00", key: "co:1", name: "Change order CO-001", sort: 500_000, cents: 170_000 }],
  })

  it("splits each cost code by assembly and change order, keeping the cost code total", () => {
    expect(shares.map((share) => [share.costCode, share.assemblyKey, share.adjustedBudgetCents])).toEqual([
      ["01 71 13", "asm:footer", 250_000],
      ["01 71 13", "asm:icf", 700_000],
      ["01 71 13", null, 50_000],
      ["07 10 00", "asm:wp", 500_000],
      ["07 10 00", "co:1", 170_000],
    ])
  })

  it("leaves a cost code with no assemblies as one row without an assembly", () => {
    const plain = payApplicationShares({ revisionLines: [mobilization], estimateAllocations: [], changeAllocations: [] })
    expect(plain).toHaveLength(1)
    expect(plain[0]?.assemblyKey).toBeNull()
    expect(plain[0]?.assemblyName).toBeNull()
    expect(plain[0]?.adjustedBudgetCents).toBe(1_000_000)
  })

  it("carries prior billing per share, and spreads a cost code billed before it was split", () => {
    const priors = priorAmountsForShares(shares, [
      { costCode: "01 71 13", assemblyKey: null, totalCosts: 2_000, retainageHeld: 200, totalChanges: 0 },
      { costCode: "07 10 00", assemblyKey: "asm:wp", totalCosts: 1_000, retainageHeld: 0, totalChanges: 0 },
    ])
    expect(priors.map((prior) => prior.previousCents)).toEqual([50_000, 140_000, 10_000, 100_000, 0])
    expect(priors.slice(0, 3).reduce((sum, prior) => sum + prior.retainageCents, 0)).toBe(20_000)
  })

  it("knows when a draft's rows no longer match the split", () => {
    const rows = shares.map((share) => ({
      costCode: share.costCode,
      assemblyKey: share.assemblyKey,
      adjustedEstimate: share.adjustedBudgetCents / 100,
    }))
    expect(draftSplitIsStale(rows, shares)).toBe(false)
    expect(draftSplitIsStale([{ costCode: "01 71 13", assemblyKey: null, adjustedEstimate: 10_000 }], shares)).toBe(true)
  })
})

describe("distributeCents", () => {
  it("splits in proportion and always adds back to the total", () => {
    const parts = distributeCents(100, [1, 1, 1])
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(100)
    expect(distributeCents(1_000, [0, 0])).toEqual([1_000, 0])
  })
})

describe("g703ByCostCode", () => {
  it("combines assembly rows into one Sage line per cost code", () => {
    const row = {
      budgetRevisionLineId: "rev-line-1",
      csiDivision: "01",
      costCode: "01 71 13",
      description: "Mobilization",
      originalEstimate: 2_500,
      totalChanges: 0,
      adjustedEstimate: 2_500,
      previousWorkCompleted: 0,
      currentWorkCompleted: 1_000.1,
      storedMaterials: 0,
      totalCosts: 1_000.1,
      retainageHeld: 0,
      balanceToFinish: 1_499.9,
    }
    const combined = g703ByCostCode([row, { ...row, adjustedEstimate: 7_000, currentWorkCompleted: 0.2, totalCosts: 0.2 }])
    expect(combined).toHaveLength(1)
    expect(combined[0]?.adjustedEstimate).toBe(9_500)
    expect(combined[0]?.currentWorkCompleted).toBe(1_000.3)
  })
})
