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
import { applyExecutedReplacementChangeOrder } from "@/lib/domain/selections/replacement-signing"
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
