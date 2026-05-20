"use server"

import { and, asc, eq, gte, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

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
  readonly syncStatus: string
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

type ProjectOperationActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

export type CreatePurchaseOrderRequestInput = {
  readonly title: string
  readonly description: string | null
  readonly companyName: string | null
  readonly assigneeName: string | null
  readonly costCode: string | null
  readonly dueDate: string | null
  readonly amount: number | null
  readonly priority: string
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

async function verifyProjectUpdateAccess(
  projectId: string
): Promise<ReturnType<typeof getDb>> {
  const user = await requireAuth()
  requirePermission(user, "project", "update")
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

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`${label} is required`)
  }
  return trimmed
}

function purchaseOrderRequestNumberFor(existingCount: number): string {
  return `PO-REQ-${String(existingCount + 1).padStart(3, "0")}`
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
    syncStatus: row.syncStatus,
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

export async function getProjectPurchaseOrders(
  projectId: string
): Promise<readonly ProjectOperationItem[]> {
  const db = await verifyProjectAccess(projectId)
  const rows = await db
    .select()
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.projectId, projectId),
        eq(projectOperations.sourceRecordType, "purchase_order")
      )
    )
    .orderBy(asc(projectOperations.dueDate), asc(projectOperations.title))

  return rows.map(toOperationItem)
}

export async function createPurchaseOrderRequest(
  projectId: string,
  input: CreatePurchaseOrderRequestInput
): Promise<ProjectOperationActionResult> {
  try {
    const db = await verifyProjectUpdateAccess(projectId)
    const purchaseOrders = await db
      .select({ id: projectOperations.id })
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "purchase_order")
        )
      )

    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const inserted: typeof projectOperations.$inferInsert = {
      id,
      projectId,
      sourceSystem: "compass",
      sourceRecordType: "purchase_order",
      sourceRecordNumber: purchaseOrderRequestNumberFor(purchaseOrders.length),
      title: requireText(input.title, "Title"),
      description: cleanText(input.description),
      status: "draft",
      priority: input.priority,
      assigneeType: "vendor",
      assigneeName: cleanText(input.assigneeName),
      companyName: cleanText(input.companyName),
      costCode: cleanText(input.costCode),
      dueDate: cleanText(input.dueDate),
      amount: input.amount,
      syncDirection: "write",
      syncStatus: "pending_sage",
      createdAt: now,
      updatedAt: now,
    }

    await db.insert(projectOperations).values(inserted)
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
    revalidatePath("/dashboard/financials")
    revalidatePath("/dashboard/schedule")

    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create purchase order request",
    }
  }
}
