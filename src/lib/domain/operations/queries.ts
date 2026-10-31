/**
 * Reads for the operations module. Every query is scoped to one project (or
 * the caller's organization for the vendor directory) in SQL.
 */
import { and, asc, count, eq, gte, inArray } from "drizzle-orm"

import {
  projectBudgetApplications,
  projectBudgetLines,
  projectContacts,
  projectOperations,
  projectPurchaseOrderLines,
  projects,
  scheduleTasks,
  vendors,
} from "@/db/schema"
import { loadProjectCostCodeChoices } from "@/lib/cost-codes/catalog-server"
import { chunkD1Values } from "@/lib/d1-query"
import { cleanText } from "@/lib/shared/guards"
import {
  PROJECT_TODO_RECORD_TYPES,
  isArchivedProjectTodoStatus,
  isCompletedProjectTodoStatus,
  isProjectTodoRecordType,
} from "@/lib/project-todos"
import { purchaseOrderVendorDetails } from "@/lib/purchase-orders/vendor-details"
import type { Db } from "@/lib/server/action-context"

import { toOperationItem, toPurchaseOrderItem, toRfqItem, toTodoItem } from "./records"
import { isOpenPurchaseOrderStatus, operationSyncKind, syncQueueStatus } from "./rules"
import type { OperationRow } from "./store"
import type {
  NextScheduleItem,
  ProjectOperationsSummary,
  ProjectPurchaseOrderCostCodeOption,
  ProjectPurchaseOrderFormOptions,
  ProjectPurchaseOrderItem,
  ProjectPurchaseOrderPhaseOption,
  ProjectRfqCostCodeOption,
  ProjectRfqItem,
  ProjectSageSyncItem,
  ProjectSageSyncQueue,
  ProjectTodoItem,
} from "./types"

const TODO_RECORD_TYPES = [...PROJECT_TODO_RECORD_TYPES]

export type ProjectSageNumbers = {
  readonly projectNumber: string | null
  readonly sageJobId: string | null
  readonly sageJobNumber: string | null
}

