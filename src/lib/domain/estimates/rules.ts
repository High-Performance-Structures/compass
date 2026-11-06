/*
 * Estimate money rules: line, cost-item and builder-fee math and the
 * estimate status list. Pure functions with no database or network access
 * (architecture standard, sections 1 and 5). The server computes every
 * stored total with these, and the browser previews with the same ones.
 */

import { ESTIMATE_STATUSES, type EstimateStatus } from "@/lib/domain/estimates/statuses"
import { cleanText } from "@/lib/shared/guards"
import { isListValue } from "@/lib/shared/statuses"

export type { EstimateStatus }

export type EstimateLineCalculationInput = {
  readonly quantity: number
  readonly unitCostCents: number
  readonly markupRateBasisPoints: number
  readonly taxable: boolean
  readonly taxRateBasisPoints: number
}

export type EstimateLineCalculation = {
  readonly directCostCents: number
  readonly markupCents: number
  readonly taxCents: number
  readonly lineTotalCents: number
}

export type EstimateLineCostItemInput = {
  readonly quantity: number
  readonly unitCostCents: number
}

export type EstimateLineBreakdownItem = EstimateLineCalculation & {
  readonly markupRateBasisPoints: number
  readonly taxable: boolean
  readonly taxEntityId: string | null
  readonly taxCode: string | null
  readonly taxName: string | null
  readonly taxRateBasisPoints: number
}

export type EstimateLineBreakdownRollup = EstimateLineCalculation & {
  readonly markupRateBasisPoints: number
  readonly taxable: boolean
  readonly taxEntityId: string | null
  readonly taxCode: string | null
  readonly taxName: string | null
  readonly taxRateBasisPoints: number
}

export type EstimateLedgerLine = EstimateLineCalculation & {
  readonly id: string | null
  readonly divisionCode: string
  readonly divisionName: string
  readonly costCode: string
  readonly description: string
  readonly ownerVisible: boolean
  readonly includeInBuilderFee: boolean
  readonly sortOrder: number
}

export type EstimateBuilderFeeRates = {
  readonly overheadRateBasisPoints: number
  readonly marginRateBasisPoints: number
  readonly contingencyRateBasisPoints: number
}

export type EstimateLedgerTotals = {
  readonly directCostCents: number
  readonly markupCents: number
  readonly taxCents: number
  readonly builderFeeBaseCents: number
  readonly overheadCents: number
  readonly marginCents: number
  readonly contingencyCents: number
  readonly builderFeeCents: number
  readonly estimateTotalCents: number
}

function safeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value)
}

function safeRate(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1_000_000, Math.max(0, value))
}

export function calculateEstimateLine(
  input: EstimateLineCalculationInput
): EstimateLineCalculation {
  const quantity = Number.isFinite(input.quantity)
    ? Math.max(0, input.quantity)
    : 0
  const unitCostCents = Math.max(0, safeInteger(input.unitCostCents))
  const markupRate = safeRate(input.markupRateBasisPoints)
  const taxRate = safeRate(input.taxRateBasisPoints)
  const directCostCents = safeInteger(quantity * unitCostCents)
  const markupCents = safeInteger(
    (directCostCents * markupRate) / 10_000
  )
  const taxableSubtotal = directCostCents + markupCents
  const taxCents = input.taxable
    ? safeInteger((taxableSubtotal * taxRate) / 10_000)
    : 0

  return {
    directCostCents,
    markupCents,
    taxCents,
    lineTotalCents: taxableSubtotal + taxCents,
  }
}

export function calculateEstimateLineCostItemTotal(
  input: EstimateLineCostItemInput
): number {
  const quantity = Number.isFinite(input.quantity)
    ? Math.max(0, input.quantity)
    : 0
  const unitCostCents = Math.max(0, safeInteger(input.unitCostCents))
  return safeInteger(quantity * unitCostCents)
}

export function calculateEstimateLineBreakdownSubtotal(
  items: readonly EstimateLineCostItemInput[]
): number {
  return items.reduce(
    (total, item) => total + calculateEstimateLineCostItemTotal(item),
    0
  )
}

