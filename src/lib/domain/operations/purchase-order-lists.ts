/**
 * Reads for the company-wide purchase order sheet (every job's POs). Every
 * query is scoped to the caller's organization (through the PO's project)
 * in SQL.
 */
import { and, asc, count, eq, inArray } from "drizzle-orm"

import { projectOperations, projects } from "@/db/schema"
import { purchaseOrderMatchesFilter, type PurchaseOrderStatusFilter } from "@/lib/purchase-orders/status-filter"
import type { Db } from "@/lib/server/action-context"

import type { PurchaseOrderListRow } from "./types"

const purchaseOrderListColumns = {
  id: projectOperations.id,
  projectId: projectOperations.projectId,
  projectNumber: projects.projectNumber,
  projectName: projects.name,
  number: projectOperations.sourceRecordNumber,
  title: projectOperations.title,
  description: projectOperations.description,
  vendorName: projectOperations.companyName,
  status: projectOperations.status,
  siteContactName: projectOperations.assigneeName,
  orderDate: projectOperations.sageOrderDate,
  dueDate: projectOperations.dueDate,
  amount: projectOperations.amount,
}

export type AllJobsPurchaseOrders = {
  readonly rows: readonly PurchaseOrderListRow[]
  /** How many POs carry each stored status, for the filter buttons' counts. */
  readonly statusCounts: readonly { readonly status: string; readonly count: number }[]
}

/**
 * The organization's POs that match a status filter, across every job.
 * Stored statuses vary in spelling, so the few distinct values are counted
 * first and classified with the shared filter rules; the rows are then read
 * by their exact stored values.
 */
export async function loadAllJobsPurchaseOrders(
  db: Db,
  organizationId: string,
  filter: PurchaseOrderStatusFilter,
): Promise<AllJobsPurchaseOrders> {
  const scope = and(eq(projectOperations.sourceRecordType, "purchase_order"), eq(projects.organizationId, organizationId))
  const statusCounts = await db
    .select({ status: projectOperations.status, count: count() })
    .from(projectOperations)
    .innerJoin(projects, eq(projects.id, projectOperations.projectId))
    .where(scope)
    .groupBy(projectOperations.status)
  const statuses = statusCounts.map((row) => row.status).filter((status) => purchaseOrderMatchesFilter(status, filter))
  if (statuses.length === 0) return { rows: [], statusCounts }
  const rows = await db
    .select(purchaseOrderListColumns)
    .from(projectOperations)
    .innerJoin(projects, eq(projects.id, projectOperations.projectId))
    .where(and(scope, inArray(projectOperations.status, statuses)))
    .orderBy(asc(projectOperations.dueDate), asc(projectOperations.sourceRecordNumber))
  return { rows, statusCounts }
}