export async function loadProjectSageNumbers(db: Db, projectId: string): Promise<ProjectSageNumbers | null> {
  const [project] = await db
    .select({
      projectNumber: projects.projectNumber,
      sageJobId: projects.sageJobId,
      sageJobNumber: projects.sageJobNumber,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  return project ?? null
}

/** How many records of these types the project has (for numbering the next one). */
export async function countProjectOperations(
  db: Db,
  projectId: string,
  recordTypes: readonly string[],
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(projectOperations)
    .where(and(eq(projectOperations.projectId, projectId), inArray(projectOperations.sourceRecordType, [...recordTypes])))
  return row?.total ?? 0
}

/** One operation on the project, optionally of one record type. */
export async function loadProjectOperation(
  db: Db,
  projectId: string,
  operationId: string,
  recordType?: string,
): Promise<OperationRow | null> {
  const [row] = await db
    .select()
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.id, operationId),
        eq(projectOperations.projectId, projectId),
        recordType === undefined ? undefined : eq(projectOperations.sourceRecordType, recordType),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function loadPurchaseOrderLineRows(
  db: Db,
  operationIds: readonly string[],
): Promise<(typeof projectPurchaseOrderLines.$inferSelect)[]> {
  const groups = await Promise.all(
    chunkD1Values(operationIds).map((ids) =>
      db
        .select()
        .from(projectPurchaseOrderLines)
        .where(inArray(projectPurchaseOrderLines.operationId, ids))
        .orderBy(asc(projectPurchaseOrderLines.operationId), asc(projectPurchaseOrderLines.lineNumber)),
    ),
  )
  return groups.flat()
}

function operationToScheduleItem(operation: OperationRow): NextScheduleItem {
  return {
    id: operation.id,
    title: operation.title,
    startDate: operation.startDate ?? operation.dueDate ?? "",
    endDate: operation.dueDate ?? operation.startDate ?? "",
    assignedTo: operation.assigneeName ?? operation.companyName,
    source: "sage_operation",
  }
}

export async function loadOperationsSummary(
  db: Db,
  projectId: string,
  canViewWorkingSchedule: boolean,
): Promise<ProjectOperationsSummary> {
  const today = new Date().toISOString().slice(0, 10)
  const [operations, [nextCompassTask]] = await Promise.all([
    db
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.projectId, projectId))
      .orderBy(asc(projectOperations.dueDate), asc(projectOperations.title)),
    db
      .select()
      .from(scheduleTasks)
      .where(
        and(
          eq(scheduleTasks.projectId, projectId),
          gte(scheduleTasks.endDateCalculated, today),
          inArray(scheduleTasks.status, ["PENDING", "IN_PROGRESS"]),
        ),
      )
      .orderBy(asc(scheduleTasks.startDate), asc(scheduleTasks.sortOrder))
      .limit(1),
  ])

  const purchaseOrders = operations.filter((operation) => operation.sourceRecordType === "purchase_order")
  const commitments = operations.filter((operation) => isProjectTodoRecordType(operation.sourceRecordType))
  const openPurchaseOrders = purchaseOrders.filter((operation) => isOpenPurchaseOrderStatus(operation.status))
  const activeCommitments = commitments.filter(
    (operation) => !isCompletedProjectTodoStatus(operation.status) && !isArchivedProjectTodoStatus(operation.status),
  )
  const nextSageOperation = activeCommitments.find(
    (operation) =>
      (operation.startDate !== null && operation.startDate >= today) ||
      (operation.dueDate !== null && operation.dueDate >= today),
  )
  const nextScheduleItem: NextScheduleItem | null = !canViewWorkingSchedule
    ? null
    : nextCompassTask
      ? {
          id: nextCompassTask.id,
          title: nextCompassTask.title,
          startDate: nextCompassTask.startDate,
          endDate: nextCompassTask.endDateCalculated,
          assignedTo: nextCompassTask.assignedTo,
          source: "compass_schedule",
        }
      : nextSageOperation
        ? operationToScheduleItem(nextSageOperation)
        : null

  return {
    openPurchaseOrderCount: openPurchaseOrders.length,
    openPurchaseOrderTotal: openPurchaseOrders.reduce((total, operation) => total + (operation.amount ?? 0), 0),
    activeCommitmentCount: activeCommitments.length,
    nextScheduleItem,
    purchaseOrders: purchaseOrders.slice(0, 5).map((operation) => toOperationItem(operation)),
    commitments: commitments.slice(0, 6).map((operation) => toOperationItem(operation)),
  }
}

export async function loadProjectTodos(db: Db, projectId: string): Promise<readonly ProjectTodoItem[]> {
  const operations = await db
    .select()
    .from(projectOperations)
    .where(and(eq(projectOperations.projectId, projectId), inArray(projectOperations.sourceRecordType, TODO_RECORD_TYPES)))
    .orderBy(asc(projectOperations.dueDate), asc(projectOperations.createdAt), asc(projectOperations.title))

  const candidateScheduleTaskIds = [
    ...new Set(operations.flatMap((operation) => (operation.sourceRecordId ? [operation.sourceRecordId] : []))),
  ]
  // Large imported jobs link hundreds of to-dos; chunks stay under D1's
  // bound-parameter limit and run together.
  const groups = await Promise.all(
    chunkD1Values(candidateScheduleTaskIds).map((ids) =>
      db
        .select({ id: scheduleTasks.id })
        .from(scheduleTasks)
        .where(and(eq(scheduleTasks.projectId, projectId), inArray(scheduleTasks.id, ids))),
    ),
  )
  const scheduleTaskIds = new Set(groups.flat().map((row) => row.id))
  return operations.map((operation) => toTodoItem(operation, scheduleTaskIds))
}

export async function loadScheduleTaskTodos(
  db: Db,
  projectId: string,
  scheduleTaskId: string,
): Promise<readonly ProjectTodoItem[]> {
  const [scheduleTask] = await db
    .select({ id: scheduleTasks.id })
    .from(scheduleTasks)
    .where(and(eq(scheduleTasks.id, scheduleTaskId), eq(scheduleTasks.projectId, projectId)))
    .limit(1)
  if (!scheduleTask) return []

  const operations = await db
    .select()
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.projectId, projectId),
        eq(projectOperations.sourceRecordId, scheduleTask.id),
        inArray(projectOperations.sourceRecordType, TODO_RECORD_TYPES),
      ),
    )
    .orderBy(asc(projectOperations.dueDate), asc(projectOperations.createdAt), asc(projectOperations.title))
  const scheduleTaskIds = new Set([scheduleTask.id])
  return operations.map((operation) => toTodoItem(operation, scheduleTaskIds))
}

