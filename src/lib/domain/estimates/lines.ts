import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm"

import {
  projectEstimateAssemblies,
  projectEstimateLineCostItems,
  projectEstimateLines,
  projectEstimateReportPhases,
  projectEstimates,
  sageTaxEntities,
} from "@/db/schema-estimates"
import { loadProjectCostCodeCatalog } from "@/lib/cost-codes/catalog-server"
import type { CompassDb, EstimateAccess } from "@/lib/domain/estimates/access"
import {
  calculateEstimateLine,
  calculateEstimateLineBreakdownRollup,
  calculateEstimateTotals,
  ledgerLine,
  rateBasisPoints,
  repriceAtMarkup,
  repricedBreakdownItem,
  requiredText,
  type EstimateLineBreakdownItem,
} from "@/lib/domain/estimates/rules"
import {
  deleteEstimateLines,
  insertEstimateLine,
  lineMarkupStatements,
  updateEstimateLines,
  updateEstimateLinesStatement,
  updateEstimates,
} from "@/lib/domain/estimates/store"
import type { ProjectEstimateBuilderFeeInput, ProjectEstimateLineInput } from "@/lib/domain/estimates/types"
import { findPricingSource, type PricingSource } from "@/lib/estimates/pricing-sources"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { CONTRACT_ADJUSTMENT_COST_CODES } from "@/lib/financials/project-totals-import"
import { chunkD1Values } from "@/lib/d1-query"
import { cleanText } from "@/lib/shared/guards"

/**
 * Estimate lines, their roll-up from cost items, markup and the builder fee.
 * Every stored amount is computed here with the rules in rules.ts. Callers
 * check access and that the estimate is editable first.
 */

type EstimateRow = typeof projectEstimates.$inferSelect

/** Recomputes and saves the estimate's totals from its saved lines. */
export async function refreshEstimateTotals(db: CompassDb, estimateId: string, now: string): Promise<void> {
  const [rows, estimateRows] = await Promise.all([
    db.select().from(projectEstimateLines).where(eq(projectEstimateLines.estimateId, estimateId)),
    db
      .select({
        overheadRateBasisPoints: projectEstimates.overheadRateBasisPoints,
        marginRateBasisPoints: projectEstimates.marginRateBasisPoints,
        contingencyRateBasisPoints: projectEstimates.contingencyRateBasisPoints,
      })
      .from(projectEstimates)
      .where(eq(projectEstimates.id, estimateId))
      .limit(1),
  ])
  const rates = estimateRows[0]
  if (!rates) throw new Error("Estimate not found.")
  const totals = calculateEstimateTotals(rows.map(ledgerLine), rates)
  await updateEstimates(db, eq(projectEstimates.id, estimateId), { ...totals, updatedAt: now })
}

const breakdownColumns = {
  directCostCents: projectEstimateLineCostItems.directCostCents,
  markupRateBasisPoints: projectEstimateLineCostItems.markupRateBasisPoints,
  markupCents: projectEstimateLineCostItems.markupCents,
  taxable: projectEstimateLineCostItems.taxable,
  taxEntityId: projectEstimateLineCostItems.taxEntityId,
  taxCode: projectEstimateLineCostItems.taxCode,
  taxName: projectEstimateLineCostItems.taxName,
  taxRateBasisPoints: projectEstimateLineCostItems.taxRateBasisPoints,
  taxCents: projectEstimateLineCostItems.taxCents,
  lineTotalCents: projectEstimateLineCostItems.lineTotalCents,
}

/** A line's saved amounts from its cost items (or a plain line when none are left). */
function lineRollupPatch(
  line: Pick<typeof projectEstimateLines.$inferSelect, "directCostCents">,
  costItems: readonly EstimateLineBreakdownItem[],
  now: string
): Parameters<typeof updateEstimateLines>[2] {
  if (costItems.length === 0) {
    return { quantity: 1, unit: "LS", unitCostCents: line.directCostCents, updatedAt: now }
  }
  const calculation = calculateEstimateLineBreakdownRollup(costItems)
  return {
    quantity: 1,
    unit: "assembly",
    unitCostCents: calculation.directCostCents,
    ...calculation,
    updatedAt: now,
  }
}

