import { describe, expect, it } from "vitest"

import {
  budgetFeeCostCode,
  canonicalFeeCostCode,
} from "@/lib/domain/financials/builder-fee-codes"
import type { EstimateLedgerLine } from "@/lib/domain/estimates/rules"
import { buildContractBudget } from "../estimate-ledger"
import {
  g703ByCostCode,
  payApplicationShares,
  priorAmountsForShares,
} from "../pay-application-shares"

function ledgerLine(
  input: Pick<EstimateLedgerLine, "id" | "costCode" | "description" | "lineTotalCents"> &
    Partial<EstimateLedgerLine>
): EstimateLedgerLine {
  return {
    divisionCode: "00",
    divisionName: "Procurement Requirements",
    directCostCents: input.lineTotalCents,
    markupCents: 0,
    taxCents: 0,
    ownerVisible: true,
    includeInBuilderFee: false,
    sortOrder: 1,
    ...input,
  }
}

const revisionLine = {
  divisionCode: "00",
  divisionName: "Procurement Requirements",
  approvedChangeCents: 0,
  ownerVisible: true,
  sortOrder: 1,
}

describe("canonicalFeeCostCode", () => {
  it("gives each builder fee one identity, the Sage catalog name", () => {
    expect(canonicalFeeCostCode("99 10 00")).toBe("Company Overhead")
    expect(canonicalFeeCostCode("company  overhead ")).toBe("Company Overhead")
    expect(canonicalFeeCostCode("99 20 00")).toBe("Company Margin")
    expect(canonicalFeeCostCode("99 30 00")).toBe("Contingency Reserve")
    expect(canonicalFeeCostCode("03 11 13")).toBe("03 11 13")
  })

  it("files a fee adjustment under the budget's own fee line code", () => {
    const lines = [
      { costCode: "03 11 13", description: "Forming" },
      { costCode: "00 72 33.10", description: "Company Overhead" },
    ]
    expect(budgetFeeCostCode(lines, "99 10 00")).toBe("00 72 33.10")
    expect(budgetFeeCostCode(lines, "99 20 00")).toBe("Company Margin")
    expect(budgetFeeCostCode(lines, "03 11 13")).toBe("03 11 13")
  })
})

describe("builder fee lines in the contract budget", () => {
  it("merges a change-order fee adjustment into the fee line's changes", () => {
    const budget = buildContractBudget({
      estimateLines: [
        ledgerLine({ id: "line-a", costCode: "03 11 13", description: "Forming", lineTotalCents: 400_000, divisionCode: "03" }),
        ledgerLine({ id: null, costCode: "Company Overhead", description: "Company Overhead", lineTotalCents: 40_000, sortOrder: 100_000 }),
        ledgerLine({ id: null, costCode: "Company Margin", description: "Company Margin", lineTotalCents: 30_000, sortOrder: 100_001 }),
      ],
      adjustments: [
        { id: "co-line-1", changeOrderId: "co-1", costCode: "99 10 00", description: "Company Overhead", amountCents: -1_500, executedAt: "2026-09-01T10:00:00.000Z" },
        { id: "co-line-2", changeOrderId: "co-1", costCode: "Company Margin", description: "Company Margin", amountCents: -1_000, executedAt: "2026-09-01T10:00:00.000Z" },
      ],
    })

    const overhead = budget.lines.filter((line) => canonicalFeeCostCode(line.costCode) === "Company Overhead")
    expect(overhead).toHaveLength(1)
    expect(overhead[0]).toMatchObject({
      costCode: "Company Overhead",
      originalEstimateCents: 40_000,
      approvedChangeCents: -1_500,
      adjustedBudgetCents: 38_500,
    })
    expect(budget.lines.some((line) => line.costCode === "99 10 00")).toBe(false)
    expect(budget.lines).toHaveLength(3)
    expect(budget.revisedContractSumCents).toBe(467_500)
  })
})

describe("builder fee lines on pay applications", () => {
  const shares = payApplicationShares({
    revisionLines: [
      { ...revisionLine, id: "rev-oh", costCode: "Company Overhead", description: "Company Overhead", originalEstimateCents: 40_000, approvedChangeCents: -1_500, adjustedBudgetCents: 38_500 },
      { ...revisionLine, id: "rev-cr", costCode: "Contingency Reserve", description: "Contingency Reserve", originalEstimateCents: 10_000, adjustedBudgetCents: 10_000, sortOrder: 2 },
    ],
    estimateAllocations: [],
    changeAllocations: [
      { costCode: "Company Overhead", key: "co:1", name: "Change order 1", sort: 500_000, cents: -1_500 },
    ],
  })

  it("carries prior lines coded 99 x0 00 onto the canonical fee shares", () => {
    const priors = priorAmountsForShares(shares, [
      { costCode: "99 10 00", assemblyKey: null, totalCosts: 120, retainageHeld: 12, totalChanges: 0 },
      { costCode: "99 30 00", assemblyKey: null, totalCosts: 25, retainageHeld: 0, totalChanges: 0 },
    ])
    expect(shares.map((share) => [share.costCode, share.assemblyKey])).toEqual([
      ["Company Overhead", "co:1"],
      ["Company Overhead", null],
      ["Contingency Reserve", null],
    ])
    // The negative change share has no scheduled value to bill against.
    expect(priors.map((prior) => prior.previousCents)).toEqual([0, 12_000, 2_500])
    expect(priors.map((prior) => prior.retainageCents)).toEqual([0, 1_200, 0])
  })

  it("adds prior amounts from both spellings of the same fee", () => {
    const priors = priorAmountsForShares(shares, [
      { costCode: "99 10 00", assemblyKey: null, totalCosts: 100, retainageHeld: 0, totalChanges: 0 },
      { costCode: "Company Overhead", assemblyKey: null, totalCosts: 20, retainageHeld: 0, totalChanges: 0 },
    ])
    expect((priors[0]?.previousCents ?? 0) + (priors[1]?.previousCents ?? 0)).toBe(12_000)
  })

  it("sends Sage one G703 line per fee under its canonical name", () => {
    const row = {
      budgetRevisionLineId: null,
      csiDivision: "00",
      description: "Company Overhead",
      originalEstimate: 0,
      totalChanges: 0,
      adjustedEstimate: 0,
      previousWorkCompleted: 0,
      currentWorkCompleted: 0,
      storedMaterials: 0,
      totalCosts: 0,
      retainageHeld: 0,
      balanceToFinish: 0,
    }
    const combined = g703ByCostCode([
      { ...row, costCode: "Company Overhead", originalEstimate: 400 },
      { ...row, costCode: "99 10 00", totalChanges: -15 },
    ])
    expect(combined).toHaveLength(1)
    expect(combined[0]).toMatchObject({ costCode: "Company Overhead", originalEstimate: 400, totalChanges: -15 })
  })
})
