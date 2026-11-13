/**
 * Staff changing a selection's pick (the owner's pick only records their
 * preference; selection-choices.ts). Owner rule: a change after an approval
 * is a change order.
 *
 * - Ordered, installed and replaced selections keep their pick (locks.ts).
 * - An approved selection (signed for its current pick, or an older
 *   approval such as a Buildertrend import) reopens for signing, and the
 *   previous pick's owner price is kept as the price already settled in the
 *   contract: its Selection Phase line then bills only the difference (a
 *   credit when cheaper), never the full overage again. With no previous
 *   pick or no owner price on it (an import that recorded nothing), there is
 *   nothing to price against, so the re-pick is refused: use Replace or a
 *   change order.
 * - A replacement's draft change order is re-priced in place for the new
 *   pick (replacement-pricing.ts) when the staff member may change change
 *   orders; otherwise it is left flagged for someone who may.
 */
import { and, eq } from "drizzle-orm"

import { projectFinishSelections } from "@/db/schema"
import { projectSelectionChoices } from "@/db/schema-selection-choices"
import type { ActivityActor } from "@/lib/activity-log"
import type { Db } from "@/lib/server/action-context"

import { setSelectionChoiceChosen } from "./choices-store"
import { loadSelectionLock } from "./lock-read"
import { repriceReplacementChangeOrder } from "./replacement-pricing"
import { signedChoices } from "./round-signing"
import { updateFinishSelectionsWithEvent } from "./store"

const NO_SETTLED_PRICE_MESSAGE =
  "This selection was approved in Buildertrend without a recorded price. Use Replace or a change order."

export type PickChangeResult = { readonly ok: true } | { readonly ok: false; readonly error: string }

export async function changePickByStaff(
  db: Db,
  input: {
    readonly projectId: string
    readonly selectionId: string
    readonly choiceId: string
    readonly chosen: boolean
    readonly note: string | null
    readonly actor: ActivityActor & { readonly id: string }
    readonly canUpdateChangeOrders: boolean
  },
): Promise<PickChangeResult> {
  const lock = (await loadSelectionLock(db, input.projectId, input.selectionId))?.lock ?? null
  if (lock) return { ok: false, error: lock.message }
  const [selection, before, signed] = await Promise.all([
    db
      .select({ ownerApproved: projectFinishSelections.ownerApproved })
      .from(projectFinishSelections)
      .where(and(eq(projectFinishSelections.id, input.selectionId), eq(projectFinishSelections.projectId, input.projectId)))
      .get(),
    db
      .select({ id: projectSelectionChoices.id, ownerPriceCents: projectSelectionChoices.ownerPriceCents })
      .from(projectSelectionChoices)
      .where(and(eq(projectSelectionChoices.selectionId, input.selectionId), eq(projectSelectionChoices.chosen, true)))
      .get(),
    signedChoices(db, [input.selectionId]),
  ])
  if (!selection) return { ok: false, error: "Selection not found" }
  const changes = !input.chosen || before?.id !== input.choiceId
  const wasApproved = selection.ownerApproved || (before !== undefined && signed.get(input.selectionId) === before.id)
  const settled = before?.ownerPriceCents ?? null
  if (wasApproved && changes && settled === null) return { ok: false, error: NO_SETTLED_PRICE_MESSAGE }

  const now = new Date().toISOString()
  // The write re-checks the lock (a selection ordered meanwhile keeps its pick).
  const picked = await setSelectionChoiceChosen(db, input.selectionId, input.choiceId, input.chosen, now, {
    userId: input.actor.id,
    audience: "staff",
    note: input.note?.trim().slice(0, 500) || null,
  })
  if (!picked) {
    const lockedNow = (await loadSelectionLock(db, input.projectId, input.selectionId))?.lock ?? null
    return { ok: false, error: lockedNow?.message ?? "The pick can't change now: its replacement change order is out for signature or executed." }
  }
  if (wasApproved && changes) {
    // Back to the owner for signing; the next Selection Phase bills the difference from the settled price.
    await updateFinishSelectionsWithEvent(
      db,
      and(eq(projectFinishSelections.id, input.selectionId), eq(projectFinishSelections.projectId, input.projectId)),
      "reopen",
      { ownerApproved: false, approvedBy: null, approvedAt: null, settledOwnerPriceCents: settled, updatedAt: now },
    )
  }
  await repriceReplacementChangeOrder(db, {
    projectId: input.projectId,
    selectionId: input.selectionId,
    by: { kind: "staff", actor: input.actor, canUpdateChangeOrders: input.canUpdateChangeOrders },
  })
  return { ok: true }
}