/** Rolls a line's cost items up into the line. */
export async function refreshEstimateLineFromCostItems(
  db: CompassDb,
  estimateId: string,
  lineId: string,
  now: string
): Promise<void> {
  const [lineRows, costItems] = await Promise.all([
    db
      .select()
      .from(projectEstimateLines)
      .where(and(eq(projectEstimateLines.id, lineId), eq(projectEstimateLines.estimateId, estimateId)))
      .limit(1),
    db
      .select(breakdownColumns)
      .from(projectEstimateLineCostItems)
      .where(
        and(
          eq(projectEstimateLineCostItems.estimateId, estimateId),
          eq(projectEstimateLineCostItems.estimateLineId, lineId),
          isNull(projectEstimateLineCostItems.deletedAt)
        )
      ),
  ])
  const line = lineRows[0]
  if (!line) throw new Error("Estimate line not found.")
  await updateEstimateLines(db, eq(projectEstimateLines.id, lineId), lineRollupPatch(line, costItems, now))
}

type LinePricingChoice =
  | { readonly kind: "keep" }
  | { readonly kind: "clear" }
  | { readonly kind: "set"; readonly source: PricingSource }

async function resolveLinePricingSource(
  db: CompassDb,
  organizationId: string | null,
  id: string | null | undefined
): Promise<LinePricingChoice> {
  if (id === undefined) return { kind: "keep" }
  if (id === null || id === "") return { kind: "clear" }
  if (!organizationId) throw new Error("The project organization is required to choose who prices a line.")
  const settings = await readFeatureSettings(db, organizationId, "estimate-pricing")
  const source = findPricingSource(settings.sources, id)
  if (!source) throw new Error("That \"Priced by\" choice is no longer available. Choose another one.")
  return { kind: "set", source }
}

