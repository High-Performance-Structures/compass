/**
 * Reads for ordering priority and the company-wide purchase order queue.
 * Every query is scoped to the caller's organization (through the row's
 * project) in SQL.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm"

import { projectJobStatuses, projectOperations, projects } from "@/db/schema"
import { isPurchaseOrderAwaitingOrder } from "@/lib/project-operations/status"
import { projectJobStatusBucket, projectJobStatusLabel } from "@/lib/project-profile"
import type { Db } from "@/lib/server/action-context"

import type { PriorityRankedItem } from "./priority-order"
import type { PriorityOrderScope, PurchaseOrderListRow } from "./types"

/**
 * Ranked rows first by rank, then unranked oldest first. priority-order.ts
 * compares in exactly this order, and rankUnrankedOperations ranks in it.
 */
export const PRIORITY_ORDER_BY = [
  sql`${projectOperations.priorityRank} IS NULL`,
  asc(projectOperations.priorityRank),
  asc(projectOperations.createdAt),
  asc(projectOperations.sourceRecordNumber),
  asc(projectOperations.id),
] as const

export type PriorityOrderRow = PriorityRankedItem & { readonly projectId: string }

/**
 * The rows a reorder names, as stored now, limited to the scope it came from.
 * The ids travel as one JSON parameter, so a long span is one query.
 */
export async function loadPriorityOrderRows(
  db: Db,
  input: {
    readonly organizationId: string
    readonly recordType: string
    readonly scope: PriorityOrderScope
    readonly ids: readonly string[]
  },
): Promise<readonly PriorityOrderRow[]> {
  if (input.ids.length === 0) return []
  return db
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
        sql`${projectOperations.id} IN (SELECT value FROM json_each(${JSON.stringify(input.ids)}))`,
        eq(projectOperations.sourceRecordType, input.recordType),
        eq(projects.organizationId, input.organizationId),
        input.scope.kind === "project" ? eq(projectOperations.projectId, input.scope.projectId) : undefined,
      ),
    )
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
 * The ordering queue: every purchase order on the organization's open jobs
 * (not complete, closed or archived) that is not yet ordered, received or
 * finished, in priority order.
 *
 * Stored statuses and job statuses vary in spelling, so the few distinct
 * values are read first and classified with the same rules the rest of
 * Compass uses; the queue itself then filters on the exact stored values.
 */
export async function loadPurchaseOrderQueue(db: Db, organizationId: string): Promise<readonly PurchaseOrderListRow[]> {
  const [statusRows, jobStatusRows] = await Promise.all([
    db
      .selectDistinct({ status: projectOperations.status })
      .from(projectOperations)
      .innerJoin(projects, eq(projects.id, projectOperations.projectId))
      .where(and(eq(projectOperations.sourceRecordType, "purchase_order"), eq(projects.organizationId, organizationId))),
    db
      .selectDistinct({ jobStatusId: projects.jobStatusId, customLabel: projectJobStatuses.label })
      .from(projects)
      .leftJoin(projectJobStatuses, eq(projectJobStatuses.id, projects.jobStatusId))
      .where(eq(projects.organizationId, organizationId)),
  ])
  const awaiting = statusRows.map((row) => row.status).filter(isPurchaseOrderAwaitingOrder)
  const openJobStatusIds = [
    ...new Set(
      jobStatusRows
        .filter((row) => {
          const bucket = projectJobStatusBucket({
            jobStatusId: row.jobStatusId,
            jobStatusLabel: projectJobStatusLabel(row),
          })
          return bucket !== "complete" && bucket !== "archive"
        })
        .map((row) => row.jobStatusId),
    ),
  ]
  if (awaiting.length === 0 || openJobStatusIds.length === 0) return []
  return db
    .select(purchaseOrderListColumns)
    .from(projectOperations)
    .innerJoin(projects, eq(projects.id, projectOperations.projectId))
    .where(
      and(
        eq(projectOperations.sourceRecordType, "purchase_order"),
        eq(projects.organizationId, organizationId),
        inArray(projectOperations.status, awaiting),
        inArray(projects.jobStatusId, openJobStatusIds),
      ),
    )
    .orderBy(...PRIORITY_ORDER_BY)
}