export function calculateEstimateLineBreakdownRollup(
  items: readonly EstimateLineBreakdownItem[]
): EstimateLineBreakdownRollup {
  const firstItem = items[0]
  const commonMarkupRate = firstItem
    ? items.every(
        (item) =>
          item.markupRateBasisPoints === firstItem.markupRateBasisPoints
      )
      ? firstItem.markupRateBasisPoints
      : 0
    : 0
  const taxableItems = items.filter((item) => item.taxable)
  const firstTaxableItem = taxableItems[0]
  const commonTaxEntity = firstTaxableItem
    ? taxableItems.every(
        (item) =>
          item.taxEntityId === firstTaxableItem.taxEntityId &&
          item.taxCode === firstTaxableItem.taxCode &&
          item.taxName === firstTaxableItem.taxName &&
          item.taxRateBasisPoints === firstTaxableItem.taxRateBasisPoints
      )
    : false

  return {
    directCostCents: items.reduce(
      (total, item) => total + item.directCostCents,
      0
    ),
    markupRateBasisPoints: commonMarkupRate,
    markupCents: items.reduce((total, item) => total + item.markupCents, 0),
    taxable: taxableItems.length > 0,
    taxEntityId: commonTaxEntity ? firstTaxableItem?.taxEntityId ?? null : null,
    taxCode: commonTaxEntity ? firstTaxableItem?.taxCode ?? null : null,
    taxName: commonTaxEntity ? firstTaxableItem?.taxName ?? null : null,
    taxRateBasisPoints: commonTaxEntity
      ? firstTaxableItem?.taxRateBasisPoints ?? 0
      : 0,
    taxCents: items.reduce((total, item) => total + item.taxCents, 0),
    lineTotalCents: items.reduce(
      (total, item) => total + item.lineTotalCents,
      0
    ),
  }
}

export function calculateEstimateTotals(
  lines: readonly EstimateLedgerLine[],
  builderFeeRates: EstimateBuilderFeeRates = {
    overheadRateBasisPoints: 0,
    marginRateBasisPoints: 0,
    contingencyRateBasisPoints: 0,
  }
): EstimateLedgerTotals {
  const lineTotals = lines.reduce(
    (totals, line) => ({
      directCostCents: totals.directCostCents + line.directCostCents,
      markupCents: totals.markupCents + line.markupCents,
      taxCents: totals.taxCents + line.taxCents,
      lineTotalCents: totals.lineTotalCents + line.lineTotalCents,
      builderFeeBaseCents:
        totals.builderFeeBaseCents +
        (line.includeInBuilderFee ? line.lineTotalCents : 0),
    }),
    {
      directCostCents: 0,
      markupCents: 0,
      taxCents: 0,
      lineTotalCents: 0,
      builderFeeBaseCents: 0,
    }
  )
  const overheadCents = safeInteger(
    (lineTotals.builderFeeBaseCents *
      safeRate(builderFeeRates.overheadRateBasisPoints)) /
      10_000
  )
  const marginCents = safeInteger(
    (lineTotals.builderFeeBaseCents *
      safeRate(builderFeeRates.marginRateBasisPoints)) /
      10_000
  )
  const contingencyCents = safeInteger(
    (lineTotals.builderFeeBaseCents *
      safeRate(builderFeeRates.contingencyRateBasisPoints)) /
      10_000
  )
  const builderFeeCents = overheadCents + marginCents + contingencyCents

  return {
    directCostCents: lineTotals.directCostCents,
    markupCents: lineTotals.markupCents,
    taxCents: lineTotals.taxCents,
    builderFeeBaseCents: lineTotals.builderFeeBaseCents,
    overheadCents,
    marginCents,
    contingencyCents,
    builderFeeCents,
    estimateTotalCents: lineTotals.lineTotalCents + builderFeeCents,
  }
}

export function isEstimateStatus(value: string): value is EstimateStatus {
  return isListValue(ESTIMATE_STATUSES, value)
}

export function estimateCanBeEdited(status: EstimateStatus): boolean {
  return status === "draft" || status === "internal_review"
}

export function estimateCanBeAccepted(input: {
  readonly status: EstimateStatus
  readonly foxitStatus: string
  readonly lineCount: number
}): boolean {
  return (
    input.status === "signature_pending" &&
    input.foxitStatus === "completed" &&
    input.lineCount > 0
  )
}

