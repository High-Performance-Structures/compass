import type { ArInvoicePlan, ArInvoicePlannedLine, ArInvoiceTaxDistrict } from "@/lib/domain/sage-bridge/ar-invoice-rules"
import { addDays } from "@/lib/domain/sage-bridge/ar-invoice-rules"
import { sageDescription } from "@/lib/domain/sage-bridge/change-order-rules"
import type { InvoiceLineSource, InvoicePriceMode, SimpleInvoiceKind } from "@/lib/domain/financials/statuses"
import type { SageCostCodeMapping } from "@/lib/financials/sage-export-codes"
import { formatCents } from "@/lib/format"

/*
 * Simple invoices built in Compass: Nu-Tech sales (from an estimate, in part
 * or in full) and one-off work. Pure: the line editor's preview, the server's
 * save, the Sage preview and the tests share it. Amounts are integer cents.
 *
 * - A line's amount is its quantity times its unit price, rounded to a cent.
 * - Sales tax is the invoice's tax district rate on the taxable lines' total,
 *   the way Sage adds it, so Compass and Sage agree to the cent.
 * - Estimate lines track what has been invoiced so far; a later invoice
 *   defaults to the remainder and needs an explicit override to go over.
 *   Lines added on the invoice ("Added (not on estimate)") never count
 *   against the estimate.
 */

const MAX_INVOICE_LINES = 200
const MAX_LINE_CENTS = 100_000_000_00
const SAGE_HEADER_DESCRIPTION_MAX = 50
const SAGE_LINE_DESCRIPTION_MAX = 75

export type InvoiceLineInput = {
  readonly source: InvoiceLineSource
  readonly estimateLineId: string | null
  readonly nutechProductId: string | null
  readonly costCode: string
  readonly description: string
  readonly quantity: number
  readonly unit: string
  readonly unitPriceCents: number
  readonly taxable: boolean
}

export type InvoiceLineComputed = InvoiceLineInput & { readonly amountCents: number }

export type InvoiceTotals = {
  readonly subtotalCents: number
  readonly taxableCents: number
  readonly taxCents: number
  readonly totalCents: number
}

export function lineAmountCents(quantity: number, unitPriceCents: number): number {
  return Math.round(quantity * unitPriceCents)
}

function salesTaxCents(taxableCents: number, rateBasisPoints: number | null): number {
  return rateBasisPoints ? Math.round((taxableCents * rateBasisPoints) / 10_000) : 0
}

export function invoiceTotals(lines: readonly InvoiceLineComputed[], rateBasisPoints: number | null): InvoiceTotals {
  const subtotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0)
  const taxableCents = lines.filter((line) => line.taxable).reduce((sum, line) => sum + line.amountCents, 0)
  const taxCents = salesTaxCents(taxableCents, rateBasisPoints)
  return { subtotalCents, taxableCents, taxCents, totalCents: subtotalCents + taxCents }
}

/** Checks and normalizes a draft's lines; returns the first problem as a sentence. */
export function normalizeInvoiceLines(
  lines: readonly InvoiceLineInput[]
): { readonly ok: true; readonly lines: readonly InvoiceLineComputed[] } | { readonly ok: false; readonly error: string } {
  if (lines.length > MAX_INVOICE_LINES) return { ok: false, error: `An invoice can have up to ${MAX_INVOICE_LINES} lines.` }
  const normalized: InvoiceLineComputed[] = []
  for (const [index, line] of lines.entries()) {
    const label = `Line ${index + 1}`
    const description = line.description.replaceAll(/\s+/g, " ").trim()
    const costCode = line.costCode.trim()
    const unit = line.unit.trim() || "EA"
    if (!description) return { ok: false, error: `${label}: enter a description.` }
    if (description.length > 500) return { ok: false, error: `${label}: keep the description under 500 characters.` }
    if (!costCode) return { ok: false, error: `${label} (${description}): choose a cost code.` }
    if (!Number.isFinite(line.quantity) || line.quantity === 0 || Math.abs(line.quantity) > 10_000_000) {
      return { ok: false, error: `${label} (${description}): enter a quantity.` }
    }
    if (!Number.isInteger(line.unitPriceCents) || Math.abs(line.unitPriceCents) > MAX_LINE_CENTS) {
      return { ok: false, error: `${label} (${description}): enter the unit price in dollars and cents.` }
    }
    if (line.source === "estimate" && !line.estimateLineId) return { ok: false, error: `${label}: its estimate line is missing.` }
    const amountCents = lineAmountCents(line.quantity, line.unitPriceCents)
    if (Math.abs(amountCents) > MAX_LINE_CENTS) return { ok: false, error: `${label} (${description}): the amount is too large.` }
    normalized.push({
      ...line,
      estimateLineId: line.source === "estimate" ? line.estimateLineId : null,
      description,
      costCode,
      unit: unit.slice(0, 20),
      amountCents,
    })
  }
  return { ok: true, lines: normalized }
}

