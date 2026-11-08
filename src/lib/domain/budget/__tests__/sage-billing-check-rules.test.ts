import { describe, expect, it } from "vitest"

import {
  checkSageBilling,
  isPostedSageStatus,
  planEnterInSage,
  sageBillingCheckFingerprint,
  sageBillingCheckSummary,
  type EnterInSageInput,
  type PostedSageInvoice,
  type TaxShare,
} from "@/lib/domain/budget/sage-billing-check-rules"

// Invented job, cost codes and amounts.
const DISTRICT = { code: "990001", name: "99-0001 Example County Combined", rateBasisPoints: 815 }

function input(overrides: Partial<EnterInSageInput> = {}): EnterInSageInput {
  return {
    invoiceNumber: { value: "X-100-200-PR09", error: null },
    billingDate: "2026-10-31",
    periodTo: "2026-10-31",
    description: "October 2026 Pay Request",
    billingCycle: "1MO",
    lines: [
      { key: "a", costCode: "06 10 00", description: "Rough Carpentry", thisPeriodCents: 100_000, sageTaxable: true },
      { key: "b", costCode: "01 50 00", description: "Temporary Facilities", thisPeriodCents: 20_000, sageTaxable: false },
      { key: "c", costCode: "08 10 00", description: "Doors", thisPeriodCents: 40_000, sageTaxable: false },
    ],
    changeOrders: [],
    contractTax: new Map<string, TaxShare>([
      ["06 10 00", { totalCents: 500_000, taxableCents: 500_000 }],
      ["01 50 00", { totalCents: 100_000, taxableCents: 0 }],
      ["08 10 00", { totalCents: 200_000, taxableCents: 50_000 }],
    ]),
    changeOrderTax: new Map(),
    taxDistrict: DISTRICT,
    retentionCents: 8_000,
    amountDueCents: 152_000,
    ...overrides,
  }
}

function invoice(overrides: Partial<PostedSageInvoice> = {}): PostedSageInvoice {
  return { invoiceNumber: "X-100-200-PR09", taxDistrictCode: "990001", taxDistrictName: DISTRICT.name, salesTaxCents: 0, retentionCents: 0, totalCents: 0, ...overrides }
}

describe("planEnterInSage", () => {
  it("marks taxable, non-taxable and split lines and totals the expected tax", () => {
    const checklist = planEnterInSage(input())
    expect(checklist.lines.map((line) => [line.key, line.expected, line.taxableCents, line.flagDiffers])).toEqual([
      ["a", "taxable", 100_000, false],
      ["b", "not_taxable", 0, false],
      // A quarter of Doors is taxable: it needs a split until Sage has two lines.
      ["c", "split", 10_000, true],
    ])
    // 8.15% of $1,000 + 8.15% of $100, per line.
    expect(checklist.totals.expectedTaxCents).toBe(8_150 + 815)
    expect(checklist.totals.expectedInvoiceTotalCents).toBe(152_000 + 8_965)
    expect(checklist.totals.thisPeriodCents).toBe(160_000)
    expect(checklist.warnings.join(" ")).toContain("Split into a taxable and a non-taxable line: Doors.")
  })

  it("counts a cost code Sage already split as done", () => {
    const checklist = planEnterInSage(
      input({
        lines: [
          { key: "c1", costCode: "08 10 00", description: "Doors", thisPeriodCents: 10_000, sageTaxable: true },
          { key: "c2", costCode: "08 10 00", description: "Doors", thisPeriodCents: 30_000, sageTaxable: false },
        ],
      })
    )
    expect(checklist.lines.every((line) => !line.flagDiffers)).toBe(true)
  })

  it("places change orders on their own lines and appends a cost code the billing lacks", () => {
    const checklist = planEnterInSage(
      input({
        lines: [
          { key: "a", costCode: "06 10 00", description: "Rough Carpentry", thisPeriodCents: 100_000, sageTaxable: true },
          { key: "a2", costCode: "06 10 00", description: "Rough Carpentry + CO #3", thisPeriodCents: 5_000, sageTaxable: false },
        ],
        changeOrders: [
          { changeOrderId: "co-3", recordType: "change_order", number: "3", costCode: "06 10 00", amountCents: 10_000 },
          { changeOrderId: "co-4", recordType: "change_order", number: "4", costCode: "06 10 00", amountCents: 7_500 },
          { changeOrderId: "v-6", recordType: "variance", number: "006", costCode: "09 90 00", amountCents: 2_000 },
        ],
        changeOrderTax: new Map([["co-3", new Map([["06 10 00", { totalCents: 10_000, taxableCents: 0 }]])]]),
      })
    )
    expect(checklist.changeOrders.map((part) => [part.label, part.placement, part.taxability])).toEqual([
      ["CO #3", "on_billing", "not_taxable"],
      ["CO #4", "add_line", "not_taxable"],
      ["V-006", "append_new_line", "not_taxable"],
    ])
    // The CO #3 line follows the change order's (non-taxable) estimate, not the base contract.
    expect(checklist.lines.find((line) => line.key === "a2")?.expected).toBe("not_taxable")
  })

  it("warns when taxable work has no tax district", () => {
    const checklist = planEnterInSage(input({ taxDistrict: null }))
    expect(checklist.totals.expectedTaxCents).toBe(0)
    expect(checklist.warnings.join(" ")).toContain("no Sage tax district")
  })
})