/** The stored line fields the estimate totals read. */
export type EstimateLedgerSourceLine = Omit<EstimateLedgerLine, "id"> & { readonly id: string | null }

/** A saved estimate line as the totals see it. */
export function ledgerLine(row: EstimateLedgerSourceLine): EstimateLedgerLine {
  return {
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
  }
}

/** An estimate's saved totals for its lines at its builder-fee rates. */
export function estimateTotalsForLines(
  estimate: EstimateBuilderFeeRates,
  rows: readonly EstimateLedgerSourceLine[]
): EstimateLedgerTotals {
  return calculateEstimateTotals(rows.map(ledgerLine), estimate)
}

// ---- Input validation shared by the estimate actions. Messages are shown to users.

export function requiredText(value: string | null, label: string): string {
  const cleaned = cleanText(value)
  if (!cleaned) throw new Error(`${label} is required.`)
  return cleaned
}

/** A percentage typed by staff as basis points (0% to 10,000%). */
export function rateBasisPoints(value: number | null, label: string): number {
  const basisPoints = Math.round((value ?? 0) * 100)
  if (
    !Number.isFinite(value ?? 0) ||
    basisPoints < 0 ||
    basisPoints > 1_000_000
  ) {
    throw new Error(`${label} must be between 0% and 10,000%.`)
  }
  return basisPoints
}

export function safeUrl(value: string | null): string | null {
  const cleaned = cleanText(value)
  if (!cleaned) return null
  try {
    const url = new URL(cleaned)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    return url.toString()
  } catch {
    return null
  }
}

export function safeEvidenceUrl(value: string | null): string | null {
  const url = safeUrl(value)
  if (!url) return null
  return new URL(url).protocol === "https:" ? url : null
}

