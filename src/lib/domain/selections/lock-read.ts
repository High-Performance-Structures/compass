/**
 * Reads for locked and replaced selections (rules in locks.ts).
 */
import { and, asc, eq, inArray } from "drizzle-orm"

import { projectFinishSelections } from "@/db/schema"
import { projectSelectionChoices, projectSelectionRoundSignatureItems, projectSelectionRoundSignatures } from "@/db/schema-selection-choices"
import { chunkD1Values } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

import { APPROVED_PICK_MESSAGE, OUT_FOR_SIGNATURE_MESSAGE, selectionLock, type SelectionLock } from "./locks"
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

/**
 * The job's selections a signature covers for their CURRENT pick: the pick
 * is the choice the latest signed Selection Phase covered. "Approved"
 * without one (set by hand, an older click approval, a pick changed since)
 * isn't signed.
 */
export async function signedSelectionIds(db: Db, projectId: string): Promise<ReadonlySet<string>> {
  const [rounds, picks] = await Promise.all([
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
  ])
  // Later signatures overwrite earlier ones.
  const signedChoice = new Map(rounds.map((row) => [row.selectionId, row.choiceId]))
  return new Set(picks.flatMap((pick) => (signedChoice.get(pick.selectionId) === pick.choiceId ? [pick.selectionId] : [])))
}

/** Whether the selection is in a Selection Phase signature being prepared or sent. */
export async function selectionOutForSignature(db: Db, selectionId: string): Promise<boolean> {
  const row = await db
    .select({ id: projectSelectionRoundSignatureItems.selectionId })
    .from(projectSelectionRoundSignatureItems)
    .innerJoin(projectSelectionRoundSignatures, eq(projectSelectionRoundSignatures.id, projectSelectionRoundSignatureItems.signatureId))
    .where(and(eq(projectSelectionRoundSignatureItems.selectionId, selectionId), inArray(projectSelectionRoundSignatures.status, ["preparing", "sent"])))
    .get()
  return row !== undefined
}

/**
 * Why the selection's pick can't change now (staff or owner), or null. The
 * same rules the pick write enforces (choices-store pickChangeable), read
 * here for the message: ordered, installed or replaced (its lock message);
 * approved or its pick signed ("Use a change order"); out for signature.
 */
export async function pickChangeBlocker(db: Db, projectId: string, selectionId: string): Promise<string | null> {
  const state = await loadSelectionLock(db, projectId, selectionId)
  if (!state) return "Selection not found"
  if (state.lock) return state.lock.message
  const [row, signed, out] = await Promise.all([
    db
      .select({ approved: projectFinishSelections.ownerApproved })
      .from(projectFinishSelections)
      .where(eq(projectFinishSelections.id, selectionId))
      .get(),
    signedSelectionIds(db, projectId),
    selectionOutForSignature(db, selectionId),
  ])
  if (row?.approved || signed.has(selectionId)) return APPROVED_PICK_MESSAGE
  if (out) return OUT_FOR_SIGNATURE_MESSAGE
  return null
}
