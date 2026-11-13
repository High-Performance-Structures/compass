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

import { projectSelectionChoices } from "@/db/schema-selection-choices"
import type { ActivityActor } from "@/lib/activity-log"
import type { Db } from "@/lib/server/action-context"

import { approvalClearOutcome, noSettledPriceMessage } from "./approval-clear"
import { selectionPickStatements } from "./choices-store"
import { loadSelectionLock } from "./lock-read"
import { repriceReplacementChangeOrder } from "./replacement-pricing"
import { reopenForPickChangeStatement } from "./store"

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
  const state = await loadSelectionLock(db, input.projectId, input.selectionId)
  if (!state) return { ok: false, error: "Selection not found" }
  if (state.lock) return { ok: false, error: state.lock.message }
  const before = await db
    .select({ id: projectSelectionChoices.id })
    .from(projectSelectionChoices)
    .where(and(eq(projectSelectionChoices.selectionId, input.selectionId), eq(projectSelectionChoices.chosen, true)))
    .get()
  const changes = !input.chosen || before?.id !== input.choiceId
  const outcome = changes ? await approvalClearOutcome(db, { projectId: input.projectId, selectionId: input.selectionId, pickChange: true }) : "none"
  if (outcome === "refuse") return { ok: false, error: noSettledPriceMessage(state.releasedFromOrder) }

  const now = new Date().toISOString()
  // One batch: the reopen reads the previous pick (its price stays as settled), then the pick lands.
  // Both re-check the lock at write time (a selection ordered meanwhile keeps its pick).
  const pick = selectionPickStatements(db, input.selectionId, input.choiceId, input.chosen, now, {
    userId: input.actor.id,
    audience: "staff",
    note: input.note?.trim().slice(0, 500) || null,
  })
  const results = await db.batch(outcome === "clear" ? [reopenForPickChangeStatement(db, { projectId: input.projectId, selectionId: input.selectionId, now }), ...pick] : pick)
  if ((results.at(-1)?.meta.changes ?? 0) === 0) {
    const lockedNow = (await loadSelectionLock(db, input.projectId, input.selectionId))?.lock ?? null
    return { ok: false, error: lockedNow?.message ?? "The pick can't change now: its replacement change order is out for signature or executed." }
  }
  await repriceReplacementChangeOrder(db, {
    projectId: input.projectId,
    selectionId: input.selectionId,
    by: { kind: "staff", actor: input.actor, canUpdateChangeOrders: input.canUpdateChangeOrders },
  })
  return { ok: true }
}