export function limitedText(
  value: string | null,
  label: string,
  maxLength: number,
  required = false
): string | null {
  const cleaned = cleanText(value)
  if (!cleaned) {
    if (required) throw new Error(`${label} is required.`)
    return null
  }
  if (cleaned.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`)
  }
  return cleaned
}

export function signerInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 6)
    .toUpperCase()
}

// ---- PlanSwift import pricing. The review table previews with the same
// functions the server uses to price and store the imported lines.

/** A PlanSwift row's amount for a quantity, unit cost and markup, in dollars. */
export function planSwiftAmountDollars(quantity: number, unitCost: number, markupPercentage: number): number {
  return Math.round(quantity * unitCost * (1 + markupPercentage / 100) * 100) / 100
}

/** The unit cost, in dollars, that gives a PlanSwift row its amount after markup. */
export function planSwiftUnitCostDollars(amount: number, quantity: number, markupPercentage: number): number {
  return Math.round((amount / quantity / (1 + markupPercentage / 100)) * 100) / 100
}

export type PlanSwiftPricingInput = {
  readonly rowNumber: number
  readonly quantity: number | null
  readonly unitCost: number | null
  readonly markupPercentage: number
  readonly amount: number
}

export type PlanSwiftLinePricing = EstimateLineCalculation & {
  readonly rowNumber: number
  readonly quantity: number
  readonly unitCostCents: number
  readonly markupRateBasisPoints: number
}

/**
 * Validates one PlanSwift row and prices it from its quantity, unit cost and
 * markup. Without a unit cost, the unit cost comes from the row's amount
 * before markup. The stored amounts are always computed here, never taken
 * from the browser.
 */
export function planSwiftLinePricing(line: PlanSwiftPricingInput): PlanSwiftLinePricing {
  const rowNumber = Math.round(line.rowNumber)
  const amountCents = Math.round(line.amount * 100)
  if (!Number.isFinite(line.rowNumber) || rowNumber < 1) {
    throw new Error("Every imported row must have a valid source row number.")
  }
  if (!Number.isFinite(line.amount) || amountCents <= 0) {
    throw new Error(`PlanSwift row ${rowNumber} must have a positive amount.`)
  }
  if (amountCents > 10_000_000_000) {
    throw new Error(`PlanSwift row ${rowNumber} exceeds the import amount limit.`)
  }
  const quantity = line.quantity ?? 1
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`PlanSwift row ${rowNumber} must have a positive quantity.`)
  }
  const markupRateBasisPoints = Math.round(line.markupPercentage * 100)
  if (
    !Number.isFinite(line.markupPercentage) ||
    markupRateBasisPoints < 0 ||
    markupRateBasisPoints > 1_000_000
  ) {
    throw new Error(`PlanSwift row ${rowNumber} has an invalid markup.`)
  }
  const unitCostCents =
    line.unitCost !== null && line.unitCost > 0
      ? Math.round(line.unitCost * 100)
      : Math.round(amountCents / quantity / (1 + line.markupPercentage / 100))
  if (!Number.isFinite(unitCostCents) || unitCostCents <= 0) {
    throw new Error(`PlanSwift row ${rowNumber} must have a positive unit cost.`)
  }
  return {
    rowNumber,
    quantity,
    unitCostCents,
    markupRateBasisPoints,
    ...calculateEstimateLine({
      quantity,
      unitCostCents,
      markupRateBasisPoints,
      taxable: false,
      taxRateBasisPoints: 0,
    }),
  }
}

// ---- Applying one markup rate to an estimate.

/** A saved line or cost item, as repricing reads it. */
export type RepriceSource = {
  readonly id: string
  readonly quantity: number
  readonly unitCostCents: number
  readonly taxable: boolean
  readonly taxEntityId: string | null
  readonly taxCode: string | null
  readonly taxName: string | null
  readonly taxRateBasisPoints: number
}

export type RepricedRow = EstimateLineCalculation & {
  readonly id: string
  readonly markupRateBasisPoints: number
}

/** A line's or cost item's amounts at a new markup rate; tax settings stay. */
export function repriceAtMarkup(row: RepriceSource, markupRateBasisPoints: number): RepricedRow {
  return {
    id: row.id,
    markupRateBasisPoints,
    ...calculateEstimateLine({
      quantity: row.quantity,
      unitCostCents: row.unitCostCents,
      markupRateBasisPoints,
      taxable: row.taxable,
      taxRateBasisPoints: row.taxRateBasisPoints,
    }),
  }
}

/** A repriced cost item as the line roll-up reads it once it is saved. */
export function repricedBreakdownItem(item: RepriceSource, repriced: RepricedRow): EstimateLineBreakdownItem {
  return {
    directCostCents: repriced.directCostCents,
    markupRateBasisPoints: repriced.markupRateBasisPoints,
    markupCents: repriced.markupCents,
    taxable: item.taxable,
    taxEntityId: item.taxEntityId,
    taxCode: item.taxCode,
    taxName: item.taxName,
    taxRateBasisPoints: item.taxRateBasisPoints,
    taxCents: repriced.taxCents,
    lineTotalCents: repriced.lineTotalCents,
  }
}

// ---- completing an imported executed change order

export type ChangeOrderCompletionState = {
  readonly status: string
  readonly sourceType: string
  readonly budgetTreatment: string
  readonly kind: string | null
  readonly executedAt: string | null
  readonly lines: readonly { readonly costCode: string | null; readonly amountCents: number | null }[]
}

const EXECUTED_CHANGE_ORDER_STATUSES: readonly string[] = ["executed", "sage_pending", "synced"]
const FINISHED_CHANGE_ORDER_STATUSES: readonly string[] = ["closed", "void", "declined"]

export function isExecutedForCompletion(status: string): boolean {
  return EXECUTED_CHANGE_ORDER_STATUSES.includes(status)
}

/**
 * A change order whose lines can't revise the G703: no lines, or a line
 * without a cost code or amount. Imported history (Buildertrend) arrives this
 * way; Compass-made ones never do. An executed one also needs its execution
 * date; an imported one still open needs its lines coded before it can be
 * executed the usual way.
 */
export function changeOrderNeedsCompletion(changeOrder: ChangeOrderCompletionState): boolean {
  if (changeOrder.budgetTreatment !== "additive" || changeOrder.kind === "description") return false
  const uncodedLines =
    changeOrder.lines.length === 0 ||
    changeOrder.lines.some((line) => !line.costCode || line.amountCents === null)
  if (isExecutedForCompletion(changeOrder.status)) return uncodedLines || !changeOrder.executedAt
  if (FINISHED_CHANGE_ORDER_STATUSES.includes(changeOrder.status)) return false
  return changeOrder.sourceType === "buildertrend_import" && changeOrder.kind === null && uncodedLines
}

/** The change-order view fields for completing one; `canComplete` is the viewer's approval right. */
export function changeOrderCompletionView(
  changeOrder: ChangeOrderCompletionState,
  canComplete: boolean
): { readonly executedAt: string | null; readonly canCompleteCostCodes: boolean } {
  return {
    executedAt: changeOrder.executedAt,
    canCompleteCostCodes: canComplete && changeOrderNeedsCompletion(changeOrder),
  }
}

export type ChangeOrderCompletionLineInput = {
  readonly costCode: string
  readonly description: string
  readonly amountCents: number
}

export type ChangeOrderCompletionPlan =
  | {
      readonly success: true
      /** Null for a change order that isn't executed yet. */
      readonly executedOn: string | null
      readonly reason: string
      readonly lines: readonly ChangeOrderCompletionLineInput[]
    }
  | { readonly success: false; readonly error: string }

const MAX_COMPLETION_LINES = 100

/**
 * Checks staff's cost-code split of an executed change order. The lines must
 * add up to the change order's recorded amount to the cent, because that
 * amount is what the owner signed; only how it lands on the G703 is new.
 */
export function planChangeOrderCompletion(input: {
  readonly amountCents: number | null
  readonly allowedCostCodes: ReadonlySet<string>
  readonly lines: readonly ChangeOrderCompletionLineInput[]
  /** Null when the change order isn't executed yet, so it has no date. */
  readonly executedOn: string | null
  readonly reason: string
  readonly today: string
}): ChangeOrderCompletionPlan {
  if (input.amountCents === null) {
    return { success: false, error: "Record the change order's amount before splitting it by cost code." }
  }
  if (input.lines.length === 0) return { success: false, error: "Add at least one cost-coded line." }
  if (input.lines.length > MAX_COMPLETION_LINES) {
    return { success: false, error: `Use ${MAX_COMPLETION_LINES} lines or fewer.` }
  }
  const lines: ChangeOrderCompletionLineInput[] = []
  for (const [index, line] of input.lines.entries()) {
    const label = `Line ${index + 1}`
    const costCode = cleanText(line.costCode)
    if (!costCode || !input.allowedCostCodes.has(costCode)) {
      return { success: false, error: `${label}: choose a cost code from this job's list.` }
    }
    const description = cleanText(line.description) ?? ""
    if (!description) return { success: false, error: `${label}: add a description.` }
    if (description.length > 500) return { success: false, error: `${label}: keep the description to 500 characters.` }
    if (!Number.isSafeInteger(line.amountCents)) return { success: false, error: `${label}: enter a dollar amount.` }
    lines.push({ costCode, description, amountCents: line.amountCents })
  }
  const totalCents = lines.reduce((sum, line) => sum + line.amountCents, 0)
  if (totalCents !== input.amountCents) {
    return {
      success: false,
      error: `The lines total ${centsLabel(totalCents)}; they must equal the change order's ${centsLabel(input.amountCents)}.`,
    }
  }
  const executedOn = input.executedOn === null ? null : input.executedOn.trim()
  if (executedOn !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(executedOn) || Number.isNaN(Date.parse(`${executedOn}T00:00:00Z`))) {
      return { success: false, error: "Enter the date the change order was executed." }
    }
    if (executedOn > input.today) return { success: false, error: "The execution date can't be in the future." }
  }
  const reason = cleanText(input.reason) ?? ""
  if (!reason) return { success: false, error: "Say where the cost-code split comes from." }
  if (reason.length > 1_000) return { success: false, error: "Keep the reason to 1,000 characters." }
  return { success: true, executedOn, reason, lines }
}

function centsLabel(cents: number): string {
  const sign = cents < 0 ? "-" : ""
  const absolute = Math.abs(cents)
  return `${sign}$${Math.floor(absolute / 100).toLocaleString("en-US")}.${String(absolute % 100).padStart(2, "0")}`
}
