/**
 * The one follow-up step after a change order is executed, by any path:
 * staff marking it executed, recorded manual acceptance, a signed
 * change-order estimate (Foxit or manual acceptance), a baseline
 * replacement, a signed Selection Phase, or an approved variance. Every
 * execution path calls this once its execution batch has landed; each
 * follow-up is safe to run twice and only acts on its own change orders.
 *
 * Today: a selection replacement's change order approves the replacement
 * selection and adds its "Order" to-do.
 */
import { applyExecutedReplacementChangeOrder, replacementChangeOrderMoveBlocker } from "@/lib/domain/selections/replacement-signing"
import type { Db } from "@/lib/server/action-context"

export async function afterChangeOrdersExecuted(
  db: Db,
  input: { readonly projectId: string; readonly changeOrderIds: readonly (string | null | undefined)[]; readonly actorId: string | null },
): Promise<void> {
  for (const changeOrderId of new Set(input.changeOrderIds)) {
    if (!changeOrderId) continue
    // Never fails the execution that already landed; each follow-up logs its own failure.
    await applyExecutedReplacementChangeOrder(db, { projectId: input.projectId, changeOrderId, actorId: input.actorId })
  }
}

/**
 * Why a change order may not move to `to` (out of draft toward the owner,
 * or executed), or null. Every status change checks it: today a selection
 * replacement's change order must be priced for its selection's pick.
 */
export async function changeOrderMoveBlocker(
  db: Db,
  input: { readonly projectId: string; readonly changeOrderId: string; readonly to: string },
): Promise<string | null> {
  return replacementChangeOrderMoveBlocker(db, input)
}
