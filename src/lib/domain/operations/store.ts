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
 *
 * It also writes shop_tickets (their statuses live in this module's
 * statuses.ts): creating, issuing, voiding, and linking them to the owner pay
 * application they are billed on.
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm"
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
import { shopTickets } from "@/db/schema-shop-tickets"
import { companyMoveGuard, type CompanyReferenceMove } from "@/lib/domain/contacts/company-merge-references"
import type { Db } from "@/lib/server/action-context"
import { PROJECT_TODO_RECORD_TYPES } from "@/lib/project-todos"
import { assertListFields } from "@/lib/shared/statuses"

import { automaticSourceSpellings, automaticStatusAfter, type ProcurementAutomation } from "./procurement-machines"
import { todoEventRow, type TodoEventInput } from "./rules"
import { SHOP_TICKET_STATUSES } from "./statuses"
import { automaticTodoSourceSpellings, automaticTodoStatusAfterEvents, type TodoAutomationEvent } from "./todo-machines"

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

// RFQ and purchase order statuses. Staff set any of their company's statuses
// (setProcurementStatusByStaff); automatic moves follow procurement-machines.ts.
// Both are compare-and-set, so a stale read never overwrites a newer status.
// Everything else that updates an RFQ or PO leaves status out of its values.

type ProcurementRow = {
  readonly projectId: string
  readonly operationId: string
}

function procurementRow(kind: ProcurementAutomation["kind"], row: ProcurementRow): SQL | undefined {
  return and(
    eq(projectOperations.id, row.operationId),
    eq(projectOperations.projectId, row.projectId),
    eq(projectOperations.sourceRecordType, kind),
  )
}

/**
 * A staff status change: lands only while the record still has `expected`,
 * the status the person saw. False when it changed meanwhile.
 */
export async function setProcurementStatusByStaff(
  db: Db,
  input: ProcurementRow & {
    readonly kind: ProcurementAutomation["kind"]
    readonly expected: string
    readonly status: string
    readonly updatedAt: string
  },
): Promise<boolean> {
  const result = await db
    .update(projectOperations)
    .set({ status: input.status, updatedAt: input.updatedAt })
    .where(and(procurementRow(input.kind, input), eq(projectOperations.status, input.expected)))
    .run()
  return result.meta.changes > 0
}

type AutomaticStatusMove = ProcurementRow & {
  readonly automation: ProcurementAutomation
  /** The status the caller read; the move is decided from it. */
  readonly stored: string
  /** The caller's own guard (an `updatedAt` check, an approval that must exist). */
  readonly where?: SQL
  /** Other columns written with the status. */
  readonly values?: Omit<OperationUpdate, "status">
  readonly updatedAt: string
}

// Return type left to Drizzle: run() and the batch both need the builder.
function automaticStatusUpdate(db: Db, move: AutomaticStatusMove) {
  const to = automaticStatusAfter(move.automation, move.stored)
  if (to === null) return null
  return db
    .update(projectOperations)
    .set({ ...move.values, status: to, updatedAt: move.updatedAt })
    .where(
      and(
        procurementRow(move.automation.kind, move),
        inArray(projectOperations.status, [...automaticSourceSpellings(move.automation, move.stored)]),
        move.where,
      ),
    )
}

/**
 * An automatic status move as a statement for the caller's batch: it lands
 * only while the record is still in one of the event's source statuses.
 * Null when the machine doesn't move a record from `stored` at all.
 */
export function automaticStatusQuery(db: Db, move: AutomaticStatusMove): BatchItem<"sqlite"> | null {
  return automaticStatusUpdate(db, move)
}

