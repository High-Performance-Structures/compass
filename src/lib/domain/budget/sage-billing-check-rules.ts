import type { PayApplicationSageCheckStatus } from "@/lib/domain/budget/statuses"
import { canonicalFeeCostCode } from "@/lib/domain/financials/builder-fee-codes"
import { sageChangeOrderName } from "@/lib/domain/sage-bridge/change-order-rules"
import { formatCents } from "@/lib/format"

/*
 * Pay requests built in Sage 100 Contractor (Progress Billing → Submitted →
 * Post; posting creates Sage's AR invoice). Compass can't edit that invoice,
 * so it (A) tells staff exactly what to enter before posting and (B) checks
 * the posted invoice after each sync. Pure: the pay request page, Print
 * Preview, the sync and the tests share it. Amounts are cents.
 *
 * Sage adds sales tax on the billing's taxable lines at the billing's tax
 * district rate, so the invoice should total the G702 current payment due
 * plus that tax.
 */

/** An invoice number from the company's format, and why Sage would refuse it (null when fine). */
type SageInvoiceNumber = { readonly value: string; readonly error: string | null }

/** How an estimate part bills for tax: all taxable, none, or a mix that needs two Sage lines. */
export type Taxability = "taxable" | "not_taxable" | "split"

/** How much of a contract part's estimate is taxable. */
export type TaxShare = { readonly totalCents: number; readonly taxableCents: number }

type BillingTaxDistrict = {
  /** Sage's tax district record number (taxdst.recnum). */
  readonly code: string
  readonly name: string
  readonly rateBasisPoints: number
}

/** One change order's (or variance's) part of a cost code in the contract budget. */
type BillingChangeOrderPart = {
  readonly changeOrderId: string
  readonly recordType: "change_order" | "variance"
  readonly number: string
  readonly costCode: string
  readonly amountCents: number
}

/** A G703 line of the pay request. */
export type BillingLineInput = {
  readonly key: string
  readonly costCode: string
  readonly description: string
  /** Work completed plus materials stored this period. */
  readonly thisPeriodCents: number
  /** Sage's Taxable flag on the matching progress billing line; null when Sage's flags aren't known. */
  readonly sageTaxable: boolean | null
}

type EnterInSageLine = BillingLineInput & {
  readonly expected: Taxability
  /** This period's taxable amount by the estimate (a split line by its taxable share). */
  readonly taxableCents: number
  /** Sage's flag differs from the estimate (a split line always needs attention until split). */
  readonly flagDiffers: boolean
}

type EnterInSageChangeOrder = {
  readonly key: string
  /** "CO #14" or "V-006". */
  readonly label: string
  readonly costCode: string
  readonly description: string
  readonly amountCents: number
  readonly taxability: Taxability
  /** Already on Sage's billing, its own line on a cost code the billing has, or a new line appended. */
  readonly placement: "on_billing" | "add_line" | "append_new_line"
}

export type EnterInSageChecklist = {
  readonly invoiceNumber: SageInvoiceNumber
  readonly billingDate: string | null
  readonly periodTo: string | null
  readonly description: string
  readonly billingCycle: string
  readonly taxDistrict: BillingTaxDistrict | null
  readonly lines: readonly EnterInSageLine[]
  readonly changeOrders: readonly EnterInSageChangeOrder[]
  readonly totals: {
    readonly thisPeriodCents: number
    readonly retentionCents: number
    readonly amountDueCents: number
    readonly taxableCents: number
    readonly expectedTaxCents: number
    readonly expectedInvoiceTotalCents: number
  }
  /** Things to sort out before posting (missing district, lines to split, flags to change). */
  readonly warnings: readonly string[]
}

export type EnterInSageInput = {
  readonly invoiceNumber: SageInvoiceNumber
  readonly billingDate: string | null
  readonly periodTo: string | null
  readonly description: string
  readonly billingCycle: string
  readonly lines: readonly BillingLineInput[]
  readonly changeOrders: readonly BillingChangeOrderPart[]
  /** Tax share of the base contract by canonical cost code. */
  readonly contractTax: ReadonlyMap<string, TaxShare>
  /** Tax share by change order id, then canonical cost code. */
  readonly changeOrderTax: ReadonlyMap<string, ReadonlyMap<string, TaxShare>>
  readonly taxDistrict: BillingTaxDistrict | null
  readonly retentionCents: number
  readonly amountDueCents: number
}

