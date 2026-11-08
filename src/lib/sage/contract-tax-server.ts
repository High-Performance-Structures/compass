import "server-only"

import { and, eq, inArray } from "drizzle-orm"

import { projectChangeOrders } from "@/db/schema"
import {
  projectContractBudgetAdjustments,
  projectContractBudgetLines,
  projectContractBudgetRevisions,
  projectEstimateLines,
  projectEstimates,
  sageTaxEntities,
} from "@/db/schema-estimates"
import { chunkD1Values } from "@/lib/d1-query"
import { canonicalFeeCostCode } from "@/lib/domain/financials/builder-fee-codes"
import type { ArInvoiceTaxDistrict, ArInvoiceTaxProfile } from "@/lib/domain/sage-bridge/ar-invoice-rules"
import type { Db } from "@/lib/server/action-context"

/*
 * The contract's tax picture for Sage: which share of each cost code (base
 * contract and each change order) the accepted estimates made taxable, and
 * the Sage tax district its taxable lines use. Shared by the AR invoice for
 * pay requests built in Compass and the Enter in Sage checklist / Sage check
 * for pay requests built in Sage. Read only.
 */

type MutableTaxProfile = { totalCents: number; taxableCents: number; taxableTaxCents: number }

function addProfile(map: Map<string, MutableTaxProfile>, code: string, amount: number, taxable: boolean, tax: number): void {
  const entry = map.get(code) ?? { totalCents: 0, taxableCents: 0, taxableTaxCents: 0 }
  entry.totalCents += amount
  if (taxable) {
    entry.taxableCents += amount
    entry.taxableTaxCents += tax
  }
  map.set(code, entry)
}

/** Sage's tax district record number: the entity's Sage record, else its code's digits ("04-0017" is 40017). */
function districtRecordNumber(entity: { readonly sourceRecordId: string | null; readonly code: string }): string | null {
  const source = entity.sourceRecordId?.trim() ?? ""
  if (/^\d{1,12}$/.test(source)) return String(Number(source))
  const digits = entity.code.replaceAll(/[^\d]/g, "")
  return /^\d{1,12}$/.test(digits) && Number(digits) > 0 ? String(Number(digits)) : null
}

/** The contract's taxable shares by cost code, and the Sage tax district its taxable lines use. */
export async function loadContractTax(
  db: Db,
  revisionId: string | null
): Promise<{ readonly profiles: ReadonlyMap<string, ArInvoiceTaxProfile>; readonly taxEntityIds: readonly string[]; readonly acceptedEstimateId: string | null }> {
  const profiles = new Map<string, MutableTaxProfile>()
  if (!revisionId) return { profiles, taxEntityIds: [], acceptedEstimateId: null }
  const [rows, revision] = await Promise.all([
    db
      .select({
        costCode: projectContractBudgetLines.costCode,
        amountCents: projectContractBudgetLines.originalEstimateCents,
        taxable: projectEstimateLines.taxable,
        taxCents: projectEstimateLines.taxCents,
        lineTotalCents: projectEstimateLines.lineTotalCents,
        taxEntityId: projectEstimateLines.taxEntityId,
      })
      .from(projectContractBudgetLines)
      .leftJoin(projectEstimateLines, eq(projectEstimateLines.id, projectContractBudgetLines.sourceEstimateLineId))
      .where(eq(projectContractBudgetLines.revisionId, revisionId)),
    db.select({ acceptedEstimateId: projectContractBudgetRevisions.acceptedEstimateId }).from(projectContractBudgetRevisions).where(eq(projectContractBudgetRevisions.id, revisionId)).get(),
  ])
  const taxEntityIds: string[] = []
  for (const row of rows) {
    const taxable = row.taxable === true
    // The budget line's share of the tax its estimate line built in.
    const tax = taxable && row.lineTotalCents ? Math.round((row.amountCents * (row.taxCents ?? 0)) / row.lineTotalCents) : 0
    addProfile(profiles, canonicalFeeCostCode(row.costCode.trim()), row.amountCents, taxable, tax)
    if (taxable && row.taxEntityId) taxEntityIds.push(row.taxEntityId)
  }
  return { profiles, taxEntityIds, acceptedEstimateId: revision?.acceptedEstimateId ?? null }
}

