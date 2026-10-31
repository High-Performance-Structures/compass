import { and, desc, eq, isNotNull, isNull } from "drizzle-orm"

import { projectEstimateLineCostItems, projectEstimateLines, projectEstimates, sageTaxEntities } from "@/db/schema-estimates"
import { rateBookEntries } from "@/db/schema-rate-book"
import { recordActivityEvent } from "@/lib/activity-log"
import { loadProjectCostCodeCatalog } from "@/lib/cost-codes/catalog-server"
import type { CompassDb, EstimateAccess } from "@/lib/domain/estimates/access"
import { refreshEstimateLineFromCostItems, refreshEstimateTotals } from "@/lib/domain/estimates/lines"
import { calculateEstimateLine, rateBasisPoints, requiredText } from "@/lib/domain/estimates/rules"
import { insertEstimateLineCostItem, updateEstimateLineCostItems } from "@/lib/domain/estimates/store"
import type { ProjectEstimateLineCostItemInput } from "@/lib/domain/estimates/types"
import { cleanText } from "@/lib/shared/guards"

/**
 * A line's cost-item breakdown. Each change rolls the line up and refreshes
 * the estimate's totals. Callers check access and that the estimate is
 * editable first.
 */

type EstimateRow = typeof projectEstimates.$inferSelect

async function resolveRateBookReference(
  db: CompassDb,
  organizationId: string | null,
  entryId: string | null,
  version: number | null
): Promise<{ readonly rateBookEntryId: string | null; readonly rateBookVersion: number | null }> {
  if (!entryId || !organizationId) return { rateBookEntryId: null, rateBookVersion: null }
  const entry = await db
    .select({ id: rateBookEntries.id, version: rateBookEntries.version })
    .from(rateBookEntries)
    .where(and(eq(rateBookEntries.id, entryId), eq(rateBookEntries.organizationId, organizationId)))
    .limit(1)
    .then((rows) => rows[0])
  if (!entry) return { rateBookEntryId: null, rateBookVersion: null }
  const usedVersion =
    version !== null && Number.isInteger(version) && version >= 1 && version <= entry.version ? version : entry.version
  return { rateBookEntryId: entry.id, rateBookVersion: usedVersion }
}

/** Saves a new or changed cost item, priced on the server. Returns its id. */
export async function saveEstimateLineCostItem(
  access: EstimateAccess,
  projectId: string,
  estimate: EstimateRow,
  lineId: string,
  costItemId: string | null,
  input: ProjectEstimateLineCostItemInput
): Promise<string> {
  const estimateId = estimate.id
  const lineRows = await access.db
    .select({ id: projectEstimateLines.id })
    .from(projectEstimateLines)
    .where(
      and(
        eq(projectEstimateLines.id, lineId),
        eq(projectEstimateLines.estimateId, estimateId),
        eq(projectEstimateLines.projectId, projectId)
      )
    )
    .limit(1)
  const line = lineRows[0]
  if (!line) throw new Error("Estimate line not found.")

  const costCode = requiredText(input.costCode, "Cost code")
  const catalog = await loadProjectCostCodeCatalog(access.db)
  const catalogItem = catalog.find((item) => item.code === costCode)
  if (!catalogItem) {
    throw new Error("Choose a verified CSI/Sage catalog cost code.")
  }

  const description = requiredText(input.description, "Description")
  if (description.length > 500) {
    throw new Error("Description must be 500 characters or fewer.")
  }
  const quantity = input.quantity ?? 1
  const unitCost = input.unitCost ?? 0
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Quantity must be greater than zero.")
  }
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    throw new Error("Unit cost cannot be negative.")
  }
  const unitCostCents = Math.round(unitCost * 100)
  const markupRateBasisPoints = rateBasisPoints(input.markupPercent, "Cost item markup")
  const taxEntityId = cleanText(input.taxEntityId) ?? estimate.defaultTaxEntityId
  const taxRows = taxEntityId
    ? await access.db
        .select()
        .from(sageTaxEntities)
        .where(and(eq(sageTaxEntities.id, taxEntityId), eq(sageTaxEntities.active, true)))
        .limit(1)
    : []
  const tax = taxRows[0]
  if (input.taxable && !tax) {
    throw new Error("Choose the Sage tax entity for a taxable cost item.")
  }
  const calculation = calculateEstimateLine({
    quantity,
    unitCostCents,
    markupRateBasisPoints,
    taxable: input.taxable,
    taxRateBasisPoints: tax?.rateBasisPoints ?? 0,
  })
  if (calculation.lineTotalCents <= 0) {
    throw new Error("Enter a quantity and unit cost greater than zero.")
  }
  const unit = cleanText(input.unit) ?? ""
  if (unit.length > 40) {
    throw new Error("Unit must be 40 characters or fewer.")
  }

  // A rate book reference must point at this organization's entry.
  const rateBookRef = await resolveRateBookReference(
    access.db,
    access.organizationId,
    input.rateBookEntryId ?? null,
    input.rateBookVersion ?? null
  )

  const now = new Date().toISOString()
  const id = costItemId ?? crypto.randomUUID()
  const values = {
    ...rateBookRef,
    divisionCode: catalogItem.divisionCode,
    divisionName: catalogItem.divisionDescription,
    costCode: catalogItem.code,
    costCodeName: catalogItem.description,
    description,
    quantity,
    unit,
    unitCostCents,
    ...calculation,
    markupRateBasisPoints,
    taxable: input.taxable,
    taxEntityId: tax?.id ?? null,
    taxCode: tax?.code ?? null,
    taxName: tax?.name ?? null,
    taxRateBasisPoints: tax?.rateBasisPoints ?? 0,
    totalCostCents: calculation.lineTotalCents,
    updatedAt: now,
  }
  if (costItemId) {
    const existingRows = await access.db
      .select({ id: projectEstimateLineCostItems.id })
      .from(projectEstimateLineCostItems)
      .where(
        and(
          eq(projectEstimateLineCostItems.id, costItemId),
          eq(projectEstimateLineCostItems.estimateId, estimateId),
          eq(projectEstimateLineCostItems.estimateLineId, lineId),
          isNull(projectEstimateLineCostItems.deletedAt)
        )
      )
      .limit(1)
    if (!existingRows[0]) throw new Error("Cost item not found.")
    await updateEstimateLineCostItems(access.db, eq(projectEstimateLineCostItems.id, costItemId), values)
  } else {
    const priorRows = await access.db
      .select({ sortOrder: projectEstimateLineCostItems.sortOrder })
      .from(projectEstimateLineCostItems)
      .where(eq(projectEstimateLineCostItems.estimateLineId, lineId))
      .orderBy(desc(projectEstimateLineCostItems.sortOrder))
      .limit(1)
    await insertEstimateLineCostItem(access.db, {
      id,
      projectId,
      estimateId,
      estimateLineId: lineId,
      ...values,
      sortOrder: (priorRows[0]?.sortOrder ?? 0) + 1,
      createdAt: now,
    })
  }

  await refreshEstimateLineFromCostItems(access.db, estimateId, lineId, now)
  await refreshEstimateTotals(access.db, estimateId, now)
  return id
}

