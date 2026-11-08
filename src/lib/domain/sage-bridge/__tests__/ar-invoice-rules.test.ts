import { describe, expect, it } from "vitest"

import {
  addDays,
  allocateCents,
  arInvoiceDescription,
  planSageArInvoice,
  type ArInvoicePlanInput,
  type ArInvoiceTaxProfile,
} from "@/lib/domain/sage-bridge/ar-invoice-rules"
import { sageArInvoiceWritePayload, sageAmountCents } from "@/lib/sage/ar-invoice-write"
import type { SageCostCodeMapping } from "@/lib/financials/sage-export-codes"

// Invented cost codes and record numbers; no real job.
const RECORDS: Record<string, string> = { "03 31 00": "331", "06 10 00": "610", "Company Overhead": "34" }

function mapCostCode(code: string): SageCostCodeMapping {
  const record = RECORDS[code]
  return record
    ? { status: "mapped", by: "csi_prefix", sageName: `${code} - Example`, sageRecordNumber: record }
    : { status: "unmapped", reason: `No Sage cost code for ${code}` }
}

function input(overrides: Partial<ArInvoicePlanInput> = {}): ArInvoicePlanInput {
  return {
    invoiceNumber: { value: "X-100-200-PR03", error: null },
    invoiceDate: "2026-11-30",
    dueDays: 30,
    description: "November 2026 Pay Request #3",
    changeOrderLineFormat: "{costCode} + {changeOrder}",
    lines: [
      { costCode: "03 31 00", description: "Footings", scheduledCents: 1_000_000, thisPeriodCents: 200_000 },
      { costCode: "06 10 00", description: "Framing", scheduledCents: 500_000, thisPeriodCents: 100_000 },
      { costCode: "Company Overhead", description: "Overhead", scheduledCents: 100_000, thisPeriodCents: 20_000 },
    ],
    changeOrders: [],
    contractTax: new Map(),
    changeOrderTax: new Map(),
    taxDistrict: null,
    retentionCents: 32_000,
    depositAppliedCents: 0,
    currentPaymentDueCents: 288_000,
    incomeAccount: 40_100,
    depositAccount: 24_000,
    sageJobNumber: "1200",
    mapCostCode,
    ...overrides,
  }
}

describe("allocateCents", () => {
  it("splits exactly, keeping signs", () => {
    expect(allocateCents(100, [1, 1, 1])).toEqual([33, 34, 33])
    expect(allocateCents(1000, [800, 300, -100]).reduce((a, b) => a + b, 0)).toBe(1000)
    expect(allocateCents(50, [0, 0])).toEqual([50, 0])
  })
})

