import { z } from "zod/v4"

import type { ArInvoicePlan } from "@/lib/domain/sage-bridge/ar-invoice-rules"
import { sageAmount } from "@/lib/domain/sage-bridge/change-order-rules"
import { envFlag } from "@/lib/shared/env"

/*
 * The request Compass hands the Sage writer for one AR invoice
 * (ARInvoiceAddRq), and the result the writer reports back. Amounts are
 * decimal strings so the writer never rounds a float. A negative line goes to
 * Sage as quantity -1 at the positive unit price (Sage's UnitPrice can't be
 * negative); the writer does that.
 */

const decimalAmount = z.string().regex(/^-?\d{1,9}\.\d{2}$/)
const sageRecordNumber = z.string().regex(/^\d{1,12}$/)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const sageArInvoiceWritePayloadSchema = z.strictObject({
  operationType: z.literal("add_ar_invoice"),
  compassProjectId: z.string().min(1),
  compassApplicationId: z.string().min(1),
  job: z.strictObject({ sageJobNumber: sageRecordNumber, sageJobId: z.string().min(1).nullable() }),
  invoice: z.strictObject({
    number: z.string().trim().min(1).max(20),
    date: isoDate,
    dueDate: isoDate,
    description: z.string().trim().min(1).max(50),
    salesTaxDistrictRecordNumber: sageRecordNumber.nullable(),
    invoiceType: z.number().int().min(0).max(99),
    invoiceStatus: z.number().int().min(0).max(5),
    retention: decimalAmount,
    /** Sum of the lines (before Sage's sales tax). */
    linesTotal: decimalAmount,
    /** The sales tax Compass expects Sage to add; the writer compares it after the add. */
    expectedSalesTax: decimalAmount,
    memo: z.string().max(200),
  }),
  lines: z
    .array(
      z.strictObject({
        description: z.string().trim().min(1).max(75),
        amount: decimalAmount,
        taxable: z.boolean(),
        accountNumber: sageRecordNumber,
        costCodeRecordNumber: sageRecordNumber.nullable(),
      })
    )
    .min(1)
    .max(500),
})

export type SageArInvoiceWritePayload = z.infer<typeof sageArInvoiceWritePayloadSchema>

export const sageArInvoiceWriteResultSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("succeeded"),
    id: z.uuid(),
    claimToken: z.uuid(),
    /** Sage's acrinv.recnum for the invoice the writer added or found. */
    sageRecordId: sageRecordNumber,
    /** True when Sage already had this invoice number on the job with the same lines total. */
    alreadyInSage: z.boolean(),
    /** Sage's invoice total and sales tax as they read back. */
    sageInvoiceTotal: decimalAmount,
    sageSalesTax: decimalAmount,
  }),
  z.strictObject({
    outcome: z.literal("failed"),
    id: z.uuid(),
    claimToken: z.uuid(),
    error: z.string().min(1).max(4000),
    /** A guard stopped it (the number is already in Sage with other amounts): staff must look. */
    needsAttention: z.boolean(),
  }),
])

/** "12.30" → 1230. */
export function sageAmountCents(value: string): number {
  const negative = value.startsWith("-")
  const [whole = "0", fraction = "00"] = value.replace("-", "").split(".")
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2))
  return negative ? -cents : cents
}

/** The writer payload for a plan with no blockers, or null. */
export function sageArInvoiceWritePayload(
  plan: ArInvoicePlan,
  input: {
    readonly projectId: string
    readonly applicationId: string
    readonly applicationNumber: string
    readonly sageJobNumber: string
    readonly sageJobId: string | null
    readonly invoiceType: number
    readonly invoiceStatus: number
  }
): SageArInvoiceWritePayload | null {
  if (plan.blockers.length > 0 || !plan.invoiceDate || !plan.dueDate) return null
  const lines: SageArInvoiceWritePayload["lines"][number][] = []
  for (const line of plan.lines) {
    if (line.amountCents === 0) continue
    if (line.accountNumber === null) return null
    if (line.kind !== "deposit" && !line.sageCostCodeRecord) return null
    lines.push({
      description: line.description,
      amount: sageAmount(line.amountCents),
      taxable: line.taxable,
      accountNumber: String(line.accountNumber),
      costCodeRecordNumber: line.sageCostCodeRecord ? line.sageCostCodeRecord.replace(/\.0+$/, "") : null,
    })
  }
  const district = plan.taxDistrict?.sageRecordNumber ?? null
  const parsed = sageArInvoiceWritePayloadSchema.safeParse({
    operationType: "add_ar_invoice",
    compassProjectId: input.projectId,
    compassApplicationId: input.applicationId,
    job: { sageJobNumber: input.sageJobNumber.trim(), sageJobId: input.sageJobId },
    invoice: {
      number: plan.invoiceNumber,
      date: plan.invoiceDate,
      dueDate: plan.dueDate,
      description: plan.description,
      salesTaxDistrictRecordNumber: district,
      invoiceType: input.invoiceType,
      invoiceStatus: input.invoiceStatus,
      retention: sageAmount(plan.retentionCents),
      linesTotal: sageAmount(plan.linesTotalCents),
      expectedSalesTax: sageAmount(plan.expectedSalesTaxCents),
      memo: `Compass pay request ${input.applicationNumber}`.slice(0, 200),
    },
    lines,
  })
  return parsed.success ? parsed.data : null
}

/** Compass's switch for the AR invoice bridge routes and automatic queueing (off until the owner turns it on). */
export function sageArInvoiceWritesEnabled(env: unknown): boolean {
  return envFlag(env, "SAGE_AR_INVOICE_WRITES_ENABLED")
}
