/**
 * The only code that inserts, updates, or deletes the operations tables:
 * project_operations (to-dos, purchase orders, RFQs, and the Sage queue
 * rows other modules file there), project_purchase_order_lines,
 * project_todo_events, the project_rfq_* tables, and the estimate RFQ bid
 * imports (architecture standard, section 1). No auth here: callers resolve
 * the action context first.
 *
 * Functions named `...Query` or `...Statement` return an unexecuted
 * statement so a caller can put it in one atomic batch with another
 * module's write (a pay application, a Nu-Tech workflow, an estimate line).
 * Where a caller narrows a write with its own condition (an optimistic
 * `updatedAt` check, a status guard), it passes that condition in; the store
 * still owns the statement.
 */
import { and, eq, inArray, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import { projectOperations, projectPurchaseOrderLines, projectTodoEvents } from "@/db/schema"
import {
  projectEstimateRfqBidImportLines,
  projectEstimateRfqBidImports,
  projectRfqBidApprovals,
  projectRfqEmailDeliveries,
  projectRfqManualResponseEvents,
  projectRfqQuoteLinks,
} from "@/db/schema-rfqs"
import type { Db } from "@/lib/server/action-context"

import { todoEventRow, type TodoEventInput } from "./rules"

export type OperationRow = typeof projectOperations.$inferSelect
export type OperationInsert = typeof projectOperations.$inferInsert
export type OperationUpdate = Partial<OperationInsert>
type PurchaseOrderLineInsert = typeof projectPurchaseOrderLines.$inferInsert
type PurchaseOrderLineUpdate = Partial<PurchaseOrderLineInsert>
type RfqEmailDeliveryInsert = typeof projectRfqEmailDeliveries.$inferInsert
type RfqEmailDeliveryUpdate = Partial<RfqEmailDeliveryInsert>
type RfqQuoteLinkInsert = typeof projectRfqQuoteLinks.$inferInsert
type RfqQuoteLinkUpdate = Partial<RfqQuoteLinkInsert>

export type OperationVersion = { readonly id: string; readonly updatedAt: string }

// ---------------------------------------------------------------------------
// project_operations
// ---------------------------------------------------------------------------

export function operationInsertQuery(
  db: Db,
  rows: OperationInsert | readonly OperationInsert[],
): BatchItem<"sqlite"> {
  return db.insert(projectOperations).values(Array.isArray(rows) ? [...rows] : [rows])
}

export async function insertOperations(
  db: Db,
  rows: OperationInsert | readonly OperationInsert[],
): Promise<void> {
  await db.insert(projectOperations).values(Array.isArray(rows) ? [...rows] : [rows])
}

/** Inserts the row unless one with the same id already exists. */
export async function insertOperationIfAbsent(db: Db, row: OperationInsert): Promise<void> {
  await db.insert(projectOperations).values(row).onConflictDoNothing({ target: projectOperations.id })
}

export function operationUpdateQuery(
  db: Db,
  where: SQL | undefined,
  values: OperationUpdate,
): BatchItem<"sqlite"> {
  return db.update(projectOperations).set(values).where(where)
}

/** Returns how many rows changed, for callers that guard a concurrent edit. */
export async function updateOperations(
  db: Db,
  where: SQL | undefined,
  values: OperationUpdate,
): Promise<number> {
  const result = await db.update(projectOperations).set(values).where(where).run()
  return result.meta.changes ?? 0
}

export async function updateOperationById(db: Db, id: string, values: OperationUpdate): Promise<void> {
  await db.update(projectOperations).set(values).where(eq(projectOperations.id, id))
}

export async function updateOperationsReturning(
  db: Db,
  where: SQL | undefined,
  values: OperationUpdate,
): Promise<OperationVersion[]> {
  return db
    .update(projectOperations)
    .set(values)
    .where(where)
    .returning({ id: projectOperations.id, updatedAt: projectOperations.updatedAt })
}

export function operationDeleteQuery(db: Db, where: SQL | undefined): BatchItem<"sqlite"> {
  return db.delete(projectOperations).where(where)
}

export async function deleteOperations(db: Db, where: SQL | undefined): Promise<void> {
  await db.delete(projectOperations).where(where)
}

export async function deleteOperationsReturning(
  db: Db,
  where: SQL | undefined,
): Promise<{ id: string }[]> {
  return db.delete(projectOperations).where(where).returning({ id: projectOperations.id })
}

/**
 * A to-do linked to a schedule item made from a project template, as a raw
 * D1 statement so the template import can commit it in the same batch as the
 * schedule rows.
 */
export function templateTodoInsertStatement(
  database: D1Database,
  todo: {
    readonly id: string
    readonly projectId: string
    readonly scheduleTaskId: string
    readonly title: string
    readonly description: string | null
    readonly startDate: string
    readonly dueDate: string
    readonly payloadJson: string
    readonly now: string
  },
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO project_operations (
        id, project_id, source_system, source_record_type,
        source_record_id, title, description, status, priority,
        assignee_type, start_date, due_date, sage_write_status,
        sage_payload_json, sync_direction, sync_status, created_at,
        updated_at
      ) VALUES (?, ?, 'compass_template', 'schedule_task', ?, ?, ?,
        'open', 'normal', 'internal', ?, ?, 'not_ready', ?, 'write',
        'compass_only', ?, ?)`,
    )
    .bind(
      todo.id,
      todo.projectId,
      todo.scheduleTaskId,
      todo.title,
      todo.description,
      todo.startDate,
      todo.dueDate,
      todo.payloadJson,
      todo.now,
      todo.now,
    )
}

// ---------------------------------------------------------------------------
// project_purchase_order_lines
// ---------------------------------------------------------------------------

export function purchaseOrderLineInsertQuery(db: Db, row: PurchaseOrderLineInsert): BatchItem<"sqlite"> {
  return db.insert(projectPurchaseOrderLines).values(row)
}

export function purchaseOrderLinesDeleteQuery(
  db: Db,
  projectId: string,
  operationId: string,
): BatchItem<"sqlite"> {
  return db
    .delete(projectPurchaseOrderLines)
    .where(
      and(
        eq(projectPurchaseOrderLines.operationId, operationId),
        eq(projectPurchaseOrderLines.projectId, projectId),
      ),
    )
}

export async function deletePurchaseOrderLines(
  db: Db,
  projectId: string,
  operationId: string,
): Promise<void> {
  await purchaseOrderLinesDeleteQuery(db, projectId, operationId)
}

export function purchaseOrderLinesUpdateQuery(
  db: Db,
  where: SQL | undefined,
  values: PurchaseOrderLineUpdate,
): BatchItem<"sqlite"> {
  return db.update(projectPurchaseOrderLines).set(values).where(where)
}

// ---------------------------------------------------------------------------
// project_todo_events
// ---------------------------------------------------------------------------

/** One line in a to-do's history (made, worked, blocked, status change). */
export async function recordTodoEvent(db: Db, event: TodoEventInput): Promise<void> {
  await db.insert(projectTodoEvents).values(todoEventRow(event))
}

// ---------------------------------------------------------------------------
// project_rfq_* tables
// ---------------------------------------------------------------------------

/**
 * A bid approval inserted from a guarded SELECT, so it lands only while the
 * RFQ is still in the state the caller read (see project-rfq-bids).
 */
export function rfqBidApprovalFromSelectStatement(db: Db, select: SQL): BatchItem<"sqlite"> {
  return db.insert(projectRfqBidApprovals).select(select)
}

/** A manual-response event inserted from a guarded SELECT. */
export function rfqManualResponseEventFromSelectStatement(db: Db, select: SQL): BatchItem<"sqlite"> {
  return db.insert(projectRfqManualResponseEvents).select(select)
}

export async function insertRfqEmailDelivery(db: Db, row: RfqEmailDeliveryInsert): Promise<void> {
  await db.insert(projectRfqEmailDeliveries).values(row)
}

export async function updateRfqEmailDelivery(
  db: Db,
  deliveryId: string,
  values: RfqEmailDeliveryUpdate,
): Promise<void> {
  await db.update(projectRfqEmailDeliveries).set(values).where(eq(projectRfqEmailDeliveries.id, deliveryId))
}

export async function insertRfqQuoteLink(db: Db, row: RfqQuoteLinkInsert): Promise<void> {
  await db.insert(projectRfqQuoteLinks).values(row)
}

export async function updateRfqQuoteLinks(
  db: Db,
  where: SQL | undefined,
  values: RfqQuoteLinkUpdate,
): Promise<void> {
  await db.update(projectRfqQuoteLinks).set(values).where(where)
}

export async function updateRfqQuoteLinkById(
  db: Db,
  quoteLinkId: string,
  values: RfqQuoteLinkUpdate,
): Promise<void> {
  await db.update(projectRfqQuoteLinks).set(values).where(eq(projectRfqQuoteLinks.id, quoteLinkId))
}

// ---------------------------------------------------------------------------
// project_estimate_rfq_bid_imports and their lines
// ---------------------------------------------------------------------------

/** A bid import inserted from a guarded SELECT (the estimate is still editable). */
export function rfqBidImportFromSelectStatement(db: Db, select: SQL): BatchItem<"sqlite"> {
  return db.insert(projectEstimateRfqBidImports).select(select)
}

export function rfqBidImportLineFromSelectStatement(db: Db, select: SQL): BatchItem<"sqlite"> {
  return db.insert(projectEstimateRfqBidImportLines).select(select)
}

/**
 * Removes the RFQ bids imported into these estimates (lines first), so an
 * approved bid can be imported again into a replacement estimate. Batch them
 * with the estimate delete.
 */
export function rfqBidImportsForEstimatesDeleteQueries(
  db: Db,
  projectId: string,
  estimateIds: readonly string[],
): [BatchItem<"sqlite">, BatchItem<"sqlite">] {
  const forEstimates = and(
    eq(projectEstimateRfqBidImports.projectId, projectId),
    inArray(projectEstimateRfqBidImports.estimateId, [...estimateIds]),
  )
  return [
    db.delete(projectEstimateRfqBidImportLines).where(
      inArray(
        projectEstimateRfqBidImportLines.importId,
        db.select({ id: projectEstimateRfqBidImports.id }).from(projectEstimateRfqBidImports).where(forEstimates),
      ),
    ),
    db.delete(projectEstimateRfqBidImports).where(forEstimates),
  ]
}
