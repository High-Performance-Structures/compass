/**
 * Reads for the company-wide purchase order sheet (every job's POs). Every
 * query is scoped to the caller's organization (through the PO's project)
 * in SQL.
 */
import { and, asc, count, eq, inArray, sql } from "drizzle-orm"

import { projectOperations, projects } from "@/db/schema"
import { activeRegistryProject } from "@/lib/project-registry-visibility"
import type { RecordStatusList } from "@/lib/domain/record-statuses/rules"
import { purchaseOrderMatchesFilter, type PurchaseOrderStatusFilter } from "@/lib/purchase-orders/status-filter"
import type { Db } from "@/lib/server/action-context"

import type { PurchaseOrderListRow } from "./types"

/** The most POs one sheet loads; beyond it the page asks to narrow by status. */
export const ALL_JOBS_PURCHASE_ORDER_LIMIT = 500

/** The table shows two lines of description, so it gets a short preview, never the full text. */
export const PURCHASE_ORDER_DESCRIPTION_PREVIEW = 200

const purchaseOrderListColumns = {
  id: projectOperations.id,
  projectId: projectOperations.projectId,
  projectNumber: projects.projectNumber,
  projectName: projects.name,
  number: projectOperations.sourceRecordNumber,
  title: projectOperations.title,
  description: sql<string | null>`substr(${projectOperations.description}, 1, ${PURCHASE_ORDER_DESCRIPTION_PREVIEW})`,
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
  /** More POs match than ALL_JOBS_PURCHASE_ORDER_LIMIT; only the first are listed. */
  readonly truncated: boolean
}

/**
 * The organization's POs that match a status filter, across every job the
 * project registry shows (the same projects the project list shows), first
 * by required date, up to ALL_JOBS_PURCHASE_ORDER_LIMIT.
 *
 * Stored statuses vary in spelling, so the few distinct values are counted
 * first and classified with the company's status rules (`statuses`); the rows are then read
 * by their exact stored values. Both reads start from the organization's
 * projects and reach its POs through the project index.
 */
export async function loadAllJobsPurchaseOrders(
  db: Db,
  organizationId: string,
  filter: PurchaseOrderStatusFilter,
  statuses: RecordStatusList,
): Promise<AllJobsPurchaseOrders> {
  const scope = and(
    eq(projects.organizationId, organizationId),
    activeRegistryProject(db),
    eq(projectOperations.sourceRecordType, "purchase_order"),
  )
  const statusCounts = await db
    .select({ status: projectOperations.status, count: count() })
    .from(projects)
    .innerJoin(projectOperations, eq(projectOperations.projectId, projects.id))
    .where(scope)
    .groupBy(projectOperations.status)
  const matching = statusCounts.map((row) => row.status).filter((status) => purchaseOrderMatchesFilter(status, filter, statuses))
  if (matching.length === 0) return { rows: [], statusCounts, truncated: false }
  const rows = await db
    .select(purchaseOrderListColumns)
    .from(projects)
    .innerJoin(projectOperations, eq(projectOperations.projectId, projects.id))
    .where(filter === "all" ? scope : and(scope, inArray(projectOperations.status, matching)))
    // Blank required dates last, as the sheet sorts them.
    .orderBy(sql`${projectOperations.dueDate} IS NULL`, asc(projectOperations.dueDate), asc(projectOperations.sourceRecordNumber))
    .limit(ALL_JOBS_PURCHASE_ORDER_LIMIT + 1)
  const truncated = rows.length > ALL_JOBS_PURCHASE_ORDER_LIMIT
  return { rows: truncated ? rows.slice(0, ALL_JOBS_PURCHASE_ORDER_LIMIT) : rows, statusCounts, truncated }
}