/** Applies an automatic status move. True when it landed. */
export async function moveStatusAutomatically(db: Db, move: AutomaticStatusMove): Promise<boolean> {
  const update = automaticStatusUpdate(db, move)
  if (update === null) return false
  const result = await update.run()
  return result.meta.changes > 0
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

/** A to-do from a project template (template application batch). */
export function templateStaffTodoInsertStatement(
  database: D1Database,
  todo: {
    readonly id: string
    readonly projectId: string
    readonly sourceRecordId: string | null
    readonly title: string
    readonly description: string | null
    readonly payloadJson: string
    readonly now: string
  },
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO project_operations (
            id, project_id, source_system, source_record_type,
            source_record_id, title, description, status, priority,
            assignee_type, sage_write_status, sage_payload_json,
            sync_direction, sync_status, created_at, updated_at
          ) VALUES (?, ?, 'compass_template', 'staff_task', ?, ?, ?, 'open',
            'normal', 'internal', 'not_ready', ?, 'write', 'compass_only', ?, ?)`,
    )
    .bind(todo.id, todo.projectId, todo.sourceRecordId, todo.title, todo.description, todo.payloadJson, todo.now, todo.now)
}

/** A draft RFQ (bid package) from a project template (template application batch). */
export function templateBidPackageInsertStatement(
  database: D1Database,
  bidPackage: {
    readonly id: string
    readonly projectId: string
    readonly sourceRecordId: string | null
    readonly title: string
    readonly description: string | null
    readonly costCode: string | null
    readonly payloadJson: string
    readonly now: string
  },
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO project_operations (
            id, project_id, source_system, source_record_type,
            source_record_id, title, description, status, priority,
            assignee_type, cost_code, sage_cost_code, sage_write_status,
            sage_payload_json, sync_direction, sync_status, created_at,
            updated_at
          ) VALUES (?, ?, 'compass_template', 'rfq', ?, ?, ?, 'draft',
            'normal', 'vendor', ?, ?, 'not_ready', ?, 'write',
            'compass_only', ?, ?)`,
    )
    .bind(
      bidPackage.id,
      bidPackage.projectId,
      bidPackage.sourceRecordId,
      bidPackage.title,
      bidPackage.description,
      bidPackage.costCode,
      bidPackage.costCode,
      bidPackage.payloadJson,
      bidPackage.now,
      bidPackage.now,
    )
}

/**
 * Moves the linked to-dos of several schedule items by the same number of
 * days as each item, in one statement. ?1 is a JSON object keyed by schedule
 * item id with its new [start, end] dates. Run before the schedule_tasks
 * update so offsets come from the items' previous dates.
 */
export const LINKED_TODO_DATE_UPDATE_SQL = `UPDATE project_operations
SET start_date = CASE
  WHEN start_date IS NULL OR julianday(start_date) IS NULL THEN start_date
  ELSE date(
    json_extract(?1, '$."' || source_record_id || '"[0]'),
    printf('%+d days', CAST(julianday(start_date) - julianday((
      SELECT start_date FROM schedule_tasks WHERE id = project_operations.source_record_id
    )) AS INTEGER))
  )
END,
due_date = CASE
  WHEN due_date IS NULL OR julianday(due_date) IS NULL THEN due_date
  ELSE date(
    json_extract(?1, '$."' || source_record_id || '"[1]'),
    printf('%+d days', CAST(julianday(due_date) - julianday((
      SELECT end_date_calculated FROM schedule_tasks WHERE id = project_operations.source_record_id
    )) AS INTEGER))
  )
END,
updated_at = ?2
WHERE source_record_id IN (SELECT key FROM json_each(?1))
  AND project_id = (
    SELECT project_id FROM schedule_tasks WHERE id = project_operations.source_record_id
  )
  AND source_record_type IN (
    'staff_task',
    'subcontractor_task',
    'supplier_task',
    'schedule_task',
    'todo',
    'task'
  )`

export function linkedTodoDateUpdateStatement(
  database: D1Database,
  moves: readonly { readonly scheduleTaskId: string; readonly nextStartDate: string; readonly nextEndDate: string }[],
  updatedAt: string,
): D1PreparedStatement {
  const dates = Object.fromEntries(moves.map((move) => [move.scheduleTaskId, [move.nextStartDate, move.nextEndDate]]))
  return database.prepare(LINKED_TODO_DATE_UPDATE_SQL).bind(JSON.stringify(dates), updatedAt)
}