export async function loadSageSyncQueue(db: Db, projectId: string): Promise<ProjectSageSyncQueue> {
  const [operationRows, applicationRows, budgetLineRows] = await Promise.all([
    db
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.projectId, projectId))
      .orderBy(asc(projectOperations.updatedAt), asc(projectOperations.title)),
    db
      .select()
      .from(projectBudgetApplications)
      .where(eq(projectBudgetApplications.projectId, projectId))
      .orderBy(asc(projectBudgetApplications.updatedAt)),
    db
      .select()
      .from(projectBudgetLines)
      .where(eq(projectBudgetLines.projectId, projectId))
      .orderBy(asc(projectBudgetLines.updatedAt), asc(projectBudgetLines.costCode)),
  ])

  const operationItems: ProjectSageSyncItem[] = operationRows
    .filter(
      (operation) =>
        operation.syncDirection === "write" ||
        operation.syncStatus !== "synced" ||
        operation.sageWriteStatus !== "not_ready",
    )
    .map((operation) => ({
      id: operation.id,
      sourceSystem: operation.sourceSystem,
      sourceRecordType: operation.sourceRecordType,
      kind: operationSyncKind(operation.sourceRecordType),
      table: "project_operations",
      title: operation.title,
      recordNumber: operation.sourceRecordNumber,
      status: operation.status,
      syncStatus: operation.syncStatus,
      sageWriteStatus: operation.sageWriteStatus,
      syncDirection: operation.syncDirection,
      amount: operation.amount,
      dueDate: operation.dueDate ?? operation.startDate,
      updatedAt: operation.updatedAt,
      detail: operation.companyName ?? operation.assigneeName,
      companyName: operation.companyName,
    }))

  const applicationItems: ProjectSageSyncItem[] = applicationRows
    .filter((application) => application.syncStatus !== "synced" && application.status !== "building")
    .map((application) => ({
      id: application.id,
      sourceSystem: null,
      sourceRecordType: null,
      kind: "budget_application",
      table: "project_budget_applications",
      title: `Pay application ${application.applicationNumber}`,
      recordNumber: application.applicationNumber,
      status: application.status,
      syncStatus: application.syncStatus,
      sageWriteStatus: null,
      syncDirection: "read",
      amount: application.currentPaymentDue,
      dueDate: application.periodTo,
      updatedAt: application.updatedAt,
      detail: application.ownerVisible ? "Owner visible" : "Internal only",
      companyName: null,
    }))

  const buildingApplicationIds = new Set(
    applicationRows.filter((application) => application.status === "building").map((application) => application.id),
  )
  const budgetLineItems: ProjectSageSyncItem[] = budgetLineRows
    .filter(
      (line) => line.syncStatus !== "synced" && (!line.applicationId || !buildingApplicationIds.has(line.applicationId)),
    )
    .slice(0, 25)
    .map((line) => ({
      id: line.id,
      sourceSystem: null,
      sourceRecordType: null,
      kind: "budget_line",
      table: "project_budget_lines",
      title: line.description,
      recordNumber: line.costCode,
      status: "budget_line",
      syncStatus: line.syncStatus,
      sageWriteStatus: null,
      syncDirection: "read",
      amount: line.currentCosts,
      dueDate: null,
      updatedAt: line.updatedAt,
      detail: `${line.csiDivision} - ${line.csiDivisionName}`,
      companyName: null,
    }))

  const pendingItems = [...operationItems, ...applicationItems, ...budgetLineItems]
  const counts = { readyCount: 0, queuedCount: 0, blockedCount: 0 }
  for (const item of pendingItems) {
    const status = syncQueueStatus(item)
    if (status === "queued") counts.queuedCount += 1
    else if (status === "blocked") counts.blockedCount += 1
    else counts.readyCount += 1
  }
  return { pendingItems, ...counts }
}