function taxability(share: TaxShare | undefined): Taxability {
  if (!share || share.taxableCents === 0 || share.totalCents === 0) return "not_taxable"
  return share.taxableCents === share.totalCents ? "taxable" : "split"
}

function taxableShareCents(cents: number, share: TaxShare | undefined): number {
  const kind = taxability(share)
  if (kind === "not_taxable" || !share) return 0
  return kind === "taxable" ? cents : Math.round((cents * share.taxableCents) / share.totalCents)
}

/** Sales tax on an amount at the district's rate, to the cent. */
function salesTaxCents(cents: number, district: BillingTaxDistrict | null): number {
  return district ? Math.round((cents * district.rateBasisPoints) / 10_000) : 0
}

/** "CO #14" or "V-006". */
function changeOrderLabel(part: Pick<BillingChangeOrderPart, "number" | "recordType">): string {
  return part.recordType === "variance" ? sageChangeOrderName(part.number, "variance") : `CO #${part.number.trim()}`
}

/** Whether a billing line's text names this change order ("CO #14", "CO 14", "V-006"). */
function namesChangeOrder(description: string, part: BillingChangeOrderPart): boolean {
  const text = description.toUpperCase()
  const raw = part.number.trim().toUpperCase().replace(/^V-?/, "")
  if (!raw) return false
  const number = escape(raw.replace(/^0+(?=.)/, ""))
  const pattern = part.recordType === "variance" ? new RegExp(`\\bV-?0*${number}\\b`) : new RegExp(`\\bC\\.?O\\.?\\s*#?\\s*0*${number}\\b`)
  return pattern.test(text)
}

