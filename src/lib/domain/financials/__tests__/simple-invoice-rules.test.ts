import { describe, expect, it } from "vitest"

import {
  defaultSimpleInvoiceKind,
  effectivePriceMode,
  estimateLineRemaining,
  invoiceTotals,
  normalizeInvoiceLines,
  overEstimateWarnings,
  planSimpleInvoiceForSage,
  simpleInvoiceActions,
  squareEligibility,
  type EstimateLineBilling,
  type InvoiceLineInput,
} from "@/lib/domain/financials/simple-invoice-rules"

const line = (overrides: Partial<InvoiceLineInput> = {}): InvoiceLineInput => ({
  source: "added",
  estimateLineId: null,
  nutechProductId: null,
  costCode: "03 11 19",
  description: "Form blocks",
  quantity: 2,
  unit: "EA",
  unitPriceCents: 1_050,
  taxable: true,
  ...overrides,
})

function normalized(lines: readonly InvoiceLineInput[]) {
  const result = normalizeInvoiceLines(lines)
  if (!result.ok) throw new Error(result.error)
  return result.lines
}

describe("simple invoice totals", () => {
  it("taxes only the taxable lines, rounding on the taxable total as Sage does", () => {
    const lines = normalized([line(), line({ description: "Shipping", quantity: 1, unitPriceCents: 25_000, taxable: false })])
    expect(invoiceTotals(lines, 790)).toEqual({ subtotalCents: 27_100, taxableCents: 2_100, taxCents: 166, totalCents: 27_266 })
  })

  it("refuses a line without a cost code or description", () => {
    expect(normalizeInvoiceLines([line({ costCode: " " })])).toMatchObject({ ok: false })
    expect(normalizeInvoiceLines([line({ description: "" })])).toMatchObject({ ok: false })
  })
})

describe("invoicing an estimate in part", () => {
  const billing: EstimateLineBilling = { estimateLineId: "el-1", quantity: 10, sellCents: 10_000, invoicedQuantity: 4, invoicedCents: 4_000 }

  it("defaults to what's left", () => {
    expect(estimateLineRemaining(billing)).toEqual({ quantity: 6, cents: 6_000 })
  })

  it("warns when an estimate line goes over, but never for lines added on the invoice", () => {
    const map = new Map([[billing.estimateLineId, billing]])
    const over = normalized([line({ source: "estimate", estimateLineId: "el-1", quantity: 7, unitPriceCents: 1_000 })])
    expect(overEstimateWarnings(over, map)).toHaveLength(1)
    const within = normalized([
      line({ source: "estimate", estimateLineId: "el-1", quantity: 6, unitPriceCents: 1_000 }),
      line({ source: "added", quantity: 500, unitPriceCents: 1_000 }),
    ])
    expect(overEstimateWarnings(within, map)).toEqual([])
  })
})

describe("Square rules", () => {
  it("blocks deposits for the configured departments", () => {
    expect(squareEligibility({ isDeposit: true, department: "H", blockedDepositDepartments: ["H", "O"] }).allowed).toBe(false)
    expect(squareEligibility({ isDeposit: true, department: "N", blockedDepositDepartments: ["H", "O"] }).allowed).toBe(true)
    expect(squareEligibility({ isDeposit: false, department: "O", blockedDepositDepartments: ["H", "O"] }).allowed).toBe(true)
  })

  it("prices Square invoices at the regular price", () => {
    expect(effectivePriceMode({ squareRequested: true, priceMode: "cash_discount" })).toBe("standard")
    expect(effectivePriceMode({ squareRequested: false, priceMode: "cash_discount" })).toBe("cash_discount")
  })
})

describe("numbering and actions", () => {
  it("numbers material sale departments as material sales", () => {
    expect(defaultSimpleInvoiceKind("N", ["N"])).toBe("nutech_sale")
    expect(defaultSimpleInvoiceKind("H", ["N"])).toBe("other")
  })

  it("only deletes drafts; anything that went out is voided", () => {
    expect(simpleInvoiceActions({ status: "draft", emailed: false, sageExportLive: false, squarePublished: false, hasPayments: false }))
      .toMatchObject({ canDelete: true, canEdit: true, canVoid: false })
    expect(simpleInvoiceActions({ status: "open", emailed: true, sageExportLive: false, squarePublished: false, hasPayments: false }))
      .toMatchObject({ canDelete: false, canReopen: false, canVoid: true })
    expect(simpleInvoiceActions({ status: "open", emailed: false, sageExportLive: false, squarePublished: false, hasPayments: false }))
      .toMatchObject({ canReopen: true })
  })
})

describe("simple invoice as a Sage AR invoice", () => {
  const mapped = (code: string) => ({ status: "mapped" as const, by: "csi_prefix" as const, sageRecordNumber: code === "03 11 19" ? "31119" : "1000", sageName: "Mapped" })

  it("sends each line with its cost code record, taxable flag and the district", () => {
    const plan = planSimpleInvoiceForSage({
      invoiceNumber: "N-1-2-S01",
      invoiceDate: "2026-11-07",
      dueDays: 30,
      title: "Block order",
      lines: normalized([line(), line({ description: "Shipping", quantity: 1, unitPriceCents: 25_000, taxable: false, costCode: "01 55 00" })]),
      taxDistrict: { sageRecordNumber: "40017", name: "Example County", rateBasisPoints: 790 },
      taxDistrictUnmapped: false,
      incomeAccount: 4000,
      sageJobNumber: "123",
      mapCostCode: mapped,
    })
    expect(plan.blockers).toEqual([])
    expect(plan.dueDate).toBe("2026-12-07")
    expect(plan.lines.map((planned) => [planned.sageCostCodeRecord, planned.taxable, planned.amountCents])).toEqual([
      ["31119", true, 2_100],
      ["1000", false, 25_000],
    ])
    expect(plan.lines[0]?.description).toBe("Form blocks (2 EA @ $10.50)")
    expect(plan.expectedSalesTaxCents).toBe(166)
    expect(plan.netDueCents).toBe(27_266)
  })

  it("stops when taxable lines have no district or the job isn't in Sage", () => {
    const plan = planSimpleInvoiceForSage({
      invoiceNumber: "N-1-2-S01",
      invoiceDate: "2026-11-07",
      dueDays: 30,
      title: "",
      lines: normalized([line()]),
      taxDistrict: null,
      taxDistrictUnmapped: false,
      incomeAccount: null,
      sageJobNumber: null,
      mapCostCode: mapped,
    })
    expect(plan.blockers.join(" ")).toMatch(/Sage job/)
    expect(plan.blockers.join(" ")).toMatch(/tax district/)
    expect(plan.blockers.join(" ")).toMatch(/income account/)
    expect(plan.description).toBe("Invoice N-1-2-S01")
  })
})
