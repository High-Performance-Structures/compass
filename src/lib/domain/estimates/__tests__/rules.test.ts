import { describe, expect, it } from "vitest"

import {
  calculateEstimateLine,
  calculateEstimateLineBreakdownRollup,
  calculateEstimateTotals,
  estimateTotalsForLines,
  ledgerLine,
  limitedText,
  planSwiftAmountDollars,
  planSwiftLinePricing,
  planSwiftUnitCostDollars,
  rateBasisPoints,
  repriceAtMarkup,
  repricedBreakdownItem,
  requiredText,
  safeEvidenceUrl,
  safeUrl,
  signerInitials,
  type EstimateLedgerLine,
  type EstimateLedgerSourceLine,
  type PlanSwiftPricingInput,
  type RepriceSource,
} from "@/lib/domain/estimates/rules"

/*
 * Parity tests: each "before" function is the code that computed these
 * numbers before the estimates domain move (main at 03a64bb5), kept here
 * verbatim so the moved rules can be checked against it. If one of these
 * fails, a number users or owners see would change.
 */

// Before: src/app/actions/project-estimates.ts importPlanSwiftEstimateLines.
function planSwiftBefore(line: PlanSwiftPricingInput) {
  const rowNumber = Math.round(line.rowNumber)
  const amountCents = Math.round(line.amount * 100)
  const quantity = line.quantity ?? 1
  const markupRateBasisPoints = Math.round(line.markupPercentage * 100)
  const unitCostCents =
    line.unitCost !== null && line.unitCost > 0
      ? Math.round(line.unitCost * 100)
      : Math.round(amountCents / quantity / (1 + line.markupPercentage / 100))
  const calculation = calculateEstimateLine({
    quantity,
    unitCostCents,
    markupRateBasisPoints,
    taxable: false,
    taxRateBasisPoints: 0,
  })
  return { rowNumber, quantity, unitCostCents, markupRateBasisPoints, ...calculation }
}

// Before: project-estimate-planswift-import-client.tsx changeRow.
function clientAmountBefore(quantity: number, unitCost: number, markup: number): number {
  return Math.round(quantity * unitCost * (1 + markup / 100) * 100) / 100
}
function clientUnitCostBefore(amount: number, quantity: number, markup: number): number {
  return Math.round((amount / quantity / (1 + markup / 100)) * 100) / 100
}

// Before: lib/estimates/phase-proposals.ts estimateTotalsForLines + ledgerLine.
function totalsBefore(
  rates: { overheadRateBasisPoints: number; marginRateBasisPoints: number; contingencyRateBasisPoints: number },
  rows: readonly EstimateLedgerSourceLine[]
) {
  return calculateEstimateTotals(
    rows.map((row): EstimateLedgerLine => ({
      id: row.id,
      divisionCode: row.divisionCode,
      divisionName: row.divisionName,
      costCode: row.costCode,
      description: row.description,
      directCostCents: row.directCostCents,
      markupCents: row.markupCents,
      taxCents: row.taxCents,
      lineTotalCents: row.lineTotalCents,
      ownerVisible: row.ownerVisible,
      includeInBuilderFee: row.includeInBuilderFee,
      sortOrder: row.sortOrder,
    })),
    rates
  )
}

const planSwiftRows: readonly PlanSwiftPricingInput[] = [
  { rowNumber: 2, quantity: 12, unitCost: 48.25, markupPercentage: 0, amount: 579 },
  { rowNumber: 3, quantity: 3.5, unitCost: 129.99, markupPercentage: 12.5, amount: 511.84 },
  { rowNumber: 4, quantity: null, unitCost: null, markupPercentage: 15, amount: 1_150 },
  { rowNumber: 5, quantity: 7, unitCost: null, markupPercentage: 33.333, amount: 2_468.21 },
  { rowNumber: 6.4, quantity: 0.75, unitCost: 0, markupPercentage: 8.25, amount: 81.19 },
  { rowNumber: 7, quantity: 1_200, unitCost: 3.17, markupPercentage: 22, amount: 4_640.88 },
]

function line(input: Partial<EstimateLedgerSourceLine> & { readonly id: string | null; readonly lineTotalCents: number }): EstimateLedgerSourceLine {
  return {
    divisionCode: "03",
    divisionName: "Concrete",
    costCode: "03-300",
    description: "Footings",
    directCostCents: input.lineTotalCents,
    markupCents: 0,
    taxCents: 0,
    ownerVisible: true,
    includeInBuilderFee: true,
    sortOrder: 1,
    ...input,
  }
}

