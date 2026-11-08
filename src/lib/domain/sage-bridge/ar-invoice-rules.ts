import { canonicalFeeCostCode, isBuilderFeeCostCode } from "@/lib/domain/financials/builder-fee-codes"
import { sageChangeOrderName, sageDescription } from "@/lib/domain/sage-bridge/change-order-rules"
import { formatCents } from "@/lib/format"
import type { SageCostCodeMapping } from "@/lib/financials/sage-export-codes"

/*
 * A billed Compass pay request as a Sage 100 Contractor AR invoice
 * (ARInvoiceAddRq). Pure: the pay request page's preview, the writer request
 * and the tests share it. Amounts are cents.
 *
 * - Lines are THIS period's billing (work completed plus materials stored
 *   this period), one per cost code, described by the Sage cost code name.
 * - A change order or variance on a cost code gets its own line, never merged
 *   with the base contract or another change order: the cost code's billing
 *   this period is split by each part's share of the cost code's contract.
 * - A part whose estimate lines mix taxable and non-taxable work is split into
 *   a taxable and a non-taxable line by the estimate lines' share. Sage adds
 *   sales tax on taxable lines, so a taxable line goes to Sage before the tax
 *   the estimate built into it; Sage's tax brings it back to what was billed.
 * - The deposit applied to the draw is a negative line on the deposit account.
 * - Lines plus Sage's sales tax, less this period's retention, must equal the
 *   pay request's current payment due, or the invoice needs attention.
 */

const SAGE_AR_INVOICE_HEADER_DESCRIPTION_MAX = 50
const SAGE_AR_INVOICE_LINE_DESCRIPTION_MAX = 75

/** A G703 row of the pay request as the invoice reads it (cents). */
type ArInvoiceSourceLine = {
  readonly costCode: string
  readonly description: string
  /** The base contract's scheduled value on the row. */
  readonly scheduledCents: number
  /** Work completed this period plus materials stored this period. */
  readonly thisPeriodCents: number
}

/** One change order's (or variance's) part of a cost code in the draw's contract budget. */
type ArInvoiceChangeOrderPart = {
  readonly changeOrderId: string
  readonly recordType: "change_order" | "variance"
  readonly number: string
  readonly costCode: string
  readonly amountCents: number
}

/** How much of a contract part's estimate is taxable, and the tax built into it. */
export type ArInvoiceTaxProfile = {
  readonly totalCents: number
  readonly taxableCents: number
  /** Sales tax the estimate added to its taxable lines (part of taxableCents). */
  readonly taxableTaxCents: number
}

export type ArInvoiceTaxDistrict = {
  readonly sageRecordNumber: string
  readonly name: string
  readonly rateBasisPoints: number
}

type ArInvoiceLineKind = "contract" | "change_order" | "fee" | "deposit"

export type ArInvoicePlannedLine = {
  readonly key: string
  readonly kind: ArInvoiceLineKind
  /** Compass's cost code; null for the deposit line. */
  readonly costCode: string | null
  readonly description: string
  readonly taxable: boolean
  /** What goes to Sage; a taxable line is before Sage's sales tax. */
  readonly amountCents: number
  /** What the owner was billed for this line (a taxable line includes its tax). */
  readonly billedCents: number
  readonly sageCostCodeRecord: string | null
  readonly sageCostCodeName: string | null
  readonly accountNumber: number | null
}

export type ArInvoicePlan = {
  readonly invoiceNumber: string
  readonly invoiceDate: string | null
  readonly dueDate: string | null
  readonly description: string
  readonly lines: readonly ArInvoicePlannedLine[]
  readonly linesTotalCents: number
  readonly taxableCents: number
  /** The sales tax Sage should add on the taxable lines at the district's rate. */
  readonly expectedSalesTaxCents: number
  readonly taxDistrict: ArInvoiceTaxDistrict | null
  readonly retentionCents: number
  /** Lines plus sales tax less retention: what the owner owes on this invoice. */
  readonly netDueCents: number
  readonly currentPaymentDueCents: number
  readonly blockers: readonly string[]
}

