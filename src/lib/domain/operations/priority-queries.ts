/**
 * Reads for ordering priority and the company-wide purchase order queue.
 * Every query is scoped to the caller's organization (through the row's
 * project) in SQL.
 */
import { and, asc, eq, inArray, max, notInArray, sql } from "drizzle-orm"

import { projectOperations, projects } from "@/db/schema"
import { chunkD1Values } from "@/lib/d1-query"
import { PURCHASE_ORDER_ORDERED_OR_DONE_STATUSES } from "@/lib/project-operations/status"
import type { Db } from "@/lib/server/action-context"

import type { PriorityRankedItem } from "./priority-order"
import type { PriorityOrderScope, PurchaseOrderListRow } from "./types"

/** Ranked rows first by rank, then unranked oldest first (priority-order.ts). */
export const PRIORITY_ORDER_BY = [
  sql`${projectOperations.priorityRank} IS NULL`,
  asc(projectOperations.priorityRank),
  asc(projectOperations.createdAt),
  asc(projectOperations.sourceRecordNumber),
  asc(projectOperations.id),
] as const

export type PriorityOrderRow = PriorityRankedItem & { readonly projectId: string }

/** The rows a reorder names, as stored now, limited to the scope it came from. */
export async function loadPriorityOrderRows(
  db: Db,
  input: {
    readonly organizationId: string
    readonly recordType: string
    readonly scope: PriorityOrderScope
    readonly ids: readonly string[]
  },
): Promise<readonly PriorityOrderRow[]> {
  const chunks = await Promise.all(
    chunkD1Values(input.ids).map((ids) =>
      db
        .select({
          id: projectOperations.id,
          projectId: projectOperations.projectId,
          priorityRank: projectOperations.priorityRank,
          createdAt: projectOperations.createdAt,
          number: projectOperations.sourceRecordNumber,
        })
        .from(projectOperations)
        .innerJoin(projects, eq(projects.id, projectOperations.projectId))
        .where(
          and(
            inArray(projectOperations.id, ids),
            eq(projectOperations.sourceRecordType, input.recordType),
            eq(projects.organizationId, input.organizationId),
            input.scope.kind === "project" ? eq(projectOperations.projectId, input.scope.projectId) : undefined,
          ),
        ),
    ),
  )
  return chunks.flat()
}

/** The highest rank in the organization's shared order for a record type. */
export async function loadMaxPriorityRank(db: Db, organizationId: string, recordType: string): Promise<number | null> {
  const [row] = await db
    .select({ value: max(projectOperations.priorityRank) })
    .from(projectOperations)
    .innerJoin(projects, eq(projects.id, projectOperations.projectId))
    .where(and(eq(projectOperations.sourceRecordType, recordType), eq(projects.organizationId, organizationId)))
  return row?.value ?? null
}

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

/**
 * The ordering queue: every purchase order across the organization's jobs
 * that is not yet ordered, received or finished, in priority order.
 */
export async function loadPurchaseOrderQueue(db: Db, organizationId: string): Promise<readonly PurchaseOrderListRow[]> {
  return db
    .select(purchaseOrderListColumns)
    .from(projectOperations)
    .innerJoin(projects, eq(projects.id, projectOperations.projectId))
    .where(
      and(
        eq(projectOperations.sourceRecordType, "purchase_order"),
        eq(projects.organizationId, organizationId),
        // Stored statuses can differ in case or spacing ("Partially received").
        notInArray(sql`replace(lower(trim(${projectOperations.status})), ' ', '_')`, [...PURCHASE_ORDER_ORDERED_OR_DONE_STATUSES]),
      ),
    )
    .orderBy(...PRIORITY_ORDER_BY)
}