/** A residential contract estimate: taxed, marked-up, owner-scope and fee-excluded lines. */
const contractLines: readonly EstimateLedgerSourceLine[] = [
  line({ id: "a", directCostCents: 1_845_000, markupCents: 276_750, taxCents: 0, lineTotalCents: 2_121_750 }),
  line({ id: "b", divisionCode: "06", costCode: "06-100", directCostCents: 3_912_340, markupCents: 469_481, taxCents: 129_548, lineTotalCents: 4_511_369 }),
  line({ id: "c", divisionCode: "09", costCode: "09-900", directCostCents: 410_099, markupCents: 0, taxCents: 0, lineTotalCents: 410_099, includeInBuilderFee: false }),
  line({ id: "d", divisionCode: "22", costCode: "22-100", directCostCents: 0, markupCents: 0, lineTotalCents: 0 }),
  line({ id: null, divisionCode: "31", costCode: "31-200", directCostCents: 72_333, markupCents: 7_233, taxCents: 2_386, lineTotalCents: 81_952, ownerVisible: false }),
]
const rates = { overheadRateBasisPoints: 1_000, marginRateBasisPoints: 750, contingencyRateBasisPoints: 333 }

describe("estimate totals parity", () => {
  it("keeps every stored total of a representative estimate", () => {
    const before = totalsBefore(rates, contractLines)
    const after = estimateTotalsForLines(rates, contractLines)
    expect(after).toEqual(before)
    // The numbers on the estimate today, written out so a change is visible.
    expect(after).toEqual({
      directCostCents: 6_239_772,
      markupCents: 753_464,
      taxCents: 131_934,
      builderFeeBaseCents: 6_715_071,
      overheadCents: 671_507,
      marginCents: 503_630,
      contingencyCents: 223_612,
      builderFeeCents: 1_398_749,
      estimateTotalCents: 8_523_919,
    })
  })

  it("matches with no builder fee and with no lines", () => {
    const noFee = { overheadRateBasisPoints: 0, marginRateBasisPoints: 0, contingencyRateBasisPoints: 0 }
    expect(estimateTotalsForLines(noFee, contractLines)).toEqual(totalsBefore(noFee, contractLines))
    expect(estimateTotalsForLines(rates, [])).toEqual(totalsBefore(rates, []))
  })

  it("reads only the ledger fields of a saved line", () => {
    const saved = { ...contractLines[1], unitCostCents: 99, quantity: 3 }
    expect(ledgerLine(saved)).not.toHaveProperty("unitCostCents")
    expect(ledgerLine(saved).lineTotalCents).toBe(4_511_369)
  })
})

describe("PlanSwift pricing parity", () => {
  it("prices every row on the server exactly as before", () => {
    for (const row of planSwiftRows) {
      expect(planSwiftLinePricing(row)).toEqual(planSwiftBefore(row))
    }
  })

  it("previews amounts and unit costs in the browser exactly as before", () => {
    for (const row of planSwiftRows) {
      const quantity = row.quantity ?? 1
      const unitCost = row.unitCost ?? 10
      expect(planSwiftAmountDollars(quantity, unitCost, row.markupPercentage)).toBe(
        clientAmountBefore(quantity, unitCost, row.markupPercentage)
      )
      expect(planSwiftUnitCostDollars(row.amount, quantity, row.markupPercentage)).toBe(
        clientUnitCostBefore(row.amount, quantity, row.markupPercentage)
      )
    }
  })

  it("derives the unit cost from the amount before markup", () => {
    const priced = planSwiftLinePricing({ rowNumber: 1, quantity: 2, unitCost: null, markupPercentage: 15, amount: 230 })
    expect(priced.unitCostCents).toBe(10_000)
    expect(priced).toMatchObject({ directCostCents: 20_000, markupCents: 3_000, taxCents: 0, lineTotalCents: 23_000 })
  })

  it("keeps the row validation messages", () => {
    const base = { rowNumber: 9, quantity: 1, unitCost: 1, markupPercentage: 0, amount: 1 }
    expect(() => planSwiftLinePricing({ ...base, rowNumber: 0 })).toThrow("Every imported row must have a valid source row number.")
    expect(() => planSwiftLinePricing({ ...base, amount: 0 })).toThrow("PlanSwift row 9 must have a positive amount.")
    expect(() => planSwiftLinePricing({ ...base, amount: 100_000_001 })).toThrow("PlanSwift row 9 exceeds the import amount limit.")
    expect(() => planSwiftLinePricing({ ...base, quantity: -1 })).toThrow("PlanSwift row 9 must have a positive quantity.")
    expect(() => planSwiftLinePricing({ ...base, markupPercentage: -5 })).toThrow("PlanSwift row 9 has an invalid markup.")
    expect(() => planSwiftLinePricing({ ...base, unitCost: null, amount: 0.004 })).toThrow("PlanSwift row 9 must have a positive amount.")
  })
})