/** Saves a new or changed line, priced on the server, and the estimate's totals. Returns the line id. */
export async function saveEstimateLine(
  access: EstimateAccess,
  projectId: string,
  estimate: EstimateRow,
  lineId: string | null,
  input: ProjectEstimateLineInput
): Promise<string> {
  const estimateId = estimate.id
  if (input.assemblyId) {
    const assembly = await access.db.select({ id: projectEstimateAssemblies.id })
      .from(projectEstimateAssemblies).where(and(
        eq(projectEstimateAssemblies.id, input.assemblyId),
        eq(projectEstimateAssemblies.estimateId, estimateId))).limit(1)
    if (!assembly[0]) throw new Error("Choose an assembly from this estimate.")
  }
  const costCode = requiredText(input.costCode, "Cost code")
  const costRows = await loadProjectCostCodeCatalog(access.db)
  const cost = costRows.find((row) => row.code === costCode)
  if (!cost) {
    throw new Error("Choose a verified CSI/Sage catalog cost code.")
  }
  const reportPhaseId = cleanText(input.reportPhaseId)
  if (reportPhaseId) {
    const [phase] = await access.db.select({ id: projectEstimateReportPhases.id })
      .from(projectEstimateReportPhases)
      .where(and(
        eq(projectEstimateReportPhases.id, reportPhaseId),
        eq(projectEstimateReportPhases.projectId, projectId),
        eq(projectEstimateReportPhases.estimateId, estimateId),
        eq(projectEstimateReportPhases.divisionCode, cost.divisionCode)
      )).limit(1)
    if (!phase) throw new Error("Choose a report phase belonging to this estimate and CSI division.")
  }
  const existingRows = lineId
    ? await access.db
        .select({ id: projectEstimateLines.id })
        .from(projectEstimateLines)
        .where(and(eq(projectEstimateLines.id, lineId), eq(projectEstimateLines.estimateId, estimateId)))
        .limit(1)
    : []
  const existing = existingRows[0]
  if (lineId && !existing) throw new Error("Estimate line not found.")
  const breakdownRows = lineId
    ? await access.db
        .select(breakdownColumns)
        .from(projectEstimateLineCostItems)
        .where(and(eq(projectEstimateLineCostItems.estimateLineId, lineId), isNull(projectEstimateLineCostItems.deletedAt)))
    : []
  const usesCostBreakdown = breakdownRows.length > 0
  const breakdownRollup = usesCostBreakdown ? calculateEstimateLineBreakdownRollup(breakdownRows) : null
  const taxEntityId = usesCostBreakdown ? null : cleanText(input.taxEntityId) ?? estimate.defaultTaxEntityId
  const taxRows = taxEntityId
    ? await access.db
        .select()
        .from(sageTaxEntities)
        .where(and(eq(sageTaxEntities.id, taxEntityId), eq(sageTaxEntities.active, true)))
        .limit(1)
    : []
  const tax = taxRows[0]
  if (!usesCostBreakdown && input.taxable && !tax) {
    throw new Error("Choose the Sage tax entity for a taxable line.")
  }
  const quantity = usesCostBreakdown ? 1 : input.quantity ?? 1
  const unitCostCents = usesCostBreakdown
    ? breakdownRollup?.directCostCents ?? 0
    : Math.round((input.unitCost ?? 0) * 100)
  const markupRateBasisPoints = usesCostBreakdown
    ? breakdownRollup?.markupRateBasisPoints ?? 0
    : rateBasisPoints(input.markupPercent, "Line markup")
  const calculation =
    breakdownRollup ??
    calculateEstimateLine({
      quantity,
      unitCostCents,
      markupRateBasisPoints,
      taxable: input.taxable,
      taxRateBasisPoints: tax?.rateBasisPoints ?? 0,
    })
  const pricing = await resolveLinePricingSource(access.db, access.organizationId, input.pricingSource)
  // A line waiting on a quote, the owner or a takeoff can be saved at $0.
  const awaitingPrice = pricing.kind === "set" && calculation.lineTotalCents === 0
  if (calculation.lineTotalCents <= 0 && !awaitingPrice) {
    throw new Error("Enter a quantity and unit cost greater than zero, or choose who prices this line.")
  }
  const ownerScope = pricing.kind === "set" && pricing.source.ownerScope
  if (ownerScope && usesCostBreakdown && breakdownRollup?.taxable) {
    throw new Error("Owner-scope lines aren't taxed. Turn off tax on this line's cost items first.")
  }
  const now = new Date().toISOString()
  const id = lineId ?? crypto.randomUUID()
  const prior = lineId
    ? []
    : await access.db
        .select({ id: projectEstimateLines.id, sortOrder: projectEstimateLines.sortOrder })
        .from(projectEstimateLines)
        .where(eq(projectEstimateLines.estimateId, estimateId))
        .orderBy(desc(projectEstimateLines.sortOrder))
  const values = {
    assemblyId: input.assemblyId,
    reportPhaseId,
    divisionCode: cost.divisionCode,
    divisionName: cost.divisionDescription,
    costCode: cost.code,
    costCodeName: cost.description,
    description: requiredText(input.description, "Description"),
    specifications: cleanText(input.specifications),
    quantity,
    unit: usesCostBreakdown ? "assembly" : cleanText(input.unit) ?? "LS",
    unitCostCents,
    ...calculation,
    markupRateBasisPoints,
    taxable: breakdownRollup?.taxable ?? input.taxable,
    taxEntityId: breakdownRollup?.taxEntityId ?? tax?.id ?? null,
    taxCode: breakdownRollup?.taxCode ?? tax?.code ?? null,
    taxName: breakdownRollup?.taxName ?? tax?.name ?? null,
    taxRateBasisPoints: breakdownRollup?.taxRateBasisPoints ?? tax?.rateBasisPoints ?? 0,
    ownerVisible: input.ownerVisible,
    // Owner scope is the owner's number: no builder fee and no sales tax.
    includeInBuilderFee: ownerScope ? false : input.includeInBuilderFee,
    ...(ownerScope && !usesCostBreakdown
      ? { taxable: false, taxEntityId: null, taxCode: null, taxName: null, taxRateBasisPoints: 0, ...calculateEstimateLine({ quantity, unitCostCents, markupRateBasisPoints, taxable: false, taxRateBasisPoints: 0 }) }
      : {}),
    ...(pricing.kind === "keep" ? {} : { pricingSource: pricing.kind === "set" ? pricing.source.id : null }),
    updatedAt: now,
  }
  if (lineId) {
    await updateEstimateLines(access.db, eq(projectEstimateLines.id, lineId), values)
  } else {
    const insertionTarget = input.insertAfterLineId
      ? prior.find((item) => item.id === input.insertAfterLineId)
      : null
    if (input.insertAfterLineId && !insertionTarget) {
      throw new Error("The selected insertion point is no longer available.")
    }
    const sortOrder = insertionTarget ? insertionTarget.sortOrder + 1 : (prior[0]?.sortOrder ?? 0) + 1
    if (insertionTarget) {
      await updateEstimateLines(
        access.db,
        and(eq(projectEstimateLines.estimateId, estimateId), gt(projectEstimateLines.sortOrder, insertionTarget.sortOrder)),
        { sortOrder: sql`${projectEstimateLines.sortOrder} + 1`, updatedAt: now }
      )
    }
    await insertEstimateLine(access.db, {
      id,
      projectId,
      estimateId,
      ...values,
      sortOrder,
      createdAt: now,
    })
  }
  await refreshEstimateTotals(access.db, estimateId, now)
  return id
}