/** An estimate line as an invoice reads it: its sell price before tax and what earlier invoices billed. */
export type EstimateLineBilling = {
  readonly estimateLineId: string
  readonly quantity: number
  /** Direct cost plus markup: the sell amount before tax. */
  readonly sellCents: number
  readonly invoicedQuantity: number
  readonly invoicedCents: number
}

export function estimateUnitPriceCents(line: Pick<EstimateLineBilling, "quantity" | "sellCents">): number {
  return line.quantity ? Math.round(line.sellCents / line.quantity) : line.sellCents
}

/** What is left to invoice on an estimate line (never below zero). */
export function estimateLineRemaining(line: EstimateLineBilling): { readonly quantity: number; readonly cents: number } {
  return {
    quantity: Math.max(0, roundQuantity(line.quantity - line.invoicedQuantity)),
    cents: Math.max(0, line.sellCents - line.invoicedCents),
  }
}

function roundQuantity(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/**
 * The invoice's estimate lines that would bill more than the estimate (with
 * what earlier invoices billed). Added lines never count. Staff confirm an
 * override before a draft that goes over can be saved or finalized.
 */
export function overEstimateWarnings(
  lines: readonly InvoiceLineComputed[],
  billing: ReadonlyMap<string, EstimateLineBilling>
): readonly string[] {
  const thisInvoice = new Map<string, { quantity: number; cents: number; description: string }>()
  for (const line of lines) {
    if (line.source !== "estimate" || !line.estimateLineId) continue
    const entry = thisInvoice.get(line.estimateLineId) ?? { quantity: 0, cents: 0, description: line.description }
    entry.quantity += line.quantity
    entry.cents += line.amountCents
    thisInvoice.set(line.estimateLineId, entry)
  }
  const warnings: string[] = []
  for (const [id, entry] of thisInvoice) {
    const estimate = billing.get(id)
    if (!estimate) continue
    const totalCents = estimate.invoicedCents + entry.cents
    const totalQuantity = roundQuantity(estimate.invoicedQuantity + entry.quantity)
    if (totalCents > estimate.sellCents || totalQuantity > estimate.quantity) {
      warnings.push(
        `${entry.description}: ${formatCents(totalCents)} invoiced in all (quantity ${totalQuantity}) is more than the estimate's ${formatCents(estimate.sellCents)} (quantity ${estimate.quantity}).`
      )
    }
  }
  return warnings
}

/** Nu-Tech (material sale) numbering for the departments that sell materials; other billing for the rest. */
export function defaultSimpleInvoiceKind(department: string | null, materialSaleDepartments: readonly string[]): SimpleInvoiceKind {
  return department && materialSaleDepartments.includes(department) ? "nutech_sale" : "other"
}

/** The price list column for catalog items: Square always uses the regular price. */
export function effectivePriceMode(input: { readonly squareRequested: boolean; readonly priceMode: InvoicePriceMode }): InvoicePriceMode {
  return input.squareRequested ? "standard" : input.priceMode
}

export type SquareEligibility = { readonly allowed: true } | { readonly allowed: false; readonly reason: string }

/** Whether "Create Square invoice" may be checked: deposits for some departments go by check or wire only. */
export function squareEligibility(input: {
  readonly isDeposit: boolean
  readonly department: string | null
  readonly blockedDepositDepartments: readonly string[]
}): SquareEligibility {
  if (input.isDeposit && input.department && input.blockedDepositDepartments.includes(input.department)) {
    return {
      allowed: false,
      reason: `Deposits on ${input.department} jobs are paid by check or wire, not Square (card fees are too high on deposits). Change this in Settings › Workflows › Simple invoices.`,
    }
  }
  return { allowed: true }
}

/** Which actions the invoice allows now (decided on the server, shown as flags). */
export type SimpleInvoiceActions = {
  readonly canEdit: boolean
  readonly canDelete: boolean
  readonly canFinalize: boolean
  readonly canReopen: boolean
  readonly canVoid: boolean
}

export function simpleInvoiceActions(input: {
  readonly status: string
  readonly emailed: boolean
  /** A Sage export that is running or reached Sage. */
  readonly sageExportLive: boolean
  readonly squarePublished: boolean
  readonly hasPayments: boolean
}): SimpleInvoiceActions {
  const draft = input.status === "draft"
  const sent = input.emailed || input.sageExportLive || input.squarePublished
  return {
    canEdit: draft,
    canDelete: draft && !sent,
    canFinalize: draft,
    canReopen: !draft && input.status !== "void" && !sent && !input.hasPayments,
    canVoid: !draft && input.status !== "void" && !input.hasPayments,
  }
}

/** One Sage line description: the line's text, with quantity and price when Sage can't show them (Sage gets one unit at the amount). */
function sageLineDescription(line: InvoiceLineComputed): string {
  const base = line.description
  if (line.quantity === 1 || /^\d/.test(base)) return sageDescription(base, SAGE_LINE_DESCRIPTION_MAX)
  const suffix = ` (${line.quantity} ${line.unit} @ ${formatCents(line.unitPriceCents)})`
  const room = SAGE_LINE_DESCRIPTION_MAX - suffix.length
  return room >= 10 ? `${sageDescription(base, room)}${suffix}` : sageDescription(base, SAGE_LINE_DESCRIPTION_MAX)
}

/**
 * The simple invoice as a Sage AR invoice plan (the same shape a billed pay
 * request uses, so the writer payload, the writer and the result route are
 * shared). Blockers say why it can't go to Sage yet.
 *
 * A credit memo (stored as positive amounts) goes to Sage as an AR invoice
 * whose every line is negative: the writer sends each as quantity -1 at the
 * positive price, so Sage records the credit against the job's receivable.
 */
export function planSimpleInvoiceForSage(input: {
  readonly invoiceNumber: string | null
  readonly invoiceDate: string | null
  readonly dueDays: number
  readonly title: string
  readonly lines: readonly InvoiceLineComputed[]
  readonly taxDistrict: ArInvoiceTaxDistrict | null
  /** The invoice's district has no Sage record number. */
  readonly taxDistrictUnmapped: boolean
  readonly incomeAccount: number | null
  readonly sageJobNumber: string | null
  readonly mapCostCode: (costCode: string) => SageCostCodeMapping
  /** A credit memo: every line goes to Sage negative. */
  readonly credit?: boolean
}): ArInvoicePlan {
  const blockers: string[] = []
  const sign = input.credit ? -1 : 1
  const noun = input.credit ? "credit memo" : "invoice"
  if (!input.sageJobNumber) blockers.push("The project isn't linked to a Sage job. Link it (or send it to Sage) from the project Overview.")
  if (!input.invoiceNumber) blockers.push(`Finalize the ${noun} first; that gives it its number.`)
  if (!input.invoiceDate) blockers.push(`The ${noun} has no date.`)
  const description = input.title.replaceAll(/\s+/g, " ").trim() || (input.invoiceNumber ? `${input.credit ? "Credit memo" : "Invoice"} ${input.invoiceNumber}` : "")
  if (description.length > SAGE_HEADER_DESCRIPTION_MAX) {
    blockers.push(`Sage allows ${SAGE_HEADER_DESCRIPTION_MAX} characters for the invoice description; "${description}" has ${description.length}.`)
  }
  if (input.incomeAccount === null) blockers.push("Choose the Sage income account for this department in Settings › Workflows › Sage AR invoices.")
  const unmapped: string[] = []
  const lines: ArInvoicePlannedLine[] = input.lines.map((line, index) => {
    const mapping = input.mapCostCode(line.costCode)
    const record = mapping.status === "mapped" ? mapping.sageRecordNumber : null
    if (!record) unmapped.push(line.costCode)
    return {
      key: `line-${index}`,
      kind: "contract",
      costCode: line.costCode,
      description: sageLineDescription(line),
      taxable: line.taxable,
      amountCents: sign * line.amountCents,
      billedCents: sign * line.amountCents,
      sageCostCodeRecord: record,
      sageCostCodeName: mapping.status === "mapped" ? mapping.sageName : null,
      accountNumber: input.incomeAccount,
    }
  })
  if (unmapped.length > 0) blockers.push(`These cost codes have no Sage cost code record number: ${[...new Set(unmapped)].join(", ")}.`)
  const taxable = lines.filter((line) => line.taxable)
  if (taxable.length > 0 && !input.taxDistrict) {
    blockers.push(input.taxDistrictUnmapped ? "The invoice's tax district has no Sage record number." : "Some lines are taxable; choose the invoice's sales tax district.")
  }
  if (lines.length === 0) blockers.push("Add at least one line.")
  const linesTotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0)
  if (lines.length > 0 && sign * linesTotalCents <= 0) blockers.push(`The ${noun} total must be more than zero.`)
  const taxableCents = taxable.reduce((sum, line) => sum + line.amountCents, 0)
  const taxDistrict = taxable.length > 0 ? input.taxDistrict : null
  // A credit's tax is the invoice's own tax, negative (rounded on the positive amount, as Compass stored it).
  const expectedSalesTaxCents = sign * salesTaxCents(sign * taxableCents, taxDistrict?.rateBasisPoints ?? null)
  const netDueCents = linesTotalCents + expectedSalesTaxCents
  return {
    invoiceNumber: input.invoiceNumber ?? "",
    invoiceDate: input.invoiceDate,
    dueDate: input.invoiceDate ? addDays(input.invoiceDate, input.dueDays) : null,
    description,
    lines,
    linesTotalCents,
    taxableCents,
    expectedSalesTaxCents,
    taxDistrict,
    retentionCents: 0,
    netDueCents,
    currentPaymentDueCents: netDueCents,
    blockers,
  }
}