export type ArInvoicePlanInput = {
  readonly invoiceNumber: { readonly value: string; readonly error: string | null }
  readonly invoiceDate: string | null
  readonly dueDays: number
  readonly description: string
  readonly changeOrderLineFormat: string
  readonly lines: readonly ArInvoiceSourceLine[]
  readonly changeOrders: readonly ArInvoiceChangeOrderPart[]
  /** Tax profile of the base contract by canonical cost code. */
  readonly contractTax: ReadonlyMap<string, ArInvoiceTaxProfile>
  /** Tax profile by change order id, then canonical cost code. */
  readonly changeOrderTax: ReadonlyMap<string, ReadonlyMap<string, ArInvoiceTaxProfile>>
  readonly taxDistrict: ArInvoiceTaxDistrict | null
  readonly retentionCents: number
  readonly depositAppliedCents: number
  readonly currentPaymentDueCents: number
  readonly incomeAccount: number | null
  readonly depositAccount: number | null
  readonly sageJobNumber: string | null
  readonly mapCostCode: (costCode: string) => SageCostCodeMapping
}

/** Splits `total` across `weights` in exact cents (cumulative rounding, signs kept). */
export function allocateCents(total: number, weights: readonly number[]): readonly number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0)
  if (sum === 0) return weights.map((_, index) => (index === 0 ? total : 0))
  let cumulative = 0
  let allocated = 0
  return weights.map((weight) => {
    cumulative += weight
    const upTo = Math.round((total * cumulative) / sum)
    const share = upTo - allocated
    allocated = upTo
    return share
  })
}

/** "2026-11-30" plus days, as a date-only string. */
export function addDays(date: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!match) return null
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days))
  return value.toISOString().slice(0, 10)
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const

/** The invoice description from the company's format: {month} {year} {n} {project}. */
export function arInvoiceDescription(
  format: string,
  input: { readonly date: string | null; readonly sequence: string; readonly projectNumber: string | null }
): string {
  const match = input.date ? /^(\d{4})-(\d{2})/.exec(input.date) : null
  const month = match ? (MONTHS[Number(match[2]) - 1] ?? "") : ""
  const year = match?.[1] ?? ""
  const filled = format
    .replaceAll("{month}", month)
    .replaceAll("{year}", year)
    .replaceAll("{n}", input.sequence)
    .replaceAll("{project}", input.projectNumber ?? "")
  return filled.replaceAll(/\s+/g, " ").trim()
}

/** "CO #14" or "V-006". */
function changeOrderLabel(part: Pick<ArInvoiceChangeOrderPart, "number" | "recordType">): string {
  return part.recordType === "variance" ? sageChangeOrderName(part.number, "variance") : `CO #${part.number.trim()}`
}

type Component = {
  readonly key: string
  readonly kind: ArInvoiceLineKind
  readonly costCode: string
  readonly description: string
  readonly cents: number
  readonly tax: ArInvoiceTaxProfile | undefined
}

type GrossLine = Omit<ArInvoicePlannedLine, "amountCents" | "taxable"> & {
  readonly taxable: boolean
  /** Before Sage's tax, from the tax the estimate built in; equals billedCents when not taxable. */
  readonly preTaxCents: number
}

/** Base contract and each change order on one cost code, with this period's billing split by contract share. */
function costCodeComponents(
  code: string,
  description: string,
  scheduledCents: number,
  thisPeriodCents: number,
  parts: readonly ArInvoiceChangeOrderPart[],
  input: ArInvoicePlanInput
): readonly Component[] {
  const kind: ArInvoiceLineKind = isBuilderFeeCostCode(code) ? "fee" : "contract"
  const byChangeOrder = new Map<string, { part: ArInvoiceChangeOrderPart; cents: number }>()
  for (const part of parts) {
    const entry = byChangeOrder.get(part.changeOrderId) ?? { part, cents: 0 }
    entry.cents += part.amountCents
    byChangeOrder.set(part.changeOrderId, entry)
  }
  const changeOrders = [...byChangeOrder.values()].filter((entry) => entry.cents !== 0)
  const base: Component = { key: code, kind, costCode: code, description, cents: thisPeriodCents, tax: input.contractTax.get(code) }
  if (changeOrders.length === 0) return [base]
  const shares = allocateCents(thisPeriodCents, [scheduledCents, ...changeOrders.map((entry) => entry.cents)])
  return [
    { ...base, cents: shares[0] ?? 0 },
    ...changeOrders.map((entry, index) => ({
      key: `${code}|${entry.part.changeOrderId}`,
      kind: "change_order" as const,
      costCode: code,
      description: input.changeOrderLineFormat.replaceAll("{costCode}", description).replaceAll("{changeOrder}", changeOrderLabel(entry.part)),
      cents: shares[index + 1] ?? 0,
      tax: input.changeOrderTax.get(entry.part.changeOrderId)?.get(code),
    })),
  ]
}