/** Each change order's taxable shares by cost code, from its accepted change-order estimate. */
export async function loadChangeOrderTax(db: Db, changeOrderIds: readonly string[]) {
  const byChangeOrder = new Map<string, Map<string, MutableTaxProfile>>()
  const taxEntityIds: string[] = []
  for (const ids of chunkD1Values([...changeOrderIds])) {
    const rows = await db
      .select({
        changeOrderId: projectEstimates.changeOrderId,
        costCode: projectEstimateLines.costCode,
        taxable: projectEstimateLines.taxable,
        taxCents: projectEstimateLines.taxCents,
        lineTotalCents: projectEstimateLines.lineTotalCents,
        taxEntityId: projectEstimateLines.taxEntityId,
      })
      .from(projectEstimateLines)
      .innerJoin(projectEstimates, eq(projectEstimates.id, projectEstimateLines.estimateId))
      .where(and(inArray(projectEstimates.changeOrderId, ids), eq(projectEstimates.status, "accepted")))
    for (const row of rows) {
      if (!row.changeOrderId) continue
      const profiles = byChangeOrder.get(row.changeOrderId) ?? new Map<string, MutableTaxProfile>()
      addProfile(profiles, canonicalFeeCostCode(row.costCode.trim()), row.lineTotalCents, row.taxable, row.taxCents)
      byChangeOrder.set(row.changeOrderId, profiles)
      if (row.taxable && row.taxEntityId) taxEntityIds.push(row.taxEntityId)
    }
  }
  return { byChangeOrder, taxEntityIds }
}

/** The district most taxable lines use, else the accepted estimate's default. */
export async function loadTaxDistrict(db: Db, taxEntityIds: readonly string[], acceptedEstimateId: string | null): Promise<ArInvoiceTaxDistrict | null> {
  const counts = new Map<string, number>()
  for (const id of taxEntityIds) counts.set(id, (counts.get(id) ?? 0) + 1)
  let entityId: string | null = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null
  if (!entityId && acceptedEstimateId) {
    const estimate = await db.select({ id: projectEstimates.defaultTaxEntityId }).from(projectEstimates).where(eq(projectEstimates.id, acceptedEstimateId)).get()
    entityId = estimate?.id ?? null
  }
  if (!entityId) return null
  const entity = await db
    .select({ sourceRecordId: sageTaxEntities.sourceRecordId, code: sageTaxEntities.code, name: sageTaxEntities.name, rateBasisPoints: sageTaxEntities.rateBasisPoints })
    .from(sageTaxEntities)
    .where(eq(sageTaxEntities.id, entityId))
    .get()
  const recordNumber = entity ? districtRecordNumber(entity) : null
  return entity && recordNumber ? { sageRecordNumber: recordNumber, name: entity.name, rateBasisPoints: entity.rateBasisPoints } : null
}

/** Each change order's (and variance's) part of a cost code in the draw's contract budget revision. */
export async function loadChangeOrderParts(
  db: Db,
  projectId: string,
  revisionId: string | null
): Promise<readonly { readonly changeOrderId: string; readonly recordType: "change_order" | "variance"; readonly number: string; readonly costCode: string; readonly amountCents: number }[]> {
  if (!revisionId) return []
  const rows = await db
    .select({
      changeOrderId: projectContractBudgetAdjustments.changeOrderId,
      costCode: projectContractBudgetAdjustments.costCode,
      amountCents: projectContractBudgetAdjustments.amountCents,
      number: projectChangeOrders.changeOrderNumber,
      recordType: projectChangeOrders.recordType,
    })
    .from(projectContractBudgetAdjustments)
    .leftJoin(projectChangeOrders, eq(projectChangeOrders.id, projectContractBudgetAdjustments.changeOrderId))
    .where(and(eq(projectContractBudgetAdjustments.projectId, projectId), eq(projectContractBudgetAdjustments.revisionId, revisionId)))
  return rows.map((row) => ({
    changeOrderId: row.changeOrderId,
    recordType: row.recordType === "variance" ? "variance" : "change_order",
    number: row.number ?? "",
    costCode: row.costCode,
    amountCents: row.amountCents,
  }))
}
