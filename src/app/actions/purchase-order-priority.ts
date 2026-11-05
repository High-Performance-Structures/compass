"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { recordActivityEvent } from "@/lib/activity-log"
import { actionFailure, errorMessage, type ActionDone, type ActionResult } from "@/lib/action-result"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { operationsContext } from "@/lib/domain/operations/access"
import { planPriorityReorder, PRIORITY_REORDER_MAX_ITEMS } from "@/lib/domain/operations/priority-order"
import { loadMaxPriorityRank, loadPriorityOrderRows, loadPurchaseOrderQueue } from "@/lib/domain/operations/priority-queries"
import { applyPriorityRankUpdates } from "@/lib/domain/operations/store"
import type { PriorityOrderScope, PurchaseOrderListRow } from "@/lib/domain/operations/types"
import { canFeature } from "@/lib/permission-enforcement"
import { orgContext, type OrgContext } from "@/lib/server/action-context"

/*
 * Ordering priority for purchase orders: the purchaser's ranked list of which
 * POs to order first. One shared rank per PO; a job's PO list shows the same
 * relative order filtered to that job. Reading follows the "purchase-orders"
 * permission; changing the order needs its update level.
 */

const PURCHASE_ORDER = "purchase_order"
const STALE = "The order changed since this list loaded. Refresh and try again."

const reorderInput = z.object({
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("project"), projectId: z.string().min(1) }),
    z.object({ kind: z.literal("organization") }),
  ]),
  previousIds: z.array(z.string().min(1)).min(1).max(PRIORITY_REORDER_MAX_ITEMS),
  orderedIds: z.array(z.string().min(1)).min(1).max(PRIORITY_REORDER_MAX_ITEMS),
})

/** May this viewer change the order? Read-only demo accounts may not. */
async function canReorder(context: Pick<OrgContext, "user" | "organizationId">): Promise<boolean> {
  if (isDemoUser(context.user.id) || isDemoOrg(context.organizationId)) return false
  return canFeature(context.user, "purchase-orders", "update")
}

export type PurchaseOrderQueue = {
  readonly rows: readonly PurchaseOrderListRow[]
  readonly canReorder: boolean
}

/** Every PO across the company's jobs still waiting to be ordered, in priority order. */
export async function getPurchaseOrderQueue(): Promise<ActionResult<PurchaseOrderQueue>> {
  try {
    const context = await orgContext({ feature: "purchase-orders" })
    if (!context.success) return context
    const [rows, reorder] = await Promise.all([
      loadPurchaseOrderQueue(context.data.db, context.data.organizationId),
      canReorder(context.data),
    ])
    return { success: true, data: { rows, canReorder: reorder } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to load the ordering queue."))
  }
}

/** Whether the viewer may change a job's PO order (the list itself comes with the page). */
export async function canReorderProjectPurchaseOrders(projectId: string): Promise<boolean> {
  try {
    const context = await operationsContext(projectId, "purchase-orders", false)
    return canReorder(context)
  } catch {
    return false
  }
}

async function reorderContext(scope: PriorityOrderScope): Promise<ActionResult<OrgContext>> {
  if (scope.kind === "organization") return orgContext({ feature: "purchase-orders", mutation: true })
  try {
    const context = await operationsContext(scope.projectId, "purchase-orders", true)
    return { success: true, data: context }
  } catch (error) {
    return actionFailure(errorMessage(error, "Project not found"))
  }
}

export async function reorderPurchaseOrderPriority(input: {
  readonly scope: PriorityOrderScope
  readonly previousIds: readonly string[]
  readonly orderedIds: readonly string[]
}): Promise<ActionDone> {
  try {
    const parsed = reorderInput.safeParse(input)
    if (!parsed.success) return actionFailure("Invalid purchase order order.")
    const { scope, previousIds, orderedIds } = parsed.data
    const context = await reorderContext(scope)
    if (!context.success) return context
    const { db, organizationId, user } = context.data

    const [rows, maxRank] = await Promise.all([
      loadPriorityOrderRows(db, { organizationId, recordType: PURCHASE_ORDER, scope, ids: previousIds }),
      loadMaxPriorityRank(db, organizationId, PURCHASE_ORDER),
    ])
    const plan = planPriorityReorder({ items: rows, previousIds, orderedIds, maxRank })
    if (plan.kind === "invalid") return actionFailure(plan.reason)
    if (plan.kind === "stale") return actionFailure(STALE)
    if (plan.kind === "unchanged") return { success: true }

    const changed = await applyPriorityRankUpdates(db, { organizationId, recordType: PURCHASE_ORDER, updates: plan.updates })
    if (changed !== plan.updates.length) return actionFailure(STALE)

    const projectIds = new Set(rows.map((row) => row.projectId))
    const [onlyProjectId] = projectIds
    await recordActivityEvent({
      db,
      organizationId,
      projectId: projectIds.size === 1 ? onlyProjectId : null,
      actor: user,
      category: "financial",
      action: "purchase_orders_reordered",
      entityType: "project_operation",
      entityId: null,
      summary: `Changed the ordering priority of ${plan.updates.length} purchase order${plan.updates.length === 1 ? "" : "s"}.`,
      metadata: {
        scope: scope.kind,
        previousOrder: JSON.stringify(previousIds),
        savedOrder: JSON.stringify(orderedIds),
      },
    })

    revalidatePath("/dashboard/purchase-orders")
    for (const projectId of projectIds) revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
    return { success: true }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to save the purchase order order."))
  }
}
