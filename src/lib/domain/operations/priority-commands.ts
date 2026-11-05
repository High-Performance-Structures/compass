/**
 * Saving one ordering-priority move: read the moved span, plan it, rank the
 * organization's unranked rows first when the span needs it, and write the
 * plan in one all-or-nothing statement. No auth here: the caller resolves the
 * action context first.
 */
import type { Db } from "@/lib/server/action-context"

import { planPriorityReorder } from "./priority-order"
import { loadPriorityOrderRows } from "./priority-queries"
import { applyPriorityRankUpdates, rankUnrankedOperations } from "./store"
import type { PriorityOrderScope } from "./types"

export type PriorityReorderResult =
  | { readonly kind: "saved"; readonly changed: number; readonly projectIds: readonly string[] }
  | { readonly kind: "unchanged" }
  | { readonly kind: "stale" }
  | { readonly kind: "invalid"; readonly reason: string }

export async function savePriorityReorder(
  db: Db,
  input: {
    readonly organizationId: string
    readonly recordType: string
    readonly scope: PriorityOrderScope
    readonly previousIds: readonly string[]
    readonly orderedIds: readonly string[]
  },
): Promise<PriorityReorderResult> {
  const { organizationId, recordType, scope, previousIds, orderedIds } = input
  const where = { organizationId, recordType, scope, ids: previousIds }
  let rows = await loadPriorityOrderRows(db, where)
  let plan = planPriorityReorder({ items: rows, previousIds, orderedIds })
  if (plan.kind === "unranked") {
    // The first move that touches unranked rows ranks all of the
    // organization's unranked rows in the order they already sort in, so rows
    // outside this list (another job's older POs) keep their place.
    await rankUnrankedOperations(db, { organizationId, recordType })
    rows = await loadPriorityOrderRows(db, where)
    plan = planPriorityReorder({ items: rows, previousIds, orderedIds })
  }
  if (plan.kind === "invalid") return plan
  if (plan.kind === "stale" || plan.kind === "unranked") return { kind: "stale" }
  if (plan.kind === "unchanged") return plan
  const changed = await applyPriorityRankUpdates(db, { organizationId, recordType, updates: plan.updates })
  if (changed !== plan.updates.length) return { kind: "stale" }
  return { kind: "saved", changed, projectIds: [...new Set(rows.map((row) => row.projectId))] }
}