function escape(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** The tax share a billing line follows: the change order its text names, else the base contract. */
function lineShare(line: BillingLineInput, code: string, input: EnterInSageInput): TaxShare | undefined {
  const part = input.changeOrders.find((candidate) => canonicalFeeCostCode(candidate.costCode.trim()) === code && namesChangeOrder(line.description, candidate))
  if (part) return input.changeOrderTax.get(part.changeOrderId)?.get(code)
  return input.contractTax.get(code)
}

/** What staff enter in Sage's progress billing before posting it. */
export function planEnterInSage(input: EnterInSageInput): EnterInSageChecklist {
  const warnings: string[] = []
  if (input.invoiceNumber.error) warnings.push(input.invoiceNumber.error)

  const lines: EnterInSageLine[] = input.lines.map((line) => {
    const code = canonicalFeeCostCode(line.costCode.trim())
    const share = lineShare(line, code, input)
    const expected = taxability(share)
    const flagDiffers = line.sageTaxable !== null && (expected === "split" || line.sageTaxable !== (expected === "taxable"))
    return { ...line, expected, taxableCents: taxableShareCents(line.thisPeriodCents, share), flagDiffers }
  })
  // A cost code Sage already has as a taxable and a non-taxable line is split.
  const splitDone = (code: string): boolean => {
    const sageFlags = new Set(lines.filter((line) => canonicalFeeCostCode(line.costCode.trim()) === code).map((line) => line.sageTaxable))
    return sageFlags.has(true) && sageFlags.has(false)
  }
  const checkedLines = lines.map((line) =>
    line.expected === "split" && splitDone(canonicalFeeCostCode(line.costCode.trim())) ? { ...line, flagDiffers: false } : line
  )

  const codesOnBilling = new Set(input.lines.map((line) => canonicalFeeCostCode(line.costCode.trim())))
  const byPart = new Map<string, BillingChangeOrderPart & { cents: number }>()
  for (const part of input.changeOrders) {
    const code = canonicalFeeCostCode(part.costCode.trim())
    const key = `${part.changeOrderId}|${code}`
    const entry = byPart.get(key) ?? { ...part, costCode: code, cents: 0 }
    entry.cents += part.amountCents
    byPart.set(key, entry)
  }
  const changeOrders: EnterInSageChangeOrder[] = [...byPart.entries()]
    .filter(([, part]) => part.cents !== 0)
    .map(([key, part]) => {
      const onBilling = input.lines.some((line) => canonicalFeeCostCode(line.costCode.trim()) === part.costCode && namesChangeOrder(line.description, part))
      const description = input.lines.find((line) => canonicalFeeCostCode(line.costCode.trim()) === part.costCode)?.description ?? part.costCode
      return {
        key,
        label: changeOrderLabel(part),
        costCode: part.costCode,
        description,
        amountCents: part.cents,
        taxability: taxability(input.changeOrderTax.get(part.changeOrderId)?.get(part.costCode)),
        placement: onBilling ? "on_billing" : codesOnBilling.has(part.costCode) ? "add_line" : "append_new_line",
      }
    })

  const thisPeriodCents = checkedLines.reduce((sum, line) => sum + line.thisPeriodCents, 0)
  const taxableLines = checkedLines.filter((line) => line.taxableCents !== 0)
  const taxableCents = taxableLines.reduce((sum, line) => sum + line.taxableCents, 0)
  // Sage taxes each taxable line; summing per-line tax matches its rounding.
  const expectedTaxCents = taxableLines.reduce((sum, line) => sum + salesTaxCents(line.taxableCents, input.taxDistrict), 0)
  const anyTaxable = checkedLines.some((line) => line.expected !== "not_taxable") || changeOrders.some((part) => part.taxability !== "not_taxable")
  if (anyTaxable && !input.taxDistrict) warnings.push("Some lines are taxable, but the estimate has no Sage tax district. Choose one on the estimate.")
  const toSplit = checkedLines.filter((line) => line.expected === "split" && line.flagDiffers)
  if (toSplit.length > 0) warnings.push(`Split into a taxable and a non-taxable line: ${toSplit.map((line) => line.description).join(", ")}.`)
  const toFlag = checkedLines.filter((line) => line.expected !== "split" && line.flagDiffers)
  if (toFlag.length > 0) {
    warnings.push(`Change the Taxable box in Sage: ${toFlag.map((line) => `${line.description} (${line.expected === "taxable" ? "taxable" : "not taxable"})`).join(", ")}.`)
  }

  return {
    invoiceNumber: input.invoiceNumber,
    billingDate: input.billingDate,
    periodTo: input.periodTo,
    description: input.description,
    billingCycle: input.billingCycle,
    taxDistrict: input.taxDistrict,
    lines: checkedLines,
    changeOrders,
    totals: {
      thisPeriodCents,
      retentionCents: input.retentionCents,
      amountDueCents: input.amountDueCents,
      taxableCents,
      expectedTaxCents,
      expectedInvoiceTotalCents: input.amountDueCents + expectedTaxCents,
    },
    warnings,
  }
}

/** The posted AR invoice as the check reads it (cents). */
export type PostedSageInvoice = {
  readonly invoiceNumber: string | null
  readonly taxDistrictCode: string | null
  readonly taxDistrictName: string | null
  readonly salesTaxCents: number
  readonly retentionCents: number
  readonly totalCents: number
}

type SageBillingFinding = { readonly key: string; readonly message: string }

export type SageBillingCheck = {
  readonly status: PayApplicationSageCheckStatus
  readonly findings: readonly SageBillingFinding[]
}

export type SageBillingCheckInput = {
  readonly checklist: EnterInSageChecklist
  /** aiafrm.status as Sage sends it: "1" Open, "2" Submitted, "3" Posted, higher after posting. */
  readonly sageStatus: string
  /** The posted invoice; null when Sage has none for the billing; undefined when the bridge is too old to read it. */
  readonly invoice: PostedSageInvoice | null | undefined
  readonly taxToleranceCentsPerLine: number
}

/** Posted means Sage created the AR invoice (status 3, or later once the invoice moves on). */
export function isPostedSageStatus(status: string): boolean {
  const code = Number(status)
  return Number.isInteger(code) && code >= 3
}

function sameDistrict(left: string, right: string): boolean {
  const a = Number(left)
  const b = Number(right)
  return Number.isFinite(a) && Number.isFinite(b) ? a === b : left.trim() === right.trim()
}

/** Compares Sage's posted invoice with what the pay request should have produced. */
export function checkSageBilling(input: SageBillingCheckInput): SageBillingCheck {
  const { checklist, invoice } = input
  if (!isPostedSageStatus(input.sageStatus)) return { status: "not_posted", findings: [] }
  if (invoice === undefined) return { status: "unavailable", findings: [] }
  const findings: SageBillingFinding[] = []
  if (invoice === null) {
    findings.push({ key: "invoice_missing", message: "Sage shows the billing as posted, but Compass can't find the AR invoice it created." })
    return { status: "needs_attention", findings }
  }

  const expectedNumber = checklist.invoiceNumber.value.trim()
  const actualNumber = invoice.invoiceNumber?.trim() ?? ""
  if (expectedNumber && actualNumber.toUpperCase() !== expectedNumber.toUpperCase()) {
    findings.push({
      key: "invoice_number",
      message: `The invoice number doesn't follow the standard: expected ${expectedNumber}, Sage has ${actualNumber || "none"}.`,
    })
  }

  for (const line of checklist.lines) {
    if (!line.flagDiffers || line.sageTaxable === null) continue
    findings.push({
      key: `taxable:${line.key}`,
      message:
        line.expected === "split"
          ? `${line.description} mixes taxable and non-taxable work in the estimate, but Sage billed it as one ${line.sageTaxable ? "taxable" : "non-taxable"} line.`
          : `${line.description} is ${line.expected === "taxable" ? "taxable" : "not taxable"} in the estimate, but Sage marked it ${line.sageTaxable ? "taxable" : "not taxable"}.`,
    })
  }

  const district = checklist.taxDistrict
  if (checklist.totals.taxableCents !== 0) {
    if (!district) {
      findings.push({ key: "district_unknown", message: "The billing has taxable lines, but the estimate has no Sage tax district to check against." })
    } else if (!invoice.taxDistrictCode) {
      findings.push({ key: "district_missing", message: `The invoice has no tax district; expected ${district.name}.` })
    } else if (!sameDistrict(invoice.taxDistrictCode, district.code)) {
      findings.push({
        key: "district",
        message: `The invoice's tax district is ${invoice.taxDistrictName ?? invoice.taxDistrictCode}; the estimate uses ${district.name}.`,
      })
    }
  }

  const taxableLineCount = checklist.lines.filter((line) => line.taxableCents !== 0).length
  const tolerance = Math.max(0, input.taxToleranceCentsPerLine) * Math.max(1, taxableLineCount)
  const taxDifference = invoice.salesTaxCents - checklist.totals.expectedTaxCents
  if (Math.abs(taxDifference) > tolerance) {
    findings.push({
      key: "sales_tax",
      message: `The invoice's sales tax is ${formatCents(invoice.salesTaxCents)}; expected ${formatCents(checklist.totals.expectedTaxCents)} (${formatCents(checklist.totals.taxableCents)} taxable${district ? ` at ${district.name}` : ""}).`,
    })
  }

  // Current payment due is net of retention, so the invoice less its retention
  // should be due plus tax. Some Sage setups store the net total itself.
  const expectedTotal = checklist.totals.amountDueCents + invoice.salesTaxCents
  const net = invoice.totalCents - invoice.retentionCents
  if (Math.abs(net - expectedTotal) > 1 && Math.abs(invoice.totalCents - expectedTotal) > 1) {
    findings.push({
      key: "total",
      message: `The invoice totals ${formatCents(invoice.totalCents)}${invoice.retentionCents ? ` less ${formatCents(invoice.retentionCents)} retention` : ""}; the G702 current payment due ${formatCents(checklist.totals.amountDueCents)} plus tax ${formatCents(invoice.salesTaxCents)} is ${formatCents(expectedTotal)}.`,
    })
  }

  return { status: findings.length > 0 ? "needs_attention" : "matches", findings }
}

/** A stable fingerprint of a check result, so Activity records each change once. */
export function sageBillingCheckFingerprint(check: SageBillingCheck): string {
  return [check.status, ...check.findings.map((finding) => `${finding.key}=${finding.message}`)].join("\n")
}

/** One line for Activity and the notification. */
export function sageBillingCheckSummary(check: SageBillingCheck, applicationNumber: string): string {
  const label = `Pay application ${applicationNumber}`
  switch (check.status) {
    case "matches":
      return `${label}: Sage's posted invoice matches.`
    case "not_posted":
      return `${label}: not posted in Sage yet.`
    case "unavailable":
      return `${label}: Sage's posted invoice can't be checked until the Sage pay request poller is updated.`
    case "needs_attention":
      return `${label}: Sage's posted invoice needs attention. ${check.findings.map((finding) => finding.message).join(" ")}`
  }
}
