"use server"

import { actionFailure, errorMessage, type ActionResult } from "@/lib/action-result"
import { loadAllJobsPurchaseOrders, type AllJobsPurchaseOrders } from "@/lib/domain/operations/purchase-order-lists"
import type { RecordStatusList } from "@/lib/domain/record-statuses/rules"
import { loadRecordStatusList } from "@/lib/domain/record-statuses/store"
import { parsePurchaseOrderStatusFilter, type PurchaseOrderStatusFilter } from "@/lib/purchase-orders/status-filter"
import { orgContext } from "@/lib/server/action-context"

export type AllJobsPurchaseOrderSheet = AllJobsPurchaseOrders & {
  /** The company's purchase order statuses (Settings › Statuses). */
  readonly statuses: RecordStatusList
  /** The `?status=` value read against those statuses; unknown values show Open. */
  readonly statusFilter: PurchaseOrderStatusFilter
}

/**
 * Every job's purchase orders that match a `?status=` filter, for staff with
 * the "purchase-orders" permission (the same access as a job's PO list).
 */
export async function getAllJobsPurchaseOrders(
  rawFilter: string | readonly string[] | undefined,
): Promise<ActionResult<AllJobsPurchaseOrderSheet>> {
  try {
    const context = await orgContext({ feature: "purchase-orders" })
    if (!context.success) return context
    const { db, organizationId } = context.data
    const statuses = await loadRecordStatusList(db, organizationId, "purchase_order")
    const statusFilter = parsePurchaseOrderStatusFilter(rawFilter, statuses)
    const list = await loadAllJobsPurchaseOrders(db, organizationId, statusFilter, statuses)
    return { success: true, data: { ...list, statuses, statusFilter } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to load purchase orders."))
  }
}
