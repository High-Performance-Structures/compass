"use server"

import { actionFailure, errorMessage, type ActionResult } from "@/lib/action-result"
import { loadAllJobsPurchaseOrders, type AllJobsPurchaseOrders } from "@/lib/domain/operations/purchase-order-lists"
import type { PurchaseOrderStatusFilter } from "@/lib/purchase-orders/status-filter"
import { orgContext } from "@/lib/server/action-context"

/**
 * Every job's purchase orders that match a status filter, for staff with the
 * "purchase-orders" permission (the same access as a job's PO list).
 */
export async function getAllJobsPurchaseOrders(
  filter: PurchaseOrderStatusFilter,
): Promise<ActionResult<AllJobsPurchaseOrders>> {
  try {
    const context = await orgContext({ feature: "purchase-orders" })
    if (!context.success) return context
    return { success: true, data: await loadAllJobsPurchaseOrders(context.data.db, context.data.organizationId, filter) }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to load purchase orders."))
  }
}
