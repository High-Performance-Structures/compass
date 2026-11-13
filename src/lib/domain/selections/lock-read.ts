/**
 * Reads for locked and replaced selections (rules in locks.ts).
 */
import { and, asc, desc, eq, inArray, notInArray } from "drizzle-orm"

import { projectChangeOrders, projectFinishSelections } from "@/db/schema"
import { projectSelectionChoices, projectSelectionRoundSignatureItems, projectSelectionRoundSignatures } from "@/db/schema-selection-choices"
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
): Promise<{ readonly status: string; readonly lock: SelectionLock | null; readonly releasedFromOrder: boolean } | null> {
  const row = await db
    .select({ status: projectFinishSelections.status, releasedAt: projectFinishSelections.procurementReleasedAt })
    .from(projectFinishSelections)
    .where(and(eq(projectFinishSelections.id, selectionId), eq(projectFinishSelections.projectId, projectId)))
    .get()
  if (!row) return null
  return { status: row.status, lock: selectionLock(row.status, await selectionIsReplaced(db, selectionId)), releasedFromOrder: row.releasedAt !== null }
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
 * The job's selections a signature covers for their CURRENT pick: the pick
 * is the choice the latest signed Selection Phase covered, or the selection
 * is a replacement whose executed change order was priced for its pick. "Approved" without one (set
 * by hand, an older click approval, or a pick changed since) isn't signed.
 */
export async function signedSelectionIds(db: Db, projectId: string): Promise<ReadonlySet<string>> {
  const [rounds, picks, replacements] = await Promise.all([
    db
      .select({ selectionId: projectSelectionRoundSignatureItems.selectionId, choiceId: projectSelectionRoundSignatureItems.choiceId })
      .from(projectSelectionRoundSignatureItems)
      .innerJoin(projectSelectionRoundSignatures, eq(projectSelectionRoundSignatures.id, projectSelectionRoundSignatureItems.signatureId))
      .where(and(eq(projectSelectionRoundSignatures.projectId, projectId), eq(projectSelectionRoundSignatures.status, "signed")))
      .orderBy(asc(projectSelectionRoundSignatures.signedAt)),
    db
      .select({ selectionId: projectSelectionChoices.selectionId, choiceId: projectSelectionChoices.id })
      .from(projectSelectionChoices)
      .where(and(eq(projectSelectionChoices.projectId, projectId), eq(projectSelectionChoices.chosen, true))),
    // A replacement's executed change order covers the pick it was priced for.
    db
      .selectDistinct({ id: projectChangeOrders.sourceRecordId })
      .from(projectChangeOrders)
      .innerJoin(projectFinishSelections, eq(projectFinishSelections.id, projectChangeOrders.sourceRecordId))
      .innerJoin(
        projectSelectionChoices,
        and(eq(projectSelectionChoices.id, projectFinishSelections.replacementPricedChoiceId), eq(projectSelectionChoices.chosen, true)),
      )
      .where(
        and(
          eq(projectChangeOrders.projectId, projectId),
          eq(projectChangeOrders.sourceType, "selection_replacement"),
          inArray(projectChangeOrders.status, [...EXECUTED_CHANGE_ORDER_STATUSES]),
        ),
      ),
  ])
  // Later signatures overwrite earlier ones.
  const signedChoice = new Map(rounds.map((row) => [row.selectionId, row.choiceId]))
  const signed = new Set(picks.flatMap((pick) => (signedChoice.get(pick.selectionId) === pick.choiceId ? [pick.selectionId] : [])))
  for (const row of replacements) if (row.id) signed.add(row.id)
  return signed
}

/** Change order statuses that end a replacement's change order without the owner signing. */
const CLOSED_UNSIGNED_CHANGE_ORDER_STATUSES = ["void", "declined"] as const

/** The replacement selection's latest change order that isn't void or declined, or null. */
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
        notInArray(projectChangeOrders.status, [...CLOSED_UNSIGNED_CHANGE_ORDER_STATUSES]),
      ),
    )
    .orderBy(desc(projectChangeOrders.createdAt))
    .get()
  return row ?? null
}
