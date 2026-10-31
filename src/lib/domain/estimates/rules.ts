/*
 * Estimate money rules: line, cost-item and builder-fee math and the
 * estimate status list. Pure functions with no database or network access
 * (architecture standard, sections 1 and 5). The server computes every
 * stored total with these, and the browser previews with the same ones.
 */
const ESTIMATE_STATUSES = [
  "draft",
  "internal_review",
  "signature_pending",
  "accepted",
  "superseded",
  "void",
] as const

export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number]

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
  return ESTIMATE_STATUSES.some((status) => status === value)
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