/** A part as one non-taxable line, or a taxable and a non-taxable line by its estimate's share. */
function splitByTax(component: Component, mapping: SageCostCodeMapping, input: ArInvoicePlanInput): readonly GrossLine[] {
  const common = {
    kind: component.kind,
    costCode: component.costCode,
    description: sageDescription(component.description, SAGE_AR_INVOICE_LINE_DESCRIPTION_MAX),
    sageCostCodeRecord: mapping.status === "mapped" ? mapping.sageRecordNumber : null,
    sageCostCodeName: mapping.status === "mapped" ? mapping.sageName : null,
    accountNumber: input.incomeAccount,
  }
  const tax = component.tax
  const taxableCents = tax && tax.totalCents !== 0 && tax.taxableCents !== 0
    ? (tax.taxableCents === tax.totalCents ? component.cents : Math.round((component.cents * tax.taxableCents) / tax.totalCents))
    : 0
  const plainCents = component.cents - taxableCents
  const lines: GrossLine[] = []
  if (taxableCents !== 0 && tax) {
    const preTax = taxableCents - Math.round((taxableCents * tax.taxableTaxCents) / tax.taxableCents)
    lines.push({ ...common, key: `${component.key}|taxable`, taxable: true, billedCents: taxableCents, preTaxCents: preTax })
  }
  if (plainCents !== 0) lines.push({ ...common, key: component.key, taxable: false, billedCents: plainCents, preTaxCents: plainCents })
  return lines
}

function salesTax(cents: number, district: ArInvoiceTaxDistrict | null): number {
  return district ? Math.round((cents * district.rateBasisPoints) / 10_000) : 0
}

