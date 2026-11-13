/**
 * Reads for the Selections sheet and its detail panel: one row per selection
 * with its follow-ups placed under the parent, the owner's pick, the
 * published allowance and due date, and (for the detail panel) the RFQs that
 * price the selection. Callers resolve staff access first.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm"

import { projectFinishSelections, projectOperations, vendors } from "@/db/schema"
import { projectSelectionChoiceDependents, projectSelectionChoices } from "@/db/schema-selection-choices"
import { projectSelectionDecisions, projectSelectionProcurementLinks } from "@/db/schema-selection-decisions"
import type { Db } from "@/lib/server/action-context"

import { selectionSheetRows, type SelectionSheetInput, type SelectionSheetRow } from "@/lib/selections/sheet"

import { signedSelectionIds } from "./lock-read"

export async function loadSelectionSheet(db: Db, projectId: string): Promise<readonly SelectionSheetRow[]> {
  const [selections, choices, dependents] = await Promise.all([
    db
      .select({
        id: projectFinishSelections.id,
        roomName: projectFinishSelections.roomName,
        name: projectFinishSelections.name,
        category: projectFinishSelections.category,
        costCode: projectFinishSelections.costCode,
        status: projectFinishSelections.status,
        sourceSystem: projectFinishSelections.sourceSystem,
        sortOrder: projectFinishSelections.sortOrder,
        legacyParentId: projectFinishSelections.parentSelectionId,
        allowanceCents: projectSelectionDecisions.allowanceCents,
        dueDate: projectSelectionDecisions.decisionDueDate,
        published: projectSelectionDecisions.published,
        roundKey: projectFinishSelections.roundKey,
        replacesSelectionId: projectFinishSelections.replacesSelectionId,
        ownerApproved: projectFinishSelections.ownerApproved,
        settledOwnerPriceCents: projectFinishSelections.settledOwnerPriceCents,
      })
      .from(projectFinishSelections)
      .leftJoin(projectSelectionDecisions, eq(projectSelectionDecisions.selectionId, projectFinishSelections.id))
      .where(eq(projectFinishSelections.projectId, projectId))
      .orderBy(asc(projectFinishSelections.roomName), asc(projectFinishSelections.sortOrder), asc(projectFinishSelections.name)),
    db
      .select({
        selectionId: projectSelectionChoices.selectionId,
        title: projectSelectionChoices.title,
        chosen: projectSelectionChoices.chosen,
        priceCents: projectSelectionChoices.priceCents,
        ownerPriceCents: projectSelectionChoices.ownerPriceCents,
      })
      .from(projectSelectionChoices)
      .where(eq(projectSelectionChoices.projectId, projectId)),
    db
      .select({ selectionId: projectSelectionChoiceDependents.selectionId, parentId: projectSelectionChoices.selectionId })
      .from(projectSelectionChoiceDependents)
      .innerJoin(projectSelectionChoices, eq(projectSelectionChoices.id, projectSelectionChoiceDependents.choiceId))
      .where(eq(projectSelectionChoices.projectId, projectId)),
  ])
  const signed = await signedSelectionIds(db, projectId)
  const replacedIds = new Set(selections.flatMap((row) => (row.replacesSelectionId ? [row.replacesSelectionId] : [])))
  const input: SelectionSheetInput = {
    selections: selections.map((row) => ({
      ...row,
      published: row.published === true,
      signed: signed.has(row.id),
      replaced: replacedIds.has(row.id),
      replacement: row.replacesSelectionId !== null,
    })),
    choices,
    dependents,
  }
  return selectionSheetRows(input)
}

export type SelectionRfqView = {
  readonly id: string
  readonly number: string | null
  readonly title: string
  readonly status: string
  readonly companyName: string | null
}

/** RFQs that ask a supplier to price this selection (newest first). */
export async function loadSelectionRfqs(db: Db, projectId: string, selectionId: string): Promise<readonly SelectionRfqView[]> {
  return db
    .select({
      id: projectOperations.id,
      number: projectOperations.sourceRecordNumber,
      title: projectOperations.title,
      status: projectOperations.status,
      companyName: projectOperations.companyName,
    })
    .from(projectSelectionProcurementLinks)
    .innerJoin(projectOperations, eq(projectOperations.id, projectSelectionProcurementLinks.operationId))
    .where(
      and(
        eq(projectSelectionProcurementLinks.projectId, projectId),
        eq(projectSelectionProcurementLinks.selectionId, selectionId),
        eq(projectOperations.sourceRecordType, "rfq"),
      ),
    )
    .orderBy(sql`${projectOperations.createdAt} DESC`)
}

export type DraftRfqOption = { readonly id: string; readonly number: string | null; readonly title: string; readonly companyName: string | null }

/** Unsent RFQ drafts on the job that choices can be added to. */
export async function loadDraftRfqOptions(db: Db, projectId: string): Promise<readonly DraftRfqOption[]> {
  return db
    .select({
      id: projectOperations.id,
      number: projectOperations.sourceRecordNumber,
      title: projectOperations.title,
      companyName: projectOperations.companyName,
    })
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.projectId, projectId),
        eq(projectOperations.sourceRecordType, "rfq"),
        eq(projectOperations.status, "draft"),
        sql`json_extract(${projectOperations.sagePayloadJson}, '$.vendorResponse') IS NULL`,
      ),
    )
    .orderBy(sql`${projectOperations.createdAt} DESC`)
    .limit(50)
}

export type SupplierOption = { readonly id: string; readonly name: string; readonly email: string | null }

/** The company's suppliers (vendor records) for the choice supplier and RFQ pickers. */
export async function loadSupplierOptions(db: Db, organizationId: string): Promise<readonly SupplierOption[]> {
  const rows = await db
    .select({ id: vendors.id, name: vendors.name, email: vendors.email, primaryEmail: vendors.primaryEmail })
    .from(vendors)
    .where(and(eq(vendors.organizationId, organizationId), isNull(vendors.mergedIntoVendorId)))
    .orderBy(asc(vendors.name))
    .limit(2000)
  return rows.map((row) => ({ id: row.id, name: row.name, email: row.primaryEmail ?? row.email }))
}