/**
 * Applies one markup rate to every CSI line and cost item (not the legacy
 * Division 99 fee lines), then rolls breakdown lines up and refreshes totals.
 */
export async function applyEstimateLineMarkup(
  access: EstimateAccess,
  projectId: string,
  estimateId: string,
  markupPercent: number | null
): Promise<void> {
  const markupRateBasisPoints = rateBasisPoints(markupPercent, "Line markup")
  const rows = await access.db.select().from(projectEstimateLines).where(eq(projectEstimateLines.estimateId, estimateId))
  if (rows.length === 0) throw new Error("Add an estimate line first.")
  const costItems = await access.db
    .select()
    .from(projectEstimateLineCostItems)
    .where(and(eq(projectEstimateLineCostItems.estimateId, estimateId), isNull(projectEstimateLineCostItems.deletedAt)))

  const now = new Date().toISOString()
  const legacyAdjustmentCodes = new Set<string>(CONTRACT_ADJUSTMENT_COST_CODES.map((item) => item.value))
  const eligibleRows = rows.filter((row) => !legacyAdjustmentCodes.has(row.costCode))
  const eligibleLineIds = new Set(eligibleRows.map((row) => row.id))
  const eligibleItems = costItems.filter((item) => eligibleLineIds.has(item.estimateLineId))
  const breakdownLineIds = new Set(eligibleItems.map((item) => item.estimateLineId))
  const repricedItems = eligibleItems.map((item) => ({ item, repriced: repriceAtMarkup(item, markupRateBasisPoints) }))
  const statements = lineMarkupStatements({
    rawDb: access.rawDb,
    projectId,
    estimateId,
    now,
    lines: eligibleRows
      .filter((row) => !breakdownLineIds.has(row.id))
      .map((row) => repriceAtMarkup(row, markupRateBasisPoints)),
    costItems: repricedItems.map(({ repriced }) => repriced),
  })
  if (statements.length === 0) {
    throw new Error("Add a CSI cost-code line before applying markup.")
  }
  // Fifty statements per batch, as before.
  for (const chunk of chunkD1Values(statements)) {
    const results = await access.rawDb.batch(chunk)
    if (results.some((result) => !result.success)) {
      throw new Error("The line markup update did not complete.")
    }
  }
  // Roll each breakdown line up from its repriced items in one batch, instead
  // of re-reading every line (the same values the saved items now hold).
  const rollups = [...breakdownLineIds].flatMap((lineId) => {
    const line = rows.find((row) => row.id === lineId)
    if (!line) return []
    const items = repricedItems
      .filter(({ item }) => item.estimateLineId === lineId)
      .map(({ item, repriced }) => repricedBreakdownItem(item, repriced))
    return [updateEstimateLinesStatement(access.db, eq(projectEstimateLines.id, lineId), lineRollupPatch(line, items, now))]
  })
  const [firstRollup, ...otherRollups] = rollups
  if (firstRollup) await access.db.batch([firstRollup, ...otherRollups])
  await refreshEstimateTotals(access.db, estimateId, now)
}

export async function updateEstimateBuilderFee(
  access: EstimateAccess,
  estimateId: string,
  input: ProjectEstimateBuilderFeeInput
): Promise<void> {
  const legacyRows = await access.db
    .select({ id: projectEstimateLines.id })
    .from(projectEstimateLines)
    .where(
      and(
        eq(projectEstimateLines.estimateId, estimateId),
        inArray(projectEstimateLines.costCode, CONTRACT_ADJUSTMENT_COST_CODES.map((item) => item.value))
      )
    )
    .limit(1)
  if (legacyRows[0]) {
    throw new Error(
      "This draft still has legacy Division 99 fee lines. Re-import its source CSI, or remove those lines, before setting the builder fee."
    )
  }
  const now = new Date().toISOString()
  await updateEstimates(access.db, eq(projectEstimates.id, estimateId), {
    overheadRateBasisPoints: rateBasisPoints(input.overheadPercent, "Overhead"),
    marginRateBasisPoints: rateBasisPoints(input.marginPercent, "Margin"),
    contingencyRateBasisPoints: rateBasisPoints(input.contingencyPercent, "Contingency"),
    updatedAt: now,
  })
  await refreshEstimateTotals(access.db, estimateId, now)
}

export async function deleteEstimateLine(access: EstimateAccess, estimateId: string, lineId: string): Promise<void> {
  await deleteEstimateLines(
    access.db,
    and(eq(projectEstimateLines.id, lineId), eq(projectEstimateLines.estimateId, estimateId))
  )
  await refreshEstimateTotals(access.db, estimateId, new Date().toISOString())
}