/** Plans the AR invoice for a billed pay request; blockers say why it can't go to Sage yet. */
export function planSageArInvoice(input: ArInvoicePlanInput): ArInvoicePlan {
  const blockers: string[] = []
  if (!input.sageJobNumber) blockers.push("The project isn't linked to a Sage job. Link it (or send it to Sage) from the project Overview.")
  if (input.invoiceNumber.error) blockers.push(input.invoiceNumber.error)
  if (!input.invoiceDate) blockers.push("The pay request has no period end date for the invoice date.")
  if (!input.description) blockers.push("The invoice description is empty; check the description format in Settings.")
  if (input.description.length > SAGE_AR_INVOICE_HEADER_DESCRIPTION_MAX) {
    blockers.push(`Sage allows ${SAGE_AR_INVOICE_HEADER_DESCRIPTION_MAX} characters for the invoice description; "${input.description}" has ${input.description.length}.`)
  }
  if (input.incomeAccount === null) blockers.push("Choose the Sage income account for this department in Settings > Workflows > Sage AR invoices.")

  // Rows roll up by canonical cost code, in the draw's order.
  const byCode = new Map<string, { description: string; scheduledCents: number; thisPeriodCents: number }>()
  for (const line of input.lines) {
    const code = canonicalFeeCostCode(line.costCode.trim())
    const entry = byCode.get(code) ?? { description: line.description, scheduledCents: 0, thisPeriodCents: 0 }
    entry.scheduledCents += line.scheduledCents
    entry.thisPeriodCents += line.thisPeriodCents
    byCode.set(code, entry)
  }
  const partsByCode = new Map<string, ArInvoiceChangeOrderPart[]>()
  for (const part of input.changeOrders) {
    const code = canonicalFeeCostCode(part.costCode.trim())
    partsByCode.set(code, [...(partsByCode.get(code) ?? []), part])
  }

  const gross: GrossLine[] = []
  const unmapped: string[] = []
  for (const [code, entry] of byCode) {
    if (entry.thisPeriodCents === 0) continue
    const mapping = input.mapCostCode(code)
    const name = mapping.status === "mapped" ? mapping.sageName : code || entry.description
    const components = costCodeComponents(code, name, entry.scheduledCents, entry.thisPeriodCents, partsByCode.get(code) ?? [], input)
    const lines = components.filter((component) => component.cents !== 0).flatMap((component) => splitByTax(component, mapping, input))
    if (lines.length > 0 && (mapping.status !== "mapped" || !mapping.sageRecordNumber)) {
      unmapped.push(`${code || "No cost code"} (${formatCents(entry.thisPeriodCents)})`)
    }
    gross.push(...lines)
  }
  if (unmapped.length > 0) blockers.push(`These cost codes have no Sage cost code record number: ${unmapped.join(", ")}.`)

  // Sales tax: Sage adds it on the taxable lines at the district's rate.
  const taxable = gross.filter((line) => line.taxable)
  const taxDistrict = taxable.length > 0 ? input.taxDistrict : null
  if (taxable.length > 0 && !input.taxDistrict) blockers.push("Some lines are taxable, but the estimate has no Sage tax district.")
  const amounts = new Map(gross.map((line) => [line.key, line.preTaxCents]))
  const billedTaxable = taxable.reduce((sum, line) => sum + line.billedCents, 0)
  const preTaxTotal = () => taxable.reduce((sum, line) => sum + (amounts.get(line.key) ?? 0), 0)
  // The tax the estimate built in and Sage's tax round differently by a cent or
  // two; that difference goes on the largest line Sage doesn't tax (or the
  // largest taxable line) so the invoice ties exactly. A larger gap means the
  // billed amounts don't carry the tax Sage will add, and stops the invoice.
  const residual = billedTaxable - preTaxTotal() - salesTax(preTaxTotal(), taxDistrict)
  const tolerance = Math.max(2, taxable.length)
  if (taxDistrict && residual !== 0) {
    if (Math.abs(residual) <= tolerance) {
      const target = [...gross].filter((line) => !line.taxable).sort((left, right) => Math.abs(right.billedCents) - Math.abs(left.billedCents))[0]
        ?? [...taxable].sort((left, right) => Math.abs(right.billedCents) - Math.abs(left.billedCents))[0]
      if (target) amounts.set(target.key, (amounts.get(target.key) ?? 0) + residual)
    } else {
      blockers.push(
        `The taxable lines don't tie: Sage would add ${formatCents(salesTax(preTaxTotal(), taxDistrict))} sales tax at ${taxDistrict.name}'s rate, but the billed taxable amounts carry ${formatCents(billedTaxable - preTaxTotal())}. Check the tax on the estimate lines.`
      )
    }
  }

  const lines: ArInvoicePlannedLine[] = gross.map((line) => ({
    key: line.key,
    kind: line.kind,
    costCode: line.costCode,
    description: line.description,
    taxable: line.taxable,
    amountCents: amounts.get(line.key) ?? 0,
    billedCents: line.billedCents,
    sageCostCodeRecord: line.sageCostCodeRecord,
    sageCostCodeName: line.sageCostCodeName,
    accountNumber: line.accountNumber,
  }))
  if (input.depositAppliedCents !== 0) {
    if (input.depositAccount === null) blockers.push("This draw applies a deposit; choose the Sage deposit account in Settings > Workflows > Sage AR invoices.")
    lines.push({
      key: "deposit",
      kind: "deposit",
      costCode: null,
      description: "Deposit applied",
      taxable: false,
      amountCents: -input.depositAppliedCents,
      billedCents: -input.depositAppliedCents,
      sageCostCodeRecord: null,
      sageCostCodeName: null,
      accountNumber: input.depositAccount,
    })
  }
  if (!lines.some((line) => line.amountCents !== 0)) blockers.push("Nothing is billed this period, so there is no invoice to send.")

  const linesTotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0)
  const taxableCents = lines.filter((line) => line.taxable).reduce((sum, line) => sum + line.amountCents, 0)
  const expectedSalesTaxCents = salesTax(taxableCents, taxDistrict)
  const netDueCents = linesTotalCents + expectedSalesTaxCents - input.retentionCents
  if (netDueCents !== input.currentPaymentDueCents) {
    blockers.push(
      `The invoice doesn't tie to the pay request: lines ${formatCents(linesTotalCents)}${expectedSalesTaxCents ? ` plus sales tax ${formatCents(expectedSalesTaxCents)}` : ""} less retention ${formatCents(input.retentionCents)} is ${formatCents(netDueCents)}, but the current payment due is ${formatCents(input.currentPaymentDueCents)}.`
    )
  }
  return {
    invoiceNumber: input.invoiceNumber.value,
    invoiceDate: input.invoiceDate,
    dueDate: input.invoiceDate ? addDays(input.invoiceDate, input.dueDays) : null,
    description: input.description,
    lines,
    linesTotalCents,
    taxableCents,
    expectedSalesTaxCents,
    taxDistrict,
    retentionCents: input.retentionCents,
    netDueCents,
    currentPaymentDueCents: input.currentPaymentDueCents,
    blockers,
  }
}
