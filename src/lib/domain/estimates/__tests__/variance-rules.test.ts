import { describe, expect, it } from "vitest"

import {
  contractInsuranceRate,
  derivedChangeLines,
  nextChangeOrderNumber,
  nextVarianceNumbers,
  reclassificationError,
  varianceNumbersInDateOrder,
  varianceTransitionAllowed,
} from "@/lib/domain/estimates/variance-rules"

const feeRates = { overheadRateBasisPoints: 1_000, marginRateBasisPoints: 500, contingencyRateBasisPoints: 0 }
const insurance = { costCode: "00 73 16", description: "Project Liability Insurance", rate: 0.02 }
const lumber = { costCode: "06 10 00", description: "Lumber", amountCents: 1_000_000, derivedFrom: null }

describe("derivedChangeLines", () => {
  it("adds the builder fee to a variance only on a straight cost-plus contract", () => {
    const costPlus = derivedChangeLines({ recordType: "variance", contractType: "cost_plus", lines: [lumber], feeRates, insurance })
    expect(costPlus.map((line) => [line.derivedFrom, line.costCode, line.amountCents])).toEqual([
      ["builder_fee", "Company Overhead", 100_000],
      ["builder_fee", "Company Margin", 50_000],
      ["insurance", "00 73 16", 23_000],
    ])
    const fixedFee = derivedChangeLines({ recordType: "variance", contractType: "cost_plus_fixed_fee", lines: [lumber], feeRates, insurance })
    expect(fixedFee.map((line) => [line.derivedFrom, line.amountCents])).toEqual([["insurance", 20_000]])
  })

  it("adds no fee to a variance whose lines already include it (selection rounds), only insurance", () => {
    const lines = derivedChangeLines({ recordType: "variance", contractType: "cost_plus", lines: [lumber], feeRates, insurance, feeIncluded: true })
    expect(lines.map((line) => [line.derivedFrom, line.amountCents])).toEqual([["insurance", 20_000]])
  })

  it("adds insurance to a change order too, but never a fee (its estimate priced the fee)", () => {
    const lines = derivedChangeLines({ recordType: "change_order", contractType: "cost_plus", lines: [lumber], feeRates, insurance })
    expect(lines.map((line) => [line.derivedFrom, line.amountCents])).toEqual([["insurance", 20_000]])
  })

  it("adds no insurance when the record already prices it, and recomputes over earlier derived lines", () => {
    const priced = { costCode: "00 73 16", description: "Insurance", amountCents: 5_000, derivedFrom: null }
    expect(derivedChangeLines({ recordType: "change_order", contractType: "cost_plus", lines: [lumber, priced], feeRates, insurance })).toEqual([])
    const stale = { costCode: "00 73 16", description: "Project Liability Insurance", amountCents: 99_999, derivedFrom: "insurance" }
    expect(derivedChangeLines({ recordType: "variance", contractType: "fixed_price", lines: [lumber, stale], feeRates, insurance })).toEqual([
      { costCode: "00 73 16", description: "Project Liability Insurance", amountCents: 20_000, derivedFrom: "insurance" },
    ])
  })

  it("reads the contract's insurance rate from its own insurance line", () => {
    const rate = contractInsuranceRate(
      [
        { costCode: "06 10 00", description: "Rough Carpentry", originalEstimateCents: 9_000_000 },
        { costCode: "Project Liability Insurance", description: "Project Liability Insurance", originalEstimateCents: 180_000 },
        { costCode: "Company Overhead", description: "Company Overhead", originalEstimateCents: 1_000_000 },
      ],
      insurance
    )
    expect(rate).toBeCloseTo(0.018)
    expect(contractInsuranceRate([{ costCode: "06 10 00", description: "Rough Carpentry", originalEstimateCents: 1 }], insurance)).toBeNull()
  })
})

describe("numbering", () => {
  const records = [
    { changeOrderNumber: "O-100-1000-CO-001", formerChangeOrderNumber: null, recordType: "change_order" },
    { changeOrderNumber: "V-001", formerChangeOrderNumber: "O-100-1000-CO-002", recordType: "variance" },
    { changeOrderNumber: "V-002", formerChangeOrderNumber: null, recordType: "variance" },
  ]

  it("numbers change orders past every number used, ignoring variances", () => {
    expect(nextChangeOrderNumber("O-100-1000", records)).toBe("O-100-1000-CO-003")
    expect(nextChangeOrderNumber(null, [])).toBe("PROJECT-CO-001")
  })

  it("numbers variances V-001 and up in date order when reclassifying", () => {
    expect(nextVarianceNumbers(records, 2)).toEqual(["V-003", "V-004"])
    const converted = varianceNumbersInDateOrder(
      [
        { id: "b", executedAt: "2026-09-30T00:00:00Z", createdAt: "2026-09-01" },
        { id: "a", executedAt: null, createdAt: "2026-07-15" },
        { id: "c", executedAt: "2026-08-31T00:00:00Z", createdAt: "2026-08-01" },
      ],
      []
    )
    expect(converted.map(({ record, number }) => [record.id, number])).toEqual([["a", "V-001"], ["c", "V-002"], ["b", "V-003"]])
  })
})

describe("reclassification and transitions", () => {
  const base = { to: "variance" as const, recordType: "change_order", status: "executed", kind: null, budgetTreatment: "additive", number: "CO-004", hasOpenEstimate: false }

  it("keeps rebaselines, no-cost and signature-pending change orders as change orders", () => {
    expect(reclassificationError(base)).toBeNull()
    expect(reclassificationError({ ...base, budgetTreatment: "baseline_replacement" })).toMatch(/replaces the contract estimate/)
    expect(reclassificationError({ ...base, kind: "description" })).toMatch(/no cost/)
    expect(reclassificationError({ ...base, status: "signature_pending" })).toMatch(/out for signature/)
    expect(reclassificationError({ ...base, to: "change_order", recordType: "variance" })).toBeNull()
  })

  it("keeps variances out of the owner acceptance steps", () => {
    expect(varianceTransitionAllowed("variance", "signature_pending")).toBe(false)
    expect(varianceTransitionAllowed("variance", "executed")).toBe(false)
    expect(varianceTransitionAllowed("variance", "void")).toBe(true)
    expect(varianceTransitionAllowed("change_order", "signature_pending")).toBe(true)
  })
})