/** The supplier and subcontractor contacts plus the company vendor list, for vendor emails and addresses. */
async function loadVendorCandidates(
  db: Db,
  projectId: string,
  organizationId: string,
): Promise<Omit<Parameters<typeof purchaseOrderVendorDetails>[0], "order">> {
  const [contacts, vendorRows] = await Promise.all([
    db
      .select({
        address: projectContacts.address,
        displayName: projectContacts.displayName,
        companyName: projectContacts.companyName,
        email: projectContacts.email,
      })
      .from(projectContacts)
      .where(
        and(
          eq(projectContacts.projectId, projectId),
          eq(projectContacts.active, true),
          inArray(projectContacts.contactType, ["supplier", "subcontractor"]),
        ),
      ),
    db
      .select({
        address: vendors.address,
        name: vendors.name,
        email: vendors.email,
        netsuiteId: vendors.netsuiteId,
        sourceRecordId: vendors.sourceRecordId,
        sourceRecordNumber: vendors.sourceRecordNumber,
      })
      .from(vendors)
      .where(eq(vendors.organizationId, organizationId)),
  ])
  return { contacts, vendors: vendorRows }
}

export async function loadPurchaseOrders(
  db: Db,
  projectId: string,
  organizationId: string,
): Promise<readonly ProjectPurchaseOrderItem[]> {
  const rows = await db
    .select()
    .from(projectOperations)
    .where(and(eq(projectOperations.projectId, projectId), eq(projectOperations.sourceRecordType, "purchase_order")))
    .orderBy(asc(projectOperations.dueDate), asc(projectOperations.title))
  if (rows.length === 0) return []

  const [lines, candidates] = await Promise.all([
    loadPurchaseOrderLineRows(
      db,
      rows.map((row) => row.id),
    ),
    loadVendorCandidates(db, projectId, organizationId),
  ])
  const linesByOperation = Map.groupBy(lines, (line) => line.operationId)
  return rows.map((row) =>
    toPurchaseOrderItem(row, linesByOperation.get(row.id) ?? [], purchaseOrderVendorDetails({ order: row, ...candidates })),
  )
}

export async function loadPurchaseOrderFormOptions(
  db: Db,
  projectId: string,
): Promise<ProjectPurchaseOrderFormOptions> {
  const [projectRows, sageRows] = await Promise.all([
    db.select({ address: projects.address }).from(projects).where(eq(projects.id, projectId)).limit(1),
    loadProjectCostCodeChoices(db, projectId),
  ])
  const phaseMap = new Map<string, ProjectPurchaseOrderPhaseOption>()
  const costCodeMap = new Map<string, ProjectPurchaseOrderCostCodeOption>()
  for (const row of sageRows) {
    phaseMap.set(row.divisionCode, { value: row.divisionCode, label: row.divisionDisplayLabel })
    costCodeMap.set(row.code, {
      value: row.code,
      onBudget: row.onBudget,
      label: row.displayLabel,
      description: row.sageMapped ? row.description : `${row.description} · Needs Sage mapping review`,
      divisionCode: row.divisionCode,
    })
  }
  return {
    jobsiteAddress: cleanText(projectRows[0]?.address ?? null),
    phases: Array.from(phaseMap.values()).sort((left, right) => left.label.localeCompare(right.label)),
    costCodes: Array.from(costCodeMap.values()).sort((left, right) => left.label.localeCompare(right.label)),
  }
}

export async function loadRfqCostCodeOptions(db: Db, projectId: string): Promise<readonly ProjectRfqCostCodeOption[]> {
  const rows = await loadProjectCostCodeChoices(db, projectId)
  return rows.map((row) => ({
    value: row.code,
    onBudget: row.onBudget,
    label: row.displayLabel,
    description: row.sageMapped ? row.description : `${row.description} · Needs Sage mapping review`,
    divisionCode: row.divisionCode,
    divisionLabel: row.divisionDisplayLabel,
  }))
}

export async function loadRfqs(db: Db, projectId: string, organizationId: string): Promise<readonly ProjectRfqItem[]> {
  const rows = await db
    .select()
    .from(projectOperations)
    .where(and(eq(projectOperations.projectId, projectId), eq(projectOperations.sourceRecordType, "rfq")))
    .orderBy(asc(projectOperations.dueDate), asc(projectOperations.title))
  if (rows.length === 0) return []
  const candidates = await loadVendorCandidates(db, projectId, organizationId)
  return rows.map((row) => toRfqItem(row, purchaseOrderVendorDetails({ order: row, ...candidates }).email))
}
