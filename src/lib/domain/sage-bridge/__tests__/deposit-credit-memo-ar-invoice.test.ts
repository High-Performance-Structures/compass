import { describe, expect, it } from "vitest"

import { normalizeInvoiceLines, planSimpleInvoiceForSage, type InvoiceLineInput } from "@/lib/domain/financials/simple-invoice-rules"
import { planDepositForSage } from "@/lib/domain/sage-bridge/deposit-ar-invoice-rules"
import { DEFAULT_SAGE_EXPORT_SETTINGS } from "@/lib/feature-settings/contract-settings"
import { formatSageInvoiceNumber, simpleInvoiceNumberFormat } from "@/lib/financials/sage-invoice-number"
import { depositRequestNumber } from "@/lib/deposits/deposit-requests"
import { sageArInvoiceWritePayload } from "@/lib/sage/ar-invoice-write"

const PROJECT = { projectNumber: "O-100-1", sageJobNumber: "1001" }

describe("deposit request as a Sage AR invoice", () => {
  const number = formatSageInvoiceNumber(DEFAULT_SAGE_EXPORT_SETTINGS.depositInvoiceFormat, { ...PROJECT, number: "1" })

  it("numbers deposit requests <job>-DEP<n> by default, and the printed request matches", () => {
    expect(number).toEqual({ value: "O-100-1-DEP1", error: null })
    expect(depositRequestNumber(DEFAULT_SAGE_EXPORT_SETTINGS.depositInvoiceFormat, "O-100-1", 2)).toBe("O-100-1-DEP2")
    // A format the project can't fill falls back to the old style.
    expect(depositRequestNumber("{job}-DEP{n}", "O-100-1", 1)).toBe("O-100-1-DEP-1")
  })

  it("is one untaxed line on the deposit account with no cost code", () => {
    const plan = planDepositForSage({ invoiceNumber: number, requestedAt: "2026-11-02", dueDate: "2026-11-10", dueDays: 30, amountCents: 25_000_00, depositAccount: 2150, sageJobNumber: "1001" })
    expect(plan.blockers).toEqual([])
    expect(plan.dueDate).toBe("2026-11-10")
    expect(plan.description).toBe("Deposit O-100-1-DEP1")
    expect(plan.lines).toHaveLength(1)
    expect(plan.lines[0]).toMatchObject({ kind: "deposit", amountCents: 25_000_00, taxable: false, accountNumber: 2150, sageCostCodeRecord: null })
    const payload = sageArInvoiceWritePayload(plan, { projectId: "p", applicationId: "d", applicationNumber: plan.invoiceNumber, sageJobNumber: "1001", sageJobId: null, invoiceType: 1, invoiceStatus: 1 })
    expect(payload?.lines).toEqual([{ description: "Contract deposit", amount: "25000.00", taxable: false, accountNumber: "2150", costCodeRecordNumber: null }])
    expect(payload?.invoice).toMatchObject({ number: "O-100-1-DEP1", linesTotal: "25000.00", expectedSalesTax: "0.00", retention: "0.00", dueDate: "2026-11-10" })
  })

  it("uses the payment terms without its own due date, and stops without a deposit account or Sage job", () => {
    const plan = planDepositForSage({ invoiceNumber: number, requestedAt: "2026-11-02", dueDate: null, dueDays: 15, amountCents: 100_00, depositAccount: null, sageJobNumber: null })
    expect(plan.dueDate).toBe("2026-11-17")
    expect(plan.blockers.join(" ")).toContain("deposit account")
    expect(plan.blockers.join(" ")).toContain("Sage job")
  })
})

describe("credit memo as a Sage AR invoice", () => {
  const line = (overrides: Partial<InvoiceLineInput> = {}): InvoiceLineInput => ({
    source: "added",
    estimateLineId: null,
    nutechProductId: null,
    costCode: "03 11 19",
    description: "Returned blocks",
    quantity: 1,
    unit: "EA",
    unitPriceCents: 500_00,
    taxable: true,
    ...overrides,
  })
  const normalized = normalizeInvoiceLines([line(), line({ description: "Credit for delay", unitPriceCents: 250_00, taxable: false })])
  if (!normalized.ok) throw new Error(normalized.error)
  const mapped = () => ({ status: "mapped" as const, by: "csi_prefix" as const, sageRecordNumber: "31119", sageName: "Mapped" })

  it("numbers credit memos <job>-CM<nn>", () => {
    expect(formatSageInvoiceNumber(simpleInvoiceNumberFormat("credit_memo", DEFAULT_SAGE_EXPORT_SETTINGS), { ...PROJECT, number: "1" }).value).toBe("O-100-1-CM01")
    expect(simpleInvoiceNumberFormat("other", DEFAULT_SAGE_EXPORT_SETTINGS)).toBe(DEFAULT_SAGE_EXPORT_SETTINGS.otherBillingInvoiceFormat)
  })

  it("sends every line negative, with negative tax, so the writer adds quantity -1 lines", () => {
    const plan = planSimpleInvoiceForSage({
      invoiceNumber: "O-100-1-CM01",
      invoiceDate: "2026-11-07",
      dueDays: 30,
      title: "",
      lines: normalized.lines,
      taxDistrict: { sageRecordNumber: "40017", name: "Example County", rateBasisPoints: 790 },
      taxDistrictUnmapped: false,
      incomeAccount: 4000,
      sageJobNumber: "1001",
      mapCostCode: mapped,
      credit: true,
    })
    expect(plan.blockers).toEqual([])
    expect(plan.description).toBe("Credit memo O-100-1-CM01")
    expect(plan.lines.map((planned) => planned.amountCents)).toEqual([-500_00, -250_00])
    expect(plan.linesTotalCents).toBe(-750_00)
    expect(plan.expectedSalesTaxCents).toBe(-3950)
    const payload = sageArInvoiceWritePayload(plan, { projectId: "p", applicationId: "i", applicationNumber: plan.invoiceNumber, sageJobNumber: "1001", sageJobId: null, invoiceType: 1, invoiceStatus: 1 })
    expect(payload?.invoice).toMatchObject({ linesTotal: "-750.00", expectedSalesTax: "-39.50" })
    expect(payload?.lines.map((planned) => planned.amount)).toEqual(["-500.00", "-250.00"])
  })
})