/**
 * Removes (`remove: true`) or restores a cost item. Removal is a soft delete
 * that can be restored; both are recorded in Activity.
 */
export async function setEstimateLineCostItemRemoved(
  access: EstimateAccess,
  input: {
    readonly projectId: string
    readonly estimateId: string
    readonly lineId: string
    readonly costItemId: string
    readonly remove: boolean
  }
): Promise<void> {
  const { projectId, estimateId, lineId, costItemId, remove } = input
  const deletedState = remove
    ? isNull(projectEstimateLineCostItems.deletedAt)
    : isNotNull(projectEstimateLineCostItems.deletedAt)
  const rows = await access.db
    .select({
      id: projectEstimateLineCostItems.id,
      costCode: projectEstimateLineCostItems.costCode,
      description: projectEstimateLineCostItems.description,
      lineTotalCents: projectEstimateLineCostItems.lineTotalCents,
    })
    .from(projectEstimateLineCostItems)
    .where(
      and(
        eq(projectEstimateLineCostItems.id, costItemId),
        eq(projectEstimateLineCostItems.projectId, projectId),
        eq(projectEstimateLineCostItems.estimateId, estimateId),
        eq(projectEstimateLineCostItems.estimateLineId, lineId),
        deletedState
      )
    )
    .limit(1)
  const item = rows[0]
  if (!item) throw new Error(remove ? "Cost item not found." : "Deleted cost item not found.")
  const now = new Date().toISOString()
  const change = await updateEstimateLineCostItems(
    access.db,
    and(
      eq(projectEstimateLineCostItems.id, costItemId),
      remove ? isNull(projectEstimateLineCostItems.deletedAt) : isNotNull(projectEstimateLineCostItems.deletedAt)
    ),
    remove
      ? { deletedAt: now, deletedByUserId: access.user.id, updatedAt: now }
      : { deletedAt: null, deletedByUserId: null, updatedAt: now }
  )
  if ((change.meta.changes ?? 0) !== 1) {
    throw new Error(
      `The cost item changed before it could be ${remove ? "removed" : "restored"}. Refresh and try again.`
    )
  }
  await refreshEstimateLineFromCostItems(access.db, estimateId, lineId, now)
  await refreshEstimateTotals(access.db, estimateId, now)
  if (access.organizationId) {
    await recordActivityEvent({
      db: access.db,
      organizationId: access.organizationId,
      projectId,
      actor: access.user,
      category: "financial",
      action: remove ? "estimate_breakdown_item_deleted" : "estimate_breakdown_item_restored",
      entityType: "project_estimate_line_cost_item",
      entityId: costItemId,
      summary: remove
        ? `Removed ${item.costCode} from an estimate line breakdown.`
        : `Restored ${item.costCode} to an estimate line breakdown.`,
      metadata: {
        estimateId,
        estimateLineId: lineId,
        costCode: item.costCode,
        description: item.description,
        lineTotalCents: item.lineTotalCents,
      },
      createdAt: now,
    })
  }
}
