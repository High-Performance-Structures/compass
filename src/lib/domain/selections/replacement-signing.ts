/**
 * A replacement selection's change order is its owner signature
 * (replacement.ts): when that change order is executed (signed, or its
 * acceptance recorded), the replacement becomes Approved (signed) and staff
 * get its "Order" to-do. Called after every change-order execution; it does
 * nothing for other change orders and is safe to call twice.
 */
import { and, eq, inArray } from "drizzle-orm"

import { projectChangeOrders, projectFinishSelections } from "@/db/schema"
import { projectSelectionChoices } from "@/db/schema-selection-choices"
import type { Db } from "@/lib/server/action-context"

import { EXECUTED_CHANGE_ORDER_STATUSES } from "./lock-read"
import { replacementPricingBlocker } from "./replacement-pricing"
import { ensureSelectionTodo } from "./selection-todos"
import { updateFinishSelectionsWithEventStatement } from "./store"

export async function applyExecutedReplacementChangeOrder(
  db: Db,
  input: { readonly projectId: string; readonly changeOrderId: string; readonly actorId: string | null },
): Promise<boolean> {
  try {
    const order = await db
      .select({ selectionId: projectChangeOrders.sourceRecordId })
      .from(projectChangeOrders)
      .where(
        and(
          eq(projectChangeOrders.id, input.changeOrderId),
          eq(projectChangeOrders.projectId, input.projectId),
          eq(projectChangeOrders.sourceType, "selection_replacement"),
          inArray(projectChangeOrders.status, [...EXECUTED_CHANGE_ORDER_STATUSES]),
        ),
      )
      .get()
    const selectionId = order?.selectionId
    if (!selectionId) return false
    // The owner signed for the priced pick; a selection whose pick differs isn't approved by it.
    if (!(await pickIsPriced(db, input.projectId, selectionId))) return false
    const now = new Date().toISOString()
    // Once: only while the owner's approval isn't recorded yet. The status
    // moves as a signature does (never back from ordered or installed).
    const [result] = await db.batch([
      updateFinishSelectionsWithEventStatement(
        db,
        and(eq(projectFinishSelections.id, selectionId), eq(projectFinishSelections.projectId, input.projectId), eq(projectFinishSelections.ownerApproved, false)),
        "owner_sign",
        { ownerApproved: true, approvedBy: null, approvedAt: now, updatedAt: now },
      ),
    ])
    if (result.meta.changes === 0) return false
    const row = await db
      .select({ name: projectFinishSelections.name, status: projectFinishSelections.status })
      .from(projectFinishSelections)
      .where(eq(projectFinishSelections.id, selectionId))
      .get()
    if (row?.status === "approved") {
      await ensureSelectionTodo(db, { projectId: input.projectId, selectionId, selectionName: row.name, step: "order", actorId: input.actorId, now })
    }
    return true
  } catch (error) {
    // The change order stands; staff can still set the selection by hand.
    console.error("[selections] replacement approval after its change order failed", error)
    return false
  }
}

/** The replacement's current pick, and the choice its change order is priced for (null when none). */
async function replacementPick(db: Db, projectId: string, selectionId: string): Promise<{ readonly pickId: string | null; readonly pricedId: string | null } | null> {
  const row = await db
    .select({ pricedId: projectFinishSelections.replacementPricedChoiceId, pickId: projectSelectionChoices.id })
    .from(projectFinishSelections)
    .leftJoin(projectSelectionChoices, and(eq(projectSelectionChoices.selectionId, projectFinishSelections.id), eq(projectSelectionChoices.chosen, true)))
    .where(and(eq(projectFinishSelections.id, selectionId), eq(projectFinishSelections.projectId, projectId)))
    .get()
  return row ? { pickId: row.pickId ?? null, pricedId: row.pricedId } : null
}

async function pickIsPriced(db: Db, projectId: string, selectionId: string): Promise<boolean> {
  const pick = await replacementPick(db, projectId, selectionId)
  return pick !== null && pick.pickId !== null && pick.pickId === pick.pricedId
}

/** Statuses a change order may hold without having gone to the owner. */
const NOT_SENT: ReadonlySet<string> = new Set(["draft", "void", "declined"])

/**
 * Why a selection replacement's change order may not move to `to`, or null:
 * it can't leave draft (go to the owner, be accepted or executed) until its
 * selection has a pick and the change order's pick line prices it (same
 * test as the drawer's "update the change order" flag), with any amount
 * staff must enter filled in. Other change orders are never blocked.
 */
export async function replacementChangeOrderMoveBlocker(
  db: Db,
  input: { readonly projectId: string; readonly changeOrderId: string; readonly to: string },
): Promise<string | null> {
  if (NOT_SENT.has(input.to)) return null
  const order = await db
    .select({ selectionId: projectChangeOrders.sourceRecordId })
    .from(projectChangeOrders)
    .where(and(eq(projectChangeOrders.id, input.changeOrderId), eq(projectChangeOrders.projectId, input.projectId), eq(projectChangeOrders.sourceType, "selection_replacement")))
    .get()
  if (!order?.selectionId) return null
  return replacementPricingBlocker(db, input.projectId, order.selectionId)
}