describe("checkSageBilling", () => {
  const split = planEnterInSage(
    input({
      lines: [
        { key: "a", costCode: "06 10 00", description: "Rough Carpentry", thisPeriodCents: 100_000, sageTaxable: true },
        { key: "b", costCode: "01 50 00", description: "Temporary Facilities", thisPeriodCents: 60_000, sageTaxable: false },
      ],
    })
  )

  it("is not posted while Sage's billing is open or submitted", () => {
    expect(isPostedSageStatus("2")).toBe(false)
    expect(isPostedSageStatus("4")).toBe(true)
    expect(checkSageBilling({ checklist: split, sageStatus: "2", invoice: null, taxToleranceCentsPerLine: 1 })).toEqual({ status: "not_posted", findings: [] })
  })

  it("can't check a posted billing until the bridge reads invoices", () => {
    expect(checkSageBilling({ checklist: split, sageStatus: "3", invoice: undefined, taxToleranceCentsPerLine: 1 }).status).toBe("unavailable")
  })

  it("matches when number, district, tax and total agree", () => {
    const result = checkSageBilling({
      checklist: split,
      sageStatus: "3",
      invoice: invoice({ salesTaxCents: 8_151, totalCents: 152_000 + 8_151 }),
      taxToleranceCentsPerLine: 1,
    })
    expect(result).toEqual({ status: "matches", findings: [] })
  })

  it("accepts an invoice total that includes retention held back", () => {
    const result = checkSageBilling({
      checklist: split,
      sageStatus: "3",
      invoice: invoice({ salesTaxCents: 8_150, retentionCents: 8_000, totalCents: 152_000 + 8_150 + 8_000 }),
      taxToleranceCentsPerLine: 1,
    })
    expect(result.status).toBe("matches")
  })

  it("names each problem", () => {
    const flagged = planEnterInSage(
      input({
        lines: [
          { key: "a", costCode: "06 10 00", description: "Rough Carpentry", thisPeriodCents: 100_000, sageTaxable: false },
          { key: "b", costCode: "01 50 00", description: "Temporary Facilities", thisPeriodCents: 60_000, sageTaxable: false },
        ],
      })
    )
    const result = checkSageBilling({
      checklist: flagged,
      sageStatus: "3",
      invoice: invoice({ invoiceNumber: "PR9", taxDistrictCode: "40206", taxDistrictName: "Other District", salesTaxCents: 0, totalCents: 150_000 }),
      taxToleranceCentsPerLine: 1,
    })
    expect(result.status).toBe("needs_attention")
    expect(result.findings.map((finding) => finding.key)).toEqual(["invoice_number", "taxable:a", "district", "sales_tax", "total"])
    expect(result.findings[0]?.message).toContain("expected X-100-200-PR09, Sage has PR9")
    expect(result.findings[1]?.message).toContain("Rough Carpentry is taxable in the estimate, but Sage marked it not taxable")
    expect(sageBillingCheckSummary(result, "9")).toContain("needs attention")
    expect(sageBillingCheckFingerprint(result)).not.toBe(sageBillingCheckFingerprint({ status: "matches", findings: [] }))
  })

  it("flags a posted billing whose invoice Compass can't find", () => {
    const result = checkSageBilling({ checklist: split, sageStatus: "3", invoice: null, taxToleranceCentsPerLine: 1 })
    expect(result.findings.map((finding) => finding.key)).toEqual(["invoice_missing"])
  })

  it("flags a missing district on a job with taxable lines", () => {
    const result = checkSageBilling({
      checklist: split,
      sageStatus: "3",
      invoice: invoice({ taxDistrictCode: null, salesTaxCents: 8_150, totalCents: 160_150 }),
      taxToleranceCentsPerLine: 1,
    })
    expect(result.findings.map((finding) => finding.key)).toEqual(["district_missing"])
  })
})