describe("planSageArInvoice", () => {
  it("bills this period by cost code with the Sage record and income account, tying to the payment due", () => {
    const plan = planSageArInvoice(input())
    expect(plan.blockers).toEqual([])
    expect(plan.lines.map((line) => [line.costCode, line.amountCents, line.sageCostCodeRecord, line.kind])).toEqual([
      ["03 31 00", 200_000, "331", "contract"],
      ["06 10 00", 100_000, "610", "contract"],
      ["Company Overhead", 20_000, "34", "fee"],
    ])
    expect(plan.lines.every((line) => line.accountNumber === 40_100)).toBe(true)
    expect(plan.lines[0]?.description).toBe("03 31 00 - Example")
    expect(plan.netDueCents).toBe(288_000)
    expect(plan.dueDate).toBe("2026-12-30")
  })

  it("puts each change order and variance on its own line by contract share", () => {
    const plan = planSageArInvoice(input({
      changeOrders: [
        { changeOrderId: "co-1", recordType: "change_order", number: "4", costCode: "03 31 00", amountCents: 250_000 },
        { changeOrderId: "v-1", recordType: "variance", number: "6", costCode: "03 31 00", amountCents: 250_000 },
      ],
    }))
    const footings = plan.lines.filter((line) => line.costCode === "03 31 00")
    expect(footings.map((line) => [line.description, line.amountCents])).toEqual([
      ["03 31 00 - Example", 133_333],
      ["03 31 00 - Example + CO #4", 33_334],
      ["03 31 00 - Example + V-6", 33_333],
    ])
    expect(plan.blockers).toEqual([])
  })

  it("splits a mixed cost code into a taxable line before Sage's tax and a non-taxable line, and still ties", () => {
    const tax: ArInvoiceTaxProfile = { totalCents: 1_000_000, taxableCents: 400_000, taxableTaxCents: 30_000 }
    const district = { sageRecordNumber: "999", name: "Example District", rateBasisPoints: 811 }
    const plan = planSageArInvoice(input({ contractTax: new Map([["03 31 00", tax]]), taxDistrict: district }))
    const footings = plan.lines.filter((line) => line.costCode === "03 31 00")
    expect(footings.map((line) => [line.taxable, line.billedCents])).toEqual([[true, 80_000], [false, 120_000]])
    expect(footings[0]?.amountCents).toBe(74_000)
    expect(plan.expectedSalesTaxCents).toBe(Math.round(74_000 * 0.0811))
    expect(plan.netDueCents).toBe(288_000)
    expect(plan.blockers).toEqual([])
  })

  it("stops when billed taxable amounts don't carry the tax Sage will add", () => {
    const tax: ArInvoiceTaxProfile = { totalCents: 1_000_000, taxableCents: 1_000_000, taxableTaxCents: 0 }
    const district = { sageRecordNumber: "999", name: "Example District", rateBasisPoints: 811 }
    const plan = planSageArInvoice(input({ contractTax: new Map([["03 31 00", tax]]), taxDistrict: district }))
    expect(plan.blockers.some((blocker) => blocker.includes("taxable lines don't tie"))).toBe(true)
  })

  it("adds the deposit applied as a negative line on the deposit account", () => {
    const plan = planSageArInvoice(input({ depositAppliedCents: 50_000, currentPaymentDueCents: 238_000 }))
    expect(plan.lines.at(-1)).toMatchObject({ kind: "deposit", amountCents: -50_000, accountNumber: 24_000, sageCostCodeRecord: null })
    expect(plan.blockers).toEqual([])
  })

  it("needs attention for missing Sage records, accounts, job or a total that doesn't tie", () => {
    const plan = planSageArInvoice(input({
      lines: [{ costCode: "09 90 00", description: "Paint", scheduledCents: 100, thisPeriodCents: 100 }],
      incomeAccount: null,
      sageJobNumber: null,
      currentPaymentDueCents: 5,
    }))
    expect(plan.blockers.join(" ")).toMatch(/Sage job/)
    expect(plan.blockers.join(" ")).toMatch(/income account/)
    expect(plan.blockers.join(" ")).toMatch(/09 90 00/)
    expect(plan.blockers.join(" ")).toMatch(/doesn't tie/)
  })

  it("allows credits as negative lines", () => {
    const plan = planSageArInvoice(input({
      lines: [{ costCode: "06 10 00", description: "Framing", scheduledCents: 500_000, thisPeriodCents: -10_000 }],
      retentionCents: -1_000,
      currentPaymentDueCents: -9_000,
    }))
    expect(plan.blockers).toEqual([])
    expect(plan.lines[0]?.amountCents).toBe(-10_000)
  })
})

describe("writer payload", () => {
  it("carries amounts as decimal strings and the record numbers", () => {
    const plan = planSageArInvoice(input())
    const payload = sageArInvoiceWritePayload(plan, {
      projectId: "p1", applicationId: "a1", applicationNumber: "3", sageJobNumber: "1200", sageJobId: null, invoiceType: 1, invoiceStatus: 1,
    })
    expect(payload?.invoice).toMatchObject({ number: "X-100-200-PR03", retention: "320.00", linesTotal: "3200.00", invoiceType: 1, invoiceStatus: 1 })
    expect(payload?.lines[0]).toMatchObject({ amount: "2000.00", costCodeRecordNumber: "331", accountNumber: "40100", taxable: false })
    expect(sageAmountCents("-12.30")).toBe(-1230)
  })

  it("is null while the plan has blockers", () => {
    const plan = planSageArInvoice(input({ incomeAccount: null }))
    expect(sageArInvoiceWritePayload(plan, {
      projectId: "p1", applicationId: "a1", applicationNumber: "3", sageJobNumber: "1200", sageJobId: null, invoiceType: 1, invoiceStatus: 1,
    })).toBeNull()
  })
})

describe("helpers", () => {
  it("fills the description and due date", () => {
    expect(arInvoiceDescription("{month} {year} Pay Request #{n}", { date: "2026-11-30", sequence: "3", projectNumber: null })).toBe("November 2026 Pay Request #3")
    expect(addDays("2026-12-15", 30)).toBe("2027-01-14")
  })
})