type SquareReceivableOperation = {
  readonly id: string
  readonly projectId: string
  readonly sourceRecordId: string
  readonly sourceRecordNumber: string
  readonly title: string
  readonly description: string
  readonly companyName: string | null
  readonly startDate: string
  readonly amount: number
  readonly sageJobNumber: string | null
  readonly now: string
}

/** The Sage owner invoice row the Square receivable writer keeps in step (SQL unchanged). */
export function squareOwnerInvoiceOperationUpsertStatement(
  database: D1Database,
  invoice: SquareReceivableOperation & { readonly dueDate: string | null },
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO project_operations (
         id, project_id, source_system, source_record_type, source_record_id,
         source_record_number, title, description, status, priority,
         assignee_type, company_name, start_date, due_date, amount,
         sage_job_number, sage_write_status, sync_direction, sync_status,
         last_synced_at, created_at, updated_at
       ) VALUES (?, ?, 'sage', 'owner_invoice', ?, ?, ?, ?, 'open', 'normal',
         'owner', ?, ?, ?, ?, ?, 'synced', 'read', 'synced', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         source_record_number = excluded.source_record_number,
         title = excluded.title,
         description = excluded.description,
         company_name = excluded.company_name,
         start_date = excluded.start_date,
         due_date = excluded.due_date,
         amount = excluded.amount,
         sage_job_number = excluded.sage_job_number,
         last_synced_at = excluded.last_synced_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      invoice.id,
      invoice.projectId,
      invoice.sourceRecordId,
      invoice.sourceRecordNumber,
      invoice.title,
      invoice.description,
      invoice.companyName,
      invoice.startDate,
      invoice.dueDate,
      invoice.amount,
      invoice.sageJobNumber,
      invoice.now,
      invoice.now,
      invoice.now,
    )
}

/** The Square payment row awaiting the Sage receipt step (SQL unchanged). */
export function squarePaymentOperationUpsertStatement(
  database: D1Database,
  payment: SquareReceivableOperation,
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO project_operations (
         id, project_id, source_system, source_record_type, source_record_id,
         source_record_number, title, description, status, priority,
         assignee_type, company_name, start_date, due_date, amount,
         sage_job_number, sage_write_status, sync_direction, sync_status,
         last_synced_at, created_at, updated_at
       ) VALUES (?, ?, 'sage', 'payment', ?, ?, ?, ?, 'received', 'normal',
         'owner', ?, ?, NULL, ?, ?, 'manual_action_required', 'read', 'synced', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         source_record_number = excluded.source_record_number,
         title = excluded.title,
         description = excluded.description,
         company_name = excluded.company_name,
         start_date = excluded.start_date,
         amount = excluded.amount,
         sage_job_number = excluded.sage_job_number,
         sage_write_status = excluded.sage_write_status,
         last_synced_at = excluded.last_synced_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      payment.id,
      payment.projectId,
      payment.sourceRecordId,
      payment.sourceRecordNumber,
      payment.title,
      payment.description,
      payment.companyName,
      payment.startDate,
      payment.amount,
      payment.sageJobNumber,
      payment.now,
      payment.now,
      payment.now,
    )
}

