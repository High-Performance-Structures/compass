/**
 * Reads for locked and replaced selections (rules in locks.ts).
 */
import { and, eq, inArray, ne } from "drizzle-orm"

import { projectChangeOrders, projectFinishSelections } from "@/db/schema"
import { projectSelectionRoundSignatureItems, projectSelectionRoundSignatures } from "@/db/schema-selection-choices"
import { chunkD1Values } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

import { selectionLock, type SelectionLock } from "./locks"
import type { SelectionReplacementReason } from "./statuses"

/** Whether another selection replaces this one. */
export async function selectionIsReplaced(db: Db, selectionId: string): Promise<boolean> {
  const row = await db
    .select({ id: projectFinishSelections.id })
    .from(projectFinishSelections)
    .where(eq(projectFinishSelections.replacesSelectionId, selectionId))
    .get()
  return row !== undefined
}

/** The ids among `selectionIds` that another selection replaces (those are read-only). */
export async function replacedSelectionIds(db: Db, selectionIds: readonly string[]): Promise<ReadonlySet<string>> {
  const ids = [...new Set(selectionIds)]
  if (ids.length === 0) return new Set()
  const rows = (
    await Promise.all(
      chunkD1Values(ids).map((chunk) =>
        db.select({ id: projectFinishSelections.replacesSelectionId }).from(projectFinishSelections).where(inArray(projectFinishSelections.replacesSelectionId, chunk)),
      ),
    )
  ).flat()
  return new Set(rows.flatMap((row) => (row.id ? [row.id] : [])))
}

/** The selection's stored status and its lock (null: it can change), or null when it isn't on the project. */
export async function loadSelectionLock(
  db: Db,
  projectId: string,
  selectionId: string,
): Promise<{ readonly status: string; readonly lock: SelectionLock | null } | null> {
  const row = await db
    .select({ status: projectFinishSelections.status })
    .from(projectFinishSelections)
    .where(and(eq(projectFinishSelections.id, selectionId), eq(projectFinishSelections.projectId, projectId)))
    .get()
  if (!row) return null
  return { status: row.status, lock: selectionLock(row.status, await selectionIsReplaced(db, selectionId)) }
}

export type SelectionReplacementLink = {
  readonly id: string
  readonly name: string
  readonly reason: SelectionReplacementReason | null
}

/** What replaces this selection, and what it replaces (each null when none). */
export async function loadSelectionReplacement(
  db: Db,
  projectId: string,
  selectionId: string,
): Promise<{ readonly replacedBy: SelectionReplacementLink | null; readonly replaces: SelectionReplacementLink | null }> {
  const [self, replacement] = await Promise.all([
    db
      .select({ replacesSelectionId: projectFinishSelections.replacesSelectionId, reason: projectFinishSelections.replacementReason })
      .from(projectFinishSelections)
      .where(and(eq(projectFinishSelections.id, selectionId), eq(projectFinishSelections.projectId, projectId)))
      .get(),
    db
      .select({ id: projectFinishSelections.id, name: projectFinishSelections.name, reason: projectFinishSelections.replacementReason })
      .from(projectFinishSelections)
      .where(and(eq(projectFinishSelections.replacesSelectionId, selectionId), eq(projectFinishSelections.projectId, projectId)))
      .get(),
  ])
  const replacedId = self?.replacesSelectionId ?? null
  const replaced = replacedId
    ? await db
        .select({ id: projectFinishSelections.id, name: projectFinishSelections.name })
        .from(projectFinishSelections)
        .where(and(eq(projectFinishSelections.id, replacedId), eq(projectFinishSelections.projectId, projectId)))
        .get()
    : undefined
  return {
    replacedBy: replacement ?? null,
    replaces: replaced ? { ...replaced, reason: self?.reason ?? null } : null,
  }
}

/** Change order statuses that mean the owner signed (or it was accepted) and it took effect. */
export const EXECUTED_CHANGE_ORDER_STATUSES = ["executed", "sage_pending", "synced", "closed"] as const

/**
 * The job's selections a signature covers: in a signed Selection Phase, or
 * a replacement whose change order was executed. "Approved" without one
 * (set by hand, or an older click approval) is not shown as signed.
 */
export async function signedSelectionIds(db: Db, projectId: string): Promise<ReadonlySet<string>> {
  const [rounds, replacements] = await Promise.all([
    db
      .selectDistinct({ id: projectSelectionRoundSignatureItems.selectionId })
      .from(projectSelectionRoundSignatureItems)
      .innerJoin(projectSelectionRoundSignatures, eq(projectSelectionRoundSignatures.id, projectSelectionRoundSignatureItems.signatureId))
      .where(and(eq(projectSelectionRoundSignatures.projectId, projectId), eq(projectSelectionRoundSignatures.status, "signed"))),
    db
      .selectDistinct({ id: projectChangeOrders.sourceRecordId })
      .from(projectChangeOrders)
      .where(
        and(
          eq(projectChangeOrders.projectId, projectId),
          eq(projectChangeOrders.sourceType, "selection_replacement"),
          inArray(projectChangeOrders.status, [...EXECUTED_CHANGE_ORDER_STATUSES]),
        ),
      ),
  ])
  return new Set([...rounds, ...replacements].flatMap((row) => (row.id ? [row.id] : [])))
}

/** The replacement selection's change order that isn't void, or null. */
export async function replacementChangeOrderFor(
  db: Db,
  projectId: string,
  selectionId: string,
): Promise<{ readonly id: string; readonly number: string; readonly status: string } | null> {
  const row = await db
    .select({ id: projectChangeOrders.id, number: projectChangeOrders.changeOrderNumber, status: projectChangeOrders.status })
    .from(projectChangeOrders)
    .where(
      and(
        eq(projectChangeOrders.projectId, projectId),
        eq(projectChangeOrders.sourceType, "selection_replacement"),
        eq(projectChangeOrders.sourceRecordId, selectionId),
        ne(projectChangeOrders.status, "void"),
      ),
    )
    .get()
  return row ?? null
}
