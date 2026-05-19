"use server"

import { and, asc, eq, gte, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import { projectOperations, projects, scheduleTasks } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"

export type ProjectOperationItem = {
  readonly id: string
  readonly sourceSystem: string
  readonly sourceRecordType: string
  readonly sourceRecordNumber: string | null
  readonly title: string
  readonly status: string
  readonly priority: string
  readonly assigneeType: string | null
  readonly assigneeName: string | null
  readonly companyName: string | null
  readonly costCode: string | null
  readonly startDate: string | null
  readonly dueDate: string | null
  readonly amount: number | null
}

export type NextScheduleItem = {
  readonly id: string
  readonly title: string
  readonly startDate: string
  readonly endDate: string
  readonly assignedTo: string | null
  readonly source: "compass_schedule" | "sage_operation"
}

export type ProjectOperationsSummary = {
  readonly openPurchaseOrderCount: number
  readonly openPurchaseOrderTotal: number
  readonly activeCommitmentCount: number
  readonly nextScheduleItem: NextScheduleItem | null
  readonly purchaseOrders: readonly ProjectOperationItem[]
  readonly commitments: readonly ProjectOperationItem[]
}

async function verifyProjectAccess(
  projectId: string
): Promise<ReturnType<typeof getDb>> {
  const user = await requireAuth()
  requirePermission(user, "project", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)

  if (!existing[0]) {
    throw new Error("Project not found")
  }

  return db
}

function toOperationItem(row: typeof projectOperations.$inferSelect): ProjectOperationItem {
  return {
    id: row.id,
    sourceSystem: row.sourceSystem,
    sourceRecordType: row.sourceRecordType,
    sourceRecordNumber: row.sourceRecordNumber,
    title: row.title,
    status: row.status,
    priority: row.priority,
    assigneeType: row.assigneeType,
    assigneeName: row.assigneeName,
    companyName: row.companyName,
    costCode: row.costCode,
    startDate: row.startDate,
    dueDate: row.dueDate,
    amount: row.amount,
  }
}

function operationToScheduleItem(
  operation: typeof projectOperations.$inferSelect
): NextScheduleItem {
  return {
    id: operation.id,
    title: operation.title,
    startDate: operation.startDate ?? operation.dueDate ?? "",
    endDate: operation.dueDate ?? operation.startDate ?? "",
    assignedTo: operation.assigneeName ?? operation.companyName,
    source: "sage_operation",
  }
}

export async function getProjectOperationsSummary(
  projectId: string
): Promise<ProjectOperationsSummary> {
  const db = await verifyProjectAccess(projectId)
  const today = new Date().toISOString().slice(0, 10)

  const operations = await db
    .select()
    .from(projectOperations)
    .where(eq(projectOperations.projectId, projectId))
    .orderBy(asc(projectOperations.dueDate), asc(projectOperations.title))

  const purchaseOrders = operations.filter(
    (operation) => operation.sourceRecordType === "purchase_order"
  )
  const commitments = operations.filter((operation) =>
    [
      "staff_task",
      "subcontractor_task",
      "supplier_task",
      "schedule_task",
    ].includes(operation.sourceRecordType)
  )

  const openPurchaseOrders = purchaseOrders.filter(
    (operation) => !["closed", "void", "complete"].includes(operation.status)
  )
  const activeCommitments = commitments.filter(
    (operation) => !["complete", "cancelled"].includes(operation.status)
  )

  const [nextCompassTask] = await db
    .select()
    .from(scheduleTasks)
    .where(
      and(
        eq(scheduleTasks.projectId, projectId),
        gte(scheduleTasks.endDateCalculated, today),
        inArray(scheduleTasks.status, ["PENDING", "IN_PROGRESS"])
      )
    )
    .orderBy(asc(scheduleTasks.startDate), asc(scheduleTasks.sortOrder))
    .limit(1)

  const nextSageOperation = activeCommitments.find(
    (operation) =>
      (operation.startDate !== null && operation.startDate >= today) ||
      (operation.dueDate !== null && operation.dueDate >= today)
  )

  const nextScheduleItem = nextCompassTask
    ? {
        id: nextCompassTask.id,
        title: nextCompassTask.title,
        startDate: nextCompassTask.startDate,
        endDate: nextCompassTask.endDateCalculated,
        assignedTo: nextCompassTask.assignedTo,
        source: "compass_schedule" as const,
      }
    : nextSageOperation
      ? operationToScheduleItem(nextSageOperation)
      : null

  return {
    openPurchaseOrderCount: openPurchaseOrders.length,
    openPurchaseOrderTotal: openPurchaseOrders.reduce(
      (total, operation) => total + (operation.amount ?? 0),
      0
    ),
    activeCommitmentCount: activeCommitments.length,
    nextScheduleItem,
    purchaseOrders: purchaseOrders.slice(0, 5).map(toOperationItem),
    commitments: commitments.slice(0, 6).map(toOperationItem),
  }
}