/** Mirrors the owner invoice's status onto its operation row (SQL unchanged). */
export async function setSquareInvoiceOperationStatus(
  database: D1Database,
  input: { readonly status: string; readonly now: string; readonly operationId: string; readonly projectId: string },
): Promise<void> {
  await database
    .prepare(
      `UPDATE project_operations
     SET status = ?, updated_at = ?
     WHERE id = ? AND project_id = ?`,
    )
    .bind(input.status, input.now, input.operationId, input.projectId)
    .run()
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
// To-do statuses and history (project_todo_events)
// ---------------------------------------------------------------------------
// Staff set any company status; a daily log's moves follow todo-machines.ts.
// All are compare-and-set, with the change's history rows (archive and
// restore included) inserted first in the same batch under the same
// condition: a to-do changed meanwhile gets neither the new status nor history.

/** Batch guarded writes: concurrent edits are left untouched and reported. */
export async function changeTodosReturning(
  db: Db,
  projectId: string,
  rows: readonly OperationRow[],
  mode: "archive" | "restore" | "delete",
  updatedAt: string,
  actor: { readonly organizationId: string; readonly userId: string },
): Promise<string[]> {
  const toStatus = mode === "archive" ? "archived" : "open"
  const queries = rows.flatMap((row) => {
    const where = and(
      eq(projectOperations.projectId, projectId),
      eq(projectOperations.id, row.id),
      eq(projectOperations.updatedAt, row.updatedAt),
      eq(projectOperations.status, row.status),
      eq(projectOperations.sourceRecordType, row.sourceRecordType),
    )
    const change = mode === "delete"
      ? db.delete(projectOperations).where(where).returning({ id: projectOperations.id })
      : db.update(projectOperations).set({ status: toStatus, updatedAt }).where(where).returning({ id: projectOperations.id })
    if (mode === "delete") return [change]
    const history = guardedTodoEventInsert(db, {
      organizationId: actor.organizationId, projectId, todoId: row.id, kind: "status", dailyLogId: null,
      fromStatus: row.status, toStatus, note: null, actorId: actor.userId, createdAt: updatedAt,
    }, where).returning({ id: projectTodoEvents.todoId })
    return [history, change]
  })
  const [first, ...rest] = queries
  if (!first) return []
  const results = await db.batch([first, ...rest])
  return [...new Set(results.flat().map((row) => row.id))]
}

type TodoRef = { readonly projectId: string; readonly todoId: string; readonly updatedAt: string }

function todoRow(projectId: string, todoId: string): SQL | undefined {
  const isTodo = inArray(projectOperations.sourceRecordType, [...PROJECT_TODO_RECORD_TYPES])
  return and(eq(projectOperations.id, todoId), eq(projectOperations.projectId, projectId), isTodo)
}

// A history row that lands only while `where` still matches (return type left to Drizzle).
function guardedTodoEventInsert(db: Db, input: TodoEventInput, where: SQL | undefined) {
  const event = todoEventRow(input)
  return db.insert(projectTodoEvents).select(sql`
      SELECT ${event.id}, ${event.organizationId}, ${event.projectId}, ${event.todoId},
        ${event.kind}, ${event.dailyLogId}, ${event.fromStatus}, ${event.toStatus},
        ${event.note}, ${event.actorId}, ${event.createdAt}
      FROM ${projectOperations} WHERE ${where}
    `)
}

/**
 * A staff edit that may change the status: lands only on the version the
 * person opened (`expectedUpdatedAt`) while the to-do still has
 * `expectedStatus`, the status they saw. `history` is the status change's
 * row, written only when the edit lands. Null when the to-do changed meanwhile.
 */
export async function setTodoStatusByStaff(
  db: Db,
  input: TodoRef & {
    readonly expectedUpdatedAt: string
    readonly expectedStatus: string
    readonly status: string
    /** Other columns saved with the status (the edit dialog's fields). */
    readonly values?: Omit<OperationUpdate, "status" | "updatedAt">
    readonly history: TodoEventInput | null
  },
): Promise<OperationVersion | null> {
  const where = and(todoRow(input.projectId, input.todoId), eq(projectOperations.updatedAt, input.expectedUpdatedAt), eq(projectOperations.status, input.expectedStatus))
  const update = db.update(projectOperations).set({ ...input.values, status: input.status, updatedAt: input.updatedAt }).where(where)
  const written = input.history
    ? (await db.batch([guardedTodoEventInsert(db, input.history, where), update]))[1]
    : await update.run()
  return written.meta.changes > 0 ? { id: input.todoId, updatedAt: input.updatedAt } : null
}

/**
 * A daily log's moves (todo-machines.ts) from `stored`, the status it read,
 * landing with their `history` rows only while the to-do still has it. False
 * when the machine refuses them or the to-do changed meanwhile.
 */
export async function moveTodoStatusAutomatically(
  db: Db,
  move: TodoRef & {
    readonly stored: string
    readonly events: readonly TodoAutomationEvent[]
    readonly history: readonly TodoEventInput[]
  },
): Promise<boolean> {
  const to = automaticTodoStatusAfterEvents(move.events, move.stored)
  const from = automaticTodoSourceSpellings(move.stored)
  if (move.events.length === 0 || to === null || from.length === 0) return false
  const where = and(todoRow(move.projectId, move.todoId), inArray(projectOperations.status, [...from]))
  const update = db.update(projectOperations).set({ status: to, updatedAt: move.updatedAt }).where(where)
  const [first, ...rest]: BatchItem<"sqlite">[] = [...move.history.map((event) => guardedTodoEventInsert(db, event, where)), update]
  const written = (await db.batch([first ?? update, ...rest])).at(-1)
  return written !== undefined && written.meta.changes > 0
}

/**
 * One line in a to-do's history that records no status change of its own
 * (made, worked on, still blocked). Status changes write their history with
 * the change: setTodoStatusByStaff, moveTodoStatusAutomatically.
 */
export async function recordTodoEvent(
  db: Db,
  event: TodoEventInput & { readonly kind: "created" | "worked" | "still_blocked" },
): Promise<void> {
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

/**
 * Moves a merged vendor's POs, RFQs, bids and to-dos to the kept vendor. A
 * row stamped with a Sage vendor (id or number) other than the kept vendor's
 * stays put (the merge preview blocks on it), so one vendor never carries two
 * Sage identities.
 */
export function companyMergeOperationStatements(database: D1Database, move: CompanyReferenceMove): D1PreparedStatement[] {
  if (move.side !== "vendor") return []
  const guard = companyMoveGuard(move)
  return [database.prepare(`UPDATE project_operations SET vendor_id = ?, updated_at = ? WHERE vendor_id = ?
      AND (sage_vendor_id IS NULL OR trim(sage_vendor_id) = '' OR EXISTS (SELECT 1 FROM vendors k WHERE k.id = ?
        AND (k.sage_vendor_id = project_operations.sage_vendor_id OR k.sage_vendor_number = project_operations.sage_vendor_id)))
      AND ${guard.sql}`).bind(move.destinationId, move.now, move.sourceId, move.destinationId, ...guard.binds)]
}

// ---- shopTickets

type ShopTicketInsert = typeof shopTickets.$inferInsert
type ShopTicketPatch = Partial<ShopTicketInsert>
const SHOP_TICKET_LISTS = { status: SHOP_TICKET_STATUSES }

export async function insertShopTicket(db: Db, values: ShopTicketInsert): Promise<void> {
  assertListFields("shop_tickets", values, SHOP_TICKET_LISTS)
  await db.insert(shopTickets).values(values)
}

/** Updates the matching tickets and returns the ids it changed. */
export async function updateShopTickets(db: Db, where: SQL | undefined, patch: ShopTicketPatch): Promise<readonly { readonly id: string }[]> {
  assertListFields("shop_tickets", patch, SHOP_TICKET_LISTS)
  return db.update(shopTickets).set(patch).where(where).returning({ id: shopTickets.id })
}

export function updateShopTicketsStatement(db: Db, where: SQL | undefined, patch: ShopTicketPatch): BatchItem<"sqlite"> {
  assertListFields("shop_tickets", patch, SHOP_TICKET_LISTS)
  return db.update(shopTickets).set(patch).where(where)
}

export async function deleteShopTickets(db: Db, where: SQL | undefined): Promise<void> {
  await db.delete(shopTickets).where(where)
}