describe("applying one markup rate", () => {
  const items: readonly (RepriceSource & { readonly estimateLineId: string })[] = [
    { id: "i1", estimateLineId: "l1", quantity: 4, unitCostCents: 12_345, taxable: true, taxEntityId: "t", taxCode: "CO", taxName: "Colorado", taxRateBasisPoints: 290 },
    { id: "i2", estimateLineId: "l1", quantity: 1.5, unitCostCents: 80_001, taxable: false, taxEntityId: null, taxCode: null, taxName: null, taxRateBasisPoints: 0 },
    { id: "i3", estimateLineId: "l1", quantity: 10, unitCostCents: 999, taxable: true, taxEntityId: "t", taxCode: "CO", taxName: "Colorado", taxRateBasisPoints: 290 },
  ]

  it("reprices like the old per-row SQL and rolls up like re-reading the saved items", () => {
    const markup = 1_850
    for (const item of items) {
      const repriced = repriceAtMarkup(item, markup)
      expect(repriced).toEqual({
        id: item.id,
        markupRateBasisPoints: markup,
        ...calculateEstimateLine({ quantity: item.quantity, unitCostCents: item.unitCostCents, markupRateBasisPoints: markup, taxable: item.taxable, taxRateBasisPoints: item.taxRateBasisPoints }),
      })
    }
    // Before: the line re-read its items after the UPDATE, so each item held
    // the repriced amounts with its own tax settings.
    const savedAfterUpdate = items.map((item) => {
      const calculation = calculateEstimateLine({ quantity: item.quantity, unitCostCents: item.unitCostCents, markupRateBasisPoints: markup, taxable: item.taxable, taxRateBasisPoints: item.taxRateBasisPoints })
      return {
        directCostCents: calculation.directCostCents,
        markupRateBasisPoints: markup,
        markupCents: calculation.markupCents,
        taxable: item.taxable,
        taxEntityId: item.taxEntityId,
        taxCode: item.taxCode,
        taxName: item.taxName,
        taxRateBasisPoints: item.taxRateBasisPoints,
        taxCents: calculation.taxCents,
        lineTotalCents: calculation.lineTotalCents,
      }
    })
    const after = items.map((item) => repricedBreakdownItem(item, repriceAtMarkup(item, markup)))
    expect(after).toEqual(savedAfterUpdate)
    expect(calculateEstimateLineBreakdownRollup(after)).toEqual(calculateEstimateLineBreakdownRollup(savedAfterUpdate))
  })
})

describe("estimate input rules", () => {
  it("reads percentages as basis points within 0% to 10,000%", () => {
    expect(rateBasisPoints(12.5, "Markup")).toBe(1_250)
    expect(rateBasisPoints(null, "Markup")).toBe(0)
    expect(rateBasisPoints(10_000, "Markup")).toBe(1_000_000)
    expect(() => rateBasisPoints(-1, "Overhead")).toThrow("Overhead must be between 0% and 10,000%.")
    expect(() => rateBasisPoints(Number.NaN, "Margin")).toThrow("Margin must be between 0% and 10,000%.")
  })

  it("requires and limits text with the same messages", () => {
    expect(requiredText("  Kitchen  ", "Title")).toBe("Kitchen")
    expect(() => requiredText("  ", "Title")).toThrow("Title is required.")
    expect(limitedText(null, "Note", 5)).toBeNull()
    expect(() => limitedText(null, "Note", 5, true)).toThrow("Note is required.")
    expect(() => limitedText("too long", "Note", 5)).toThrow("Note must be 5 characters or fewer.")
  })

  it("keeps only web links, and only https for signed evidence", () => {
    expect(safeUrl("https://drive.google.com/file/d/1")).toBe("https://drive.google.com/file/d/1")
    expect(safeUrl("javascript:alert(1)")).toBeNull()
    expect(safeUrl("not a url")).toBeNull()
    expect(safeEvidenceUrl("http://example.com/signed.pdf")).toBeNull()
    expect(safeEvidenceUrl("https://example.com/signed.pdf")).toBe("https://example.com/signed.pdf")
  })

  it("makes signer initials from a name", () => {
    expect(signerInitials("Ana  María de la Cruz")).toBe("AMDLC")
    expect(signerInitials("one two three four five six seven")).toBe("OTTFFS")
  })
})
