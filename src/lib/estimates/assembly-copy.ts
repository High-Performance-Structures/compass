import type {
  projectEstimateLineCostItems,
  projectEstimateLines,
} from "@/db/schema-estimates"
import {
  calculateEstimateLine,
  calculateEstimateLineBreakdownRollup,
} from "@/lib/financials/estimate-ledger"

/*
 * Copying estimate assemblies into another job's estimate. Quantities, units
 * and unit costs carry over; markup is either kept or replaced with the
 * target's rate, and every price is recalculated the way the estimate page
 * does. The source job's builder fee (overhead, margin, contingency) lives on
 * its estimate header and never comes along: copied lines join the target
 * estimate's own builder fee like any new line.
 */

/** Stands for the items not in any assembly when choosing what to copy. */
export const UNASSIGNED_ITEMS = "unassigned"
export const UNASSIGNED_NAME = "Items not in an assembly"

type LineRow = typeof projectEstimateLines.$inferSelect
type CostItemRow = typeof projectEstimateLineCostItems.$inferSelect

export type CopiedLine = Omit<LineRow, "id" | "projectId" | "estimateId" | "assemblyId" | "reportPhaseId" | "createdAt" | "updatedAt">
export type CopiedCostItem = Omit<
  CostItemRow,
  "id" | "projectId" | "estimateId" | "estimateLineId" | "createdAt" | "updatedAt" | "deletedAt" | "deletedByUserId"
>

export type LineCopy = {
  readonly sourceLineId: string
  readonly line: CopiedLine
  readonly costItems: readonly CopiedCostItem[]
}

/** Percent from Settings → basis points, or null to keep the source markup. */
export function markupBasisPoints(percent: number | null | undefined): number | null {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return null
  return Math.round(Math.min(1000, Math.max(0, percent)) * 100)
}

function repricedCostItem(item: CostItemRow, markup: number | null): CopiedCostItem {
  const markupRateBasisPoints = markup ?? item.markupRateBasisPoints
  const calculation = calculateEstimateLine({
    quantity: item.quantity,
    unitCostCents: item.unitCostCents,
    markupRateBasisPoints,
    taxable: item.taxable,
    taxRateBasisPoints: item.taxRateBasisPoints,
  })
  return {
    divisionCode: item.divisionCode,
    divisionName: item.divisionName,
    costCode: item.costCode,
    costCodeName: item.costCodeName,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unitCostCents: item.unitCostCents,
    markupRateBasisPoints,
    taxable: item.taxable,
    taxEntityId: item.taxEntityId,
    taxCode: item.taxCode,
    taxName: item.taxName,
    taxRateBasisPoints: item.taxRateBasisPoints,
    ...calculation,
    totalCostCents: calculation.lineTotalCents,
    sortOrder: item.sortOrder,
    rateBookEntryId: item.rateBookEntryId,
    rateBookVersion: item.rateBookVersion,
  }
}

/**
 * The lines (and cost breakdowns) to insert in the target estimate, priced at
 * `markup` basis points or at their own markup when it is null. `sortOffset`
 * places them after the target's existing lines.
 */
export function copyEstimateLines(input: {
  readonly lines: readonly LineRow[]
  readonly costItems: readonly CostItemRow[]
  readonly markup: number | null
  readonly sortOffset: number
}): readonly LineCopy[] {
  return input.lines.map((line) => {
    const items = input.costItems
      .filter((item) => item.estimateLineId === line.id && item.deletedAt === null)
      .map((item) => repricedCostItem(item, input.markup))
    const markupRateBasisPoints = input.markup ?? line.markupRateBasisPoints
    const base = {
      templateLineId: line.templateLineId,
      divisionCode: line.divisionCode,
      divisionName: line.divisionName,
      costCode: line.costCode,
      costCodeName: line.costCodeName,
      description: line.description,
      specifications: line.specifications,
      taxable: line.taxable,
      taxEntityId: line.taxEntityId,
      taxCode: line.taxCode,
      taxName: line.taxName,
      taxRateBasisPoints: line.taxRateBasisPoints,
      ownerVisible: line.ownerVisible,
      includeInBuilderFee: true,
      sortOrder: line.sortOrder + input.sortOffset,
    }
    if (items.length > 0) {
      // A line with a cost breakdown is the sum of its items, as on the estimate page.
      const rollup = calculateEstimateLineBreakdownRollup(items)
      return {
        sourceLineId: line.id,
        line: { ...base, quantity: 1, unit: "assembly", unitCostCents: rollup.directCostCents, ...rollup },
        costItems: items,
      }
    }
    const calculation = calculateEstimateLine({
      quantity: line.quantity,
      unitCostCents: line.unitCostCents,
      markupRateBasisPoints,
      taxable: line.taxable,
      taxRateBasisPoints: line.taxRateBasisPoints,
    })
    return {
      sourceLineId: line.id,
      line: { ...base, quantity: line.quantity, unit: line.unit, unitCostCents: line.unitCostCents, markupRateBasisPoints, ...calculation },
      costItems: [],
    }
  })
}
