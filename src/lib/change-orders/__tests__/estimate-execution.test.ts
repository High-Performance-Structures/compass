import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/financials/contract-budget-store", () => ({ estimateBudgetLedgerLines: vi.fn() }))

import { changeOrderLinesFromEstimate } from "@/lib/change-orders/estimate-execution"

function line(costCode: string, lineTotalCents: number, description = `Line ${costCode}`) {
  return {
    id: crypto.randomUUID(),
    divisionCode: costCode.slice(0, 2),
    divisionName: "Division",
    costCode,
    description,
    directCostCents: Math.round(lineTotalCents / 1.26),
    markupCents: lineTotalCents - Math.round(lineTotalCents / 1.26),
    taxCents: 0,
    lineTotalCents,
    ownerVisible: true,
    includeInBuilderFee: true,
    sortOrder: 1,
  }
}

describe("changeOrderLinesFromEstimate", () => {
  it("groups estimate lines by cost code at the client price, in cost-code order", () => {
    const lines = changeOrderLinesFromEstimate([
      line("07 10 00", 120_000, "Waterproofing materials"),
      line("01 71 13", 25_000, "Mobilization"),
      line("07 10 00", 50_000, "Waterproofing labor"),
    ])
    expect(lines).toEqual([
      { lineNumber: 1, costCode: "01 71 13", description: "Mobilization", phaseCode: "01", amountCents: 25_000 },
      { lineNumber: 2, costCode: "07 10 00", description: "Waterproofing materials", phaseCode: "07", amountCents: 170_000 },
    ])
  })

  it("keeps credits (negative lines) and drops zero lines", () => {
    const lines = changeOrderLinesFromEstimate([line("03 31 00", -40_000, "Credit: fewer piers"), line("03 21 00", 0)])
    expect(lines).toEqual([{ lineNumber: 1, costCode: "03 31 00", description: "Credit: fewer piers", phaseCode: "03", amountCents: -40_000 }])
  })
})
