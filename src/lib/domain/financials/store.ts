import { and, eq, inArray, isNotNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import {
  creditMemos,
  invoiceLines,
  invoices,
  payments,
  vendorBills,
  type NewCreditMemo,
  type NewInvoice,
  type NewPayment,
  type NewVendorBill,
} from "@/db/schema-netsuite"
import {
  projectContractBudgetAdjustments,
  projectContractBudgetLines,
  projectContractBudgetRevisions,
} from "@/db/schema-estimates"
import {
  NON_IMPORTED_BILL_SOURCES,
  COMPASS_DRAW_SOURCE,
  IMPORTED_DRAW_UNBILLED_STATUSES,
} from "@/lib/domain/financials/rules"
import { companyMoveGuard, type CompanyReferenceMove } from "@/lib/domain/contacts/company-merge-references"
import {
  INVOICE_CUSTOMER_TYPES,
  INVOICE_LINE_SOURCES,
  INVOICE_PRICE_MODES,
  INVOICE_SQUARE_STATES,
  SIMPLE_INVOICE_KINDS,
  SIMPLE_INVOICE_STATUSES,
} from "@/lib/domain/financials/statuses"
import {
  INVOICE_CLOSED_TO_PAYMENTS,
  SQUARE_LINK_LEASE_MS,
  simpleInvoiceMachine,
  squareLinkMachine,
  type SimpleInvoiceEvent,
  type SquareLinkEvent,
} from "@/lib/domain/financials/invoice-machines"
import { assertListFields } from "@/lib/shared/statuses"
import { chunkD1Rows } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

/**
 * The only writer of the financial tables: invoices, vendor bills, payments,
 * credit memos, payment allocations (invoices and pay applications), "Paid before Compass" marks on imported draws, and the contract budget (revisions, their lines and their
 * change order adjustments) (architecture standard, section 1). Callers resolve
 * access and compute totals (rules.ts) first; this module only writes.
 */

export async function insertInvoice(db: Db, values: NewInvoice): Promise<void> {
  await db.insert(invoices).values(values)
}

export async function updateInvoiceRow(db: Db, id: string, values: Partial<NewInvoice>): Promise<void> {
  await db.update(invoices).set(values).where(eq(invoices.id, id))
}

export async function deleteInvoiceRow(db: Db, id: string): Promise<void> {
  await db.delete(invoices).where(eq(invoices.id, id))
}

// ---------------------------------------------------------------------------
// Simple invoices (Compass-built material sales and one-off work) and their
// lines. Statements stay unexecuted so callers keep one atomic `db.batch`.
// ---------------------------------------------------------------------------

const SIMPLE_INVOICE_LISTS = {
  invoiceKind: SIMPLE_INVOICE_KINDS,
  status: SIMPLE_INVOICE_STATUSES,
  priceMode: INVOICE_PRICE_MODES,
  priceCustomerType: INVOICE_CUSTOMER_TYPES,
  squareState: INVOICE_SQUARE_STATES,
}
const INVOICE_LINE_LISTS = { source: INVOICE_LINE_SOURCES }

type NewInvoiceLine = typeof invoiceLines.$inferInsert

export function simpleInvoiceInsertStatement(db: Db, values: NewInvoice) {
  assertListFields("invoices", values, SIMPLE_INVOICE_LISTS)
  return db.insert(invoices).values(values)
}

/**
 * Fenced by the caller's `where`. Never a status or Square link change: those
 * go through the event functions below (./invoice-machines.ts).
 */
export function simpleInvoiceUpdateStatement(db: Db, where: SQL | undefined, patch: Partial<NewInvoice>) {
  if (Reflect.get(patch, "status") !== undefined || Reflect.get(patch, "squareState") !== undefined) {
    throw new Error("Change an invoice's status or Square link with the invoice status functions in financials/store.ts")
  }
  assertListFields("invoices", patch, SIMPLE_INVOICE_LISTS)
  return db.update(invoices).set(patch).where(where)
}

type SimpleInvoiceKey = { readonly invoiceId: string; readonly organizationId: string; readonly projectId: string }

function simpleInvoiceKey(key: SimpleInvoiceKey): SQL | undefined {
  return and(eq(invoices.id, key.invoiceId), eq(invoices.organizationId, key.organizationId), eq(invoices.projectId, key.projectId), isNotNull(invoices.invoiceKind))
}

/** Applies `event` as a compare-and-set on its source states (plus `also`); true when it landed. */
async function moveSimpleInvoice(db: Db, key: SimpleInvoiceKey, event: SimpleInvoiceEvent, values: Partial<NewInvoice>, also?: SQL): Promise<boolean> {
  const updated = await db.update(invoices)
    .set({ ...values, status: simpleInvoiceMachine.transitions[event].to })
    .where(and(simpleInvoiceKey(key), inArray(invoices.status, [...simpleInvoiceMachine.transitions[event].from]), also))
    .returning({ id: invoices.id })
  return updated.length === 1
}

/** The same for the invoice's Square link (square_state). */
async function moveSquareLink(db: Db, key: SimpleInvoiceKey, event: SquareLinkEvent, values: Partial<NewInvoice>, also?: SQL): Promise<boolean> {
  const updated = await db.update(invoices)
    .set({ ...values, squareState: squareLinkMachine.transitions[event].to })
    .where(and(simpleInvoiceKey(key), inArray(invoices.squareState, [...squareLinkMachine.transitions[event].from]), also))
    .returning({ id: invoices.id })
  return updated.length === 1
}

/** finalize: numbers a draft. "number_taken" when another invoice of the job took the sequence number first. */
export async function finalizeSimpleInvoice(db: Db, key: SimpleInvoiceKey & {
  readonly sequenceNumber: number; readonly invoiceNumber: string; readonly actorId: string; readonly now: string
}): Promise<"finalized" | "changed" | "number_taken"> {
  try {
    const values = { sequenceNumber: key.sequenceNumber, invoiceNumber: key.invoiceNumber, finalizedAt: key.now, finalizedByUserId: key.actorId, updatedAt: key.now }
    return (await moveSimpleInvoice(db, key, "finalize", values)) ? "finalized" : "changed"
  } catch (error) {
    const text = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error)
    if (/UNIQUE constraint failed/i.test(text)) return "number_taken"
    throw error
  }
}

/** reopen: a final, unpaid invoice back to draft. */
export async function reopenSimpleInvoice(db: Db, key: SimpleInvoiceKey & { readonly now: string }): Promise<boolean> {
  return moveSimpleInvoice(db, key, "reopen", { updatedAt: key.now }, eq(invoices.amountPaid, 0))
}

/** reopen as an unexecuted statement (with `.returning`) for the caller's batch, also fenced on `also`. */
export function reopenSimpleInvoiceStatement(db: Db, key: SimpleInvoiceKey & { readonly now: string; readonly also?: SQL }) {
  const { from, to } = simpleInvoiceMachine.transitions.reopen
  return db.update(invoices)
    .set({ updatedAt: key.now, status: to })
    .where(and(simpleInvoiceKey(key), inArray(invoices.status, [...from]), eq(invoices.amountPaid, 0), key.also))
    .returning({ id: invoices.id })
}

/** void: keeps a final, unpaid invoice for the record. The caller cancels its Sage export and Square invoice only after this lands. */
export async function voidSimpleInvoice(db: Db, key: SimpleInvoiceKey & { readonly reason: string; readonly actorId: string; readonly now: string }): Promise<boolean> {
  const values = { amountDue: 0, voidedAt: key.now, voidedByUserId: key.actorId, voidReason: key.reason, updatedAt: key.now }
  return moveSimpleInvoice(db, key, "void", values, eq(invoices.amountPaid, 0))
}

/** The invoice is final and not void (it may carry a Square payment link). */
const INVOICE_OPEN_FOR_SQUARE = notInArray(invoices.status, [...INVOICE_CLOSED_TO_PAYMENTS])

/** start: one request creates the Square invoice (never two payment links); a "pending" left by a dead request is claimable after the lease. */
export async function startSquareInvoiceLink(db: Db, key: SimpleInvoiceKey & { readonly now: string }): Promise<boolean> {
  const leaseExpired = new Date(Date.parse(key.now) - SQUARE_LINK_LEASE_MS).toISOString()
  return moveSquareLink(db, key, "start", { squareError: null, updatedAt: key.now },
    and(INVOICE_OPEN_FOR_SQUARE, or(notInArray(invoices.squareState, ["pending"]), lt(invoices.updatedAt, leaseExpired))))
}

/** publish: stores Square's payment page. False when the invoice was voided meanwhile; the caller cancels it in Square. */
export async function publishSquareInvoiceLink(db: Db, key: SimpleInvoiceKey & { readonly publicUrl: string; readonly now: string }): Promise<boolean> {
  return moveSquareLink(db, key, "publish", { squarePublicUrl: key.publicUrl, squareError: null, updatedAt: key.now }, INVOICE_OPEN_FOR_SQUARE)
}

/** fail: Square didn't create the invoice; staff may try again. */
export async function failSquareInvoiceLink(db: Db, key: SimpleInvoiceKey & { readonly error: string; readonly now: string }): Promise<boolean> {
  return moveSquareLink(db, key, "fail", { squareError: key.error, updatedAt: key.now })
}

/** cancel: a voided invoice's Square invoice was cancelled in Square. */
export async function cancelSquareInvoiceLink(db: Db, key: SimpleInvoiceKey & { readonly now: string }): Promise<boolean> {
  return moveSquareLink(db, key, "cancel", { updatedAt: key.now }, eq(invoices.status, simpleInvoiceMachine.transitions.void.to))
}

/** A draft's lines are replaced as a whole on save. */
export function replaceInvoiceLinesStatements(db: Db, invoiceId: string, rows: readonly NewInvoiceLine[]): readonly BatchItem<"sqlite">[] {
  assertListFields("invoice_lines", rows, INVOICE_LINE_LISTS)
  const statements: BatchItem<"sqlite">[] = [db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId))]
  for (const chunk of chunkD1Rows(rows)) statements.push(db.insert(invoiceLines).values(chunk))
  return statements
}

/** Deletes a draft simple invoice (its lines cascade); returns the deleted ids. */
export function deleteDraftSimpleInvoiceStatement(db: Db, input: { readonly invoiceId: string; readonly organizationId: string; readonly projectId: string }) {
  return db
    .delete(invoices)
    .where(
      and(
        eq(invoices.id, input.invoiceId),
        eq(invoices.organizationId, input.organizationId),
        eq(invoices.projectId, input.projectId),
        eq(invoices.status, "draft"),
        isNotNull(invoices.invoiceKind)
      )
    )
    .returning({ id: invoices.id })
}

export async function insertVendorBill(db: Db, values: NewVendorBill): Promise<void> {
  await db.insert(vendorBills).values(values)
}

export async function updateVendorBillRow(db: Db, id: string, values: Partial<NewVendorBill>): Promise<void> {
  await db.update(vendorBills).set(values).where(eq(vendorBills.id, id))
}

export async function deleteVendorBillRow(db: Db, id: string): Promise<void> {
  await db.delete(vendorBills).where(eq(vendorBills.id, id))
}

export async function insertPayment(db: Db, values: NewPayment): Promise<void> {
  await db.insert(payments).values(values)
}

export async function updatePaymentRow(db: Db, id: string, values: Partial<NewPayment>): Promise<void> {
  await db.update(payments).set(values).where(eq(payments.id, id))
}

/** Updates a payment only while nothing applies it (released history counts); false when it was applied first. */
export async function updateUnappliedPaymentRow(db: Db, id: string, values: Partial<NewPayment>): Promise<boolean> {
  const updated = await db.update(payments).set(values).where(and(
    eq(payments.id, id),
    sql`NOT EXISTS (SELECT 1 FROM pay_application_payment_allocations WHERE payment_id = ${id})`,
    sql`NOT EXISTS (SELECT 1 FROM invoice_payment_allocations WHERE payment_id = ${id})`,
  )).returning({ id: payments.id })
  return updated.length === 1
}

export async function deletePaymentRow(db: Db, id: string): Promise<void> {
  await db.delete(payments).where(eq(payments.id, id))
}

export async function insertCreditMemo(db: Db, values: NewCreditMemo): Promise<void> {
  await db.insert(creditMemos).values(values)
}

export async function updateCreditMemoRow(db: Db, id: string, values: Partial<NewCreditMemo>): Promise<void> {
  await db.update(creditMemos).set(values).where(eq(creditMemos.id, id))
}

export async function deleteCreditMemoRow(db: Db, id: string): Promise<void> {
  await db.delete(creditMemos).where(eq(creditMemos.id, id))
}

// ---------------------------------------------------------------------------
// Owner receivables projected from a Sage invoice paid through Square. Each
// returns a bound D1 statement so the caller keeps its one atomic batch.
// ---------------------------------------------------------------------------

/** The Sage A/R invoice a Square payment settled, as Compass stores it (dollars). */
export type SageReceivableInvoice = {
  readonly id: string
  readonly organizationId: string
  readonly customerId: string
  readonly projectId: string
  readonly sourceExternalId: string
  readonly invoiceNumber: string
  readonly issueDate: string
  readonly dueDate: string | null
  readonly subtotal: number
  readonly tax: number
  readonly total: number
  readonly memo: string
  readonly now: string
}

/** Inserts the invoice open and unpaid, or refreshes its identity and amounts (never amount paid). */
export function upsertSageReceivableInvoiceStatement(database: D1Database, input: SageReceivableInvoice): D1PreparedStatement {
  return database.prepare(
    `INSERT INTO invoices (
         id, organization_id, customer_id, project_id, source_system,
         source_external_id, invoice_number, status, issue_date, due_date,
         subtotal, tax, total, amount_paid, amount_due, memo, line_items,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'sage', ?, ?, 'open', ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         organization_id = excluded.organization_id,
         customer_id = excluded.customer_id,
         project_id = excluded.project_id,
         invoice_number = excluded.invoice_number,
         issue_date = excluded.issue_date,
         due_date = excluded.due_date,
         subtotal = excluded.subtotal,
         tax = excluded.tax,
         total = excluded.total,
         memo = excluded.memo,
         updated_at = excluded.updated_at`,
  ).bind(
    input.id, input.organizationId, input.customerId, input.projectId, input.sourceExternalId,
    input.invoiceNumber, input.issueDate, input.dueDate, input.subtotal, input.tax, input.total,
    input.total, input.memo, input.now, input.now,
  )
}

/** The Square payment received against that invoice. */
export type SageReceivablePayment = {
  readonly id: string
  readonly organizationId: string
  readonly customerId: string
  readonly projectId: string
  readonly sourceExternalId: string
  readonly amount: number
  readonly grossAmountCents: number
  readonly processingFeeCents: number
  readonly netAmountCents: number
  readonly paymentDate: string
  readonly referenceNumber: string
  readonly memo: string
  readonly now: string
}

/** Inserts or refreshes the received Square payment (a cash receipt). */
export function upsertSageReceivablePaymentStatement(database: D1Database, input: SageReceivablePayment): D1PreparedStatement {
  return database.prepare(
    `INSERT INTO payments (
         id, organization_id, customer_id, vendor_id, project_id,
         source_system, source_external_id, payment_type, amount,
         gross_amount_cents, processing_fee_cents, net_amount_cents,
         cash_receipt, payment_date, payment_method, reference_number, memo,
         created_at, updated_at
       ) VALUES (?, ?, ?, NULL, ?, 'sage', ?, 'received', ?, ?, ?, ?, 1, ?, 'square', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         organization_id = excluded.organization_id,
         customer_id = excluded.customer_id,
         project_id = excluded.project_id,
         amount = excluded.amount,
         gross_amount_cents = excluded.gross_amount_cents,
         processing_fee_cents = excluded.processing_fee_cents,
         net_amount_cents = excluded.net_amount_cents,
         payment_date = excluded.payment_date,
         payment_method = excluded.payment_method,
         reference_number = excluded.reference_number,
         memo = excluded.memo,
         updated_at = excluded.updated_at`,
  ).bind(
    input.id, input.organizationId, input.customerId, input.projectId, input.sourceExternalId,
    input.amount, input.grossAmountCents, input.processingFeeCents, input.netAmountCents,
    input.paymentDate, input.referenceNumber, input.memo, input.now, input.now,
  )
}

/** Allocates `allocationCents` of a payment to an invoice; one row per pair. */
export function upsertInvoicePaymentAllocationStatement(database: D1Database, input: {
  readonly id: string; readonly organizationId: string; readonly projectId: string
  readonly invoiceId: string; readonly paymentId: string; readonly allocationCents: number; readonly now: string
}): D1PreparedStatement {
  return database.prepare(
    `INSERT INTO invoice_payment_allocations (
         id, organization_id, project_id, invoice_id, payment_id,
         allocation_cents, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(invoice_id, payment_id) DO UPDATE SET
         allocation_cents = excluded.allocation_cents`,
  ).bind(input.id, input.organizationId, input.projectId, input.invoiceId, input.paymentId, input.allocationCents, input.now)
}

/** Recomputes amount paid, amount due and paid status from the allocations; a draft or void invoice keeps its status (a void one owes 0). */
export function refreshInvoicePaidStatusStatement(database: D1Database, input: {
  readonly invoiceId: string; readonly organizationId: string; readonly projectId: string; readonly now: string
}): D1PreparedStatement {
  return database.prepare(
    `UPDATE invoices
     SET amount_paid = MIN(
           total,
           COALESCE((
             SELECT SUM(allocation_cents) / 100.0
             FROM invoice_payment_allocations
             WHERE invoice_id = ? AND released_at IS NULL
           ), 0)
         ),
         amount_due = CASE WHEN status = 'void' THEN 0 ELSE MAX(
           total - COALESCE((
             SELECT SUM(allocation_cents) / 100.0
             FROM invoice_payment_allocations
             WHERE invoice_id = ? AND released_at IS NULL
           ), 0),
           0
         ) END,
         status = CASE
           WHEN status IN (${CLOSED_TO_PAYMENTS_SQL}) THEN status
           WHEN COALESCE((
             SELECT SUM(allocation_cents)
             FROM invoice_payment_allocations
             WHERE invoice_id = ? AND released_at IS NULL
           ), 0) >= CAST(ROUND(total * 100) AS INTEGER) THEN 'paid'
           WHEN COALESCE((
             SELECT SUM(allocation_cents)
             FROM invoice_payment_allocations
             WHERE invoice_id = ? AND released_at IS NULL
           ), 0) > 0 THEN 'partially_paid'
           ELSE 'open'
         END,
         updated_at = ?
     WHERE id = ? AND organization_id = ? AND project_id = ?`,
  ).bind(
    input.invoiceId, input.invoiceId, input.invoiceId, input.invoiceId,
    input.now, input.invoiceId, input.organizationId, input.projectId,
  )
}

// ---------------------------------------------------------------------------
// Contract budget revisions, lines and adjustments. Each returns an
// unexecuted statement so callers keep their single atomic `db.batch`.
// ---------------------------------------------------------------------------

type BatchStatement = BatchItem<"sqlite">

export function insertContractBudgetRevisionStatement(
  db: Db,
  values: typeof projectContractBudgetRevisions.$inferInsert
): BatchStatement {
  return db.insert(projectContractBudgetRevisions).values(values)
}

export function insertContractBudgetLineStatement(
  db: Db,
  values: typeof projectContractBudgetLines.$inferInsert
): BatchStatement {
  return db.insert(projectContractBudgetLines).values(values)
}

export function insertContractBudgetAdjustmentStatement(
  db: Db,
  values: typeof projectContractBudgetAdjustments.$inferInsert
): BatchStatement {
  return db.insert(projectContractBudgetAdjustments).values(values)
}

/** Retires the project's current revision. Batch it with `makeContractBudgetRevisionCurrentStatement`. */
export function supersedeCurrentContractBudgetRevisionStatement(db: Db, projectId: string): BatchStatement {
  return db
    .update(projectContractBudgetRevisions)
    .set({ status: "superseded" })
    .where(
      and(
        eq(projectContractBudgetRevisions.projectId, projectId),
        eq(projectContractBudgetRevisions.status, "current")
      )
    )
}

export function makeContractBudgetRevisionCurrentStatement(db: Db, revisionId: string): BatchStatement {
  return db
    .update(projectContractBudgetRevisions)
    .set({ status: "current" })
    .where(eq(projectContractBudgetRevisions.id, revisionId))
}

// ---------------------------------------------------------------------------
// Received payments applied to pay applications and invoices. One payment and
// all its allocations are written in one atomic D1 batch. The action reads the
// stored balances and checks the amounts with rules.ts first; each write here
// repeats that read as a guard, so a balance that changed in between (another
// payment, a void, a Square receipt) aborts the whole batch instead of
// over-applying. A failed guard writes an allocation of 0 cents (or a blank
// void reason), which the table's CHECK refuses, rolling the batch back.
// ---------------------------------------------------------------------------

/** "stale": the batch was refused because a balance changed after it was read. */
export type PaymentWriteResult = "saved" | "stale"

const PAYMENT_GUARD = `(SELECT COUNT(*) FROM payments WHERE id = ? AND voided_at IS NULL) = 1
  AND (COALESCE((SELECT SUM(allocation_cents) FROM pay_application_payment_allocations
                 WHERE payment_id = ? AND released_at IS NULL), 0)
     + COALESCE((SELECT SUM(allocation_cents) FROM invoice_payment_allocations
                 WHERE payment_id = ? AND released_at IS NULL), 0)) = ?`

const SQL_LIST = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(", ")

/**
 * The draw can take payments (same rule as rules.ts `drawPaymentTarget`): a
 * billed Compass draw, or an imported Sage/Drive draw that is not a draft,
 * budget view or void, has a positive current payment due and is not marked
 * paid before Compass. The applied
 * total must also stay within the draw's billed amount. Binds: application
 * id, project id, expected paid cents, allocation cents.
 */
const PAYABLE_DRAW_GUARD = `(SELECT COUNT(*) FROM project_budget_applications
    WHERE id = ? AND project_id = ?
      AND ((source_system = '${COMPASS_DRAW_SOURCE}' AND status = 'billed')
        OR (source_system NOT IN (${SQL_LIST(NON_IMPORTED_BILL_SOURCES)})
          AND status NOT IN (${SQL_LIST(IMPORTED_DRAW_UNBILLED_STATUSES)})
          AND current_payment_due > 0
          AND NOT EXISTS (SELECT 1 FROM pay_application_prepaid_marks
            WHERE application_id = project_budget_applications.id AND released_at IS NULL)))
      AND CAST(ROUND(current_payment_due * 100) AS INTEGER) >= ? + ?) = 1`

const INVOICE_PAID_CENTS = `(SELECT CAST(ROUND(amount_paid * 100) AS INTEGER) FROM invoices
  WHERE id = ? AND organization_id = ? AND project_id = ?)`

/** Draft and void invoices: never take a payment, and a paid-state write leaves their status alone. */
const CLOSED_TO_PAYMENTS_SQL = SQL_LIST(INVOICE_CLOSED_TO_PAYMENTS)

/** The invoice still takes payments (it was not voided after the action read it). Binds: invoice id. */
const INVOICE_TAKES_PAYMENTS = `(SELECT status FROM invoices WHERE id = ?) NOT IN (${CLOSED_TO_PAYMENTS_SQL})`

/** The paid status to write, unless the invoice is a draft or void (a void is never undone by a payment write). */
const PAID_STATUS_UNLESS_CLOSED = (newStatus: string): string =>
  `CASE WHEN status IN (${CLOSED_TO_PAYMENTS_SQL}) THEN status ELSE ${newStatus} END`

/** New invoice amount paid, amount due and status (computed by rules.ts). */
type InvoicePaidUpdate = {
  readonly amountPaid: number
  readonly amountDue: number
  readonly status: string
}

export type PaymentAllocationWrite =
  | {
      readonly kind: "pay_application"
      readonly allocationId: string
      readonly applicationId: string
      readonly cents: number
      /** The draw's unreleased allocations when read. */
      readonly expectedPaidCents: number
    }
  | {
      readonly kind: "invoice"
      readonly allocationId: string
      readonly invoiceId: string
      readonly cents: number
      /** The invoice's amount paid (cents) when read. */
      readonly expectedPaidCents: number
      readonly invoice: InvoicePaidUpdate
    }

type PaymentScope = {
  readonly organizationId: string
  readonly projectId: string
  readonly paymentId: string
  readonly actorId: string
  readonly now: string
}

function invoicePaidUpdateStatement(database: D1Database, scope: PaymentScope, invoiceId: string, values: InvoicePaidUpdate): D1PreparedStatement {
  return database
    .prepare(`UPDATE invoices SET amount_paid = ?, amount_due = CASE WHEN status = 'void' THEN 0 ELSE ? END,
        status = ${PAID_STATUS_UNLESS_CLOSED("?")}, updated_at = ?
      WHERE id = ? AND organization_id = ? AND project_id = ?`)
    .bind(values.amountPaid, values.amountDue, values.status, scope.now, invoiceId, scope.organizationId, scope.projectId)
}

function allocationStatements(
  database: D1Database,
  scope: PaymentScope,
  allocation: PaymentAllocationWrite,
  expectedAppliedCents: number,
): D1PreparedStatement[] {
  const { organizationId, projectId, paymentId, actorId, now } = scope
  const paymentBinds = [paymentId, paymentId, paymentId, expectedAppliedCents]
  if (allocation.kind === "pay_application") {
    return [
      database
        .prepare(`INSERT INTO pay_application_payment_allocations (
            id, organization_id, project_id, application_id, payment_id, allocation_cents, created_by, created_at
          ) SELECT ?, ?, ?, ?, ?, CASE WHEN
              ${PAYABLE_DRAW_GUARD}
              AND COALESCE((SELECT SUM(allocation_cents) FROM pay_application_payment_allocations
                WHERE application_id = ? AND released_at IS NULL), 0) = ?
              AND ${PAYMENT_GUARD}
            THEN ? ELSE 0 END, ?, ?`)
        .bind(
          allocation.allocationId, organizationId, projectId, allocation.applicationId, paymentId,
          allocation.applicationId, projectId, allocation.expectedPaidCents, allocation.cents,
          allocation.applicationId, allocation.expectedPaidCents,
          ...paymentBinds, allocation.cents, actorId, now,
        ),
    ]
  }
  return [
    database
      // Revives a released row for the same pair; an active one gets 0 cents, which the CHECK refuses.
      .prepare(`INSERT INTO invoice_payment_allocations (
          id, organization_id, project_id, invoice_id, payment_id, allocation_cents, created_at
        ) SELECT ?, ?, ?, ?, ?, CASE WHEN ${INVOICE_PAID_CENTS} = ? AND ${INVOICE_TAKES_PAYMENTS} AND ${PAYMENT_GUARD} THEN ? ELSE 0 END, ? WHERE true
        ON CONFLICT(invoice_id, payment_id) DO UPDATE SET
          allocation_cents = CASE WHEN released_at IS NULL THEN 0 ELSE excluded.allocation_cents END,
          released_at = NULL, released_by = NULL`)
      .bind(
        allocation.allocationId, organizationId, projectId, allocation.invoiceId, paymentId,
        allocation.invoiceId, organizationId, projectId, allocation.expectedPaidCents, allocation.invoiceId,
        ...paymentBinds, allocation.cents, now,
      ),
    invoicePaidUpdateStatement(database, scope, allocation.invoiceId, allocation.invoice),
  ]
}

/** A new received payment, as staff record it in Compass. */
export type ReceivedPaymentRow = {
  readonly customerId: string | null
  readonly amountCents: number
  readonly paymentDate: string
  readonly paymentMethod: string
  readonly referenceNumber: string | null
  readonly memo: string | null
  readonly billingScope: string
}

function insertReceivedPaymentStatement(database: D1Database, scope: PaymentScope, payment: ReceivedPaymentRow): D1PreparedStatement {
  return database
    .prepare(`INSERT INTO payments (
        id, organization_id, customer_id, vendor_id, project_id, source_system, payment_type, amount,
        cash_receipt, payment_date, payment_method, reference_number, memo, billing_scope, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, 'compass', 'received', ?, 1, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      scope.paymentId, scope.organizationId, payment.customerId, scope.projectId, payment.amountCents / 100,
      payment.paymentDate, payment.paymentMethod, payment.referenceNumber, payment.memo, payment.billingScope,
      scope.now, scope.now,
    )
}

function isGuardFailure(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error)
  return /CHECK constraint failed|UNIQUE constraint failed/i.test(text)
}

async function runGuardedBatch(database: D1Database, statements: D1PreparedStatement[]): Promise<PaymentWriteResult> {
  if (statements.length === 0) return "saved"
  try {
    await database.batch(statements)
    return "saved"
  } catch (error) {
    if (isGuardFailure(error)) return "stale"
    throw error
  }
}

/**
 * Records a received payment (when `newPayment` is given) and applies it, or
 * applies more of an existing payment's unapplied amount, in one batch.
 * `expectedAppliedCents` is what the payment already had applied when read.
 */
export async function applyReceivedPayment(database: D1Database, input: PaymentScope & {
  readonly newPayment: ReceivedPaymentRow | null
  readonly expectedAppliedCents: number
  readonly allocations: readonly PaymentAllocationWrite[]
}): Promise<PaymentWriteResult> {
  const statements: D1PreparedStatement[] = []
  if (input.newPayment) statements.push(insertReceivedPaymentStatement(database, input, input.newPayment))
  let applied = input.expectedAppliedCents
  for (const allocation of input.allocations) {
    statements.push(...allocationStatements(database, input, allocation, applied))
    applied += allocation.cents
  }
  return runGuardedBatch(database, statements)
}

export type InvoiceAllocationRelease = {
  readonly allocationId: string
  readonly invoiceId: string
  /** The invoice's amount paid (cents) when read. */
  readonly expectedPaidCents: number
  readonly invoice: InvoicePaidUpdate
}

/**
 * Voids a payment with its reason and releases every allocation it holds, in
 * one batch. Released rows stay as history. Voiding twice, or an invoice
 * allocation added after the read, aborts the batch.
 */
export async function voidReceivedPayment(database: D1Database, input: PaymentScope & {
  readonly reason: string
  readonly invoiceReleases: readonly InvoiceAllocationRelease[]
}): Promise<PaymentWriteResult> {
  const { organizationId, projectId, paymentId, actorId, now } = input
  const statements: D1PreparedStatement[] = [
    // SET reads the old row, so a second void writes a blank reason, which the void-reason CHECK refuses.
    database
      .prepare(`UPDATE payments
        SET voided_at = ?, voided_by = ?, void_reason = CASE WHEN voided_at IS NULL THEN ? ELSE '' END, updated_at = ?
        WHERE id = ? AND organization_id = ? AND project_id = ?`)
      .bind(now, actorId, input.reason, now, paymentId, organizationId, projectId),
    database
      .prepare(`UPDATE pay_application_payment_allocations SET released_at = ?, released_by = ?
        WHERE payment_id = ? AND organization_id = ? AND project_id = ? AND released_at IS NULL`)
      .bind(now, actorId, paymentId, organizationId, projectId),
  ]
  for (const release of input.invoiceReleases) {
    statements.push(
      database
        .prepare(`UPDATE invoice_payment_allocations
          SET released_at = ?, released_by = ?,
              allocation_cents = CASE WHEN ${INVOICE_PAID_CENTS} = ? THEN allocation_cents ELSE 0 END
          WHERE id = ? AND payment_id = ? AND released_at IS NULL`)
        .bind(now, actorId, release.invoiceId, organizationId, projectId, release.expectedPaidCents, release.allocationId, paymentId),
      invoicePaidUpdateStatement(database, input, release.invoiceId, release.invoice),
    )
  }
  // An invoice allocation still active here was added after the read: abort.
  statements.push(
    database
      .prepare(`UPDATE invoice_payment_allocations SET allocation_cents = 0 WHERE payment_id = ? AND released_at IS NULL`)
      .bind(paymentId),
  )
  return runGuardedBatch(database, statements)
}

/** Takes a payment off a void or draft invoice (a late Square payment) so it can be applied elsewhere; the invoice keeps its status. */
export async function releaseAllocationFromClosedInvoice(database: D1Database, input: PaymentScope & {
  readonly allocationId: string
}): Promise<{ readonly releasedCents: number } | "stale"> {
  const { organizationId, projectId, paymentId, actorId, now } = input
  const allocation = await database.prepare(`SELECT invoice_id, allocation_cents FROM invoice_payment_allocations
    WHERE id = ? AND payment_id = ? AND organization_id = ? AND project_id = ?`).bind(input.allocationId, paymentId, organizationId, projectId)
    .first<{ invoice_id: string; allocation_cents: number }>()
  if (!allocation) return "stale"
  const [released] = await database.batch([
    database
      .prepare(`UPDATE invoice_payment_allocations SET released_at = ?, released_by = ?
        WHERE id = ? AND payment_id = ? AND released_at IS NULL AND allocation_cents = ?
          AND (SELECT status FROM invoices WHERE id = ?) IN (${CLOSED_TO_PAYMENTS_SQL})`)
      .bind(now, actorId, input.allocationId, paymentId, allocation.allocation_cents, allocation.invoice_id),
    refreshInvoicePaidStatusStatement(database, { invoiceId: allocation.invoice_id, organizationId, projectId, now }),
  ])
  return Number(released?.meta.changes) === 1 ? { releasedCents: Number(allocation.allocation_cents) } : "stale"
}

type PrepaidScope = {
  readonly organizationId: string
  readonly projectId: string
  readonly applicationId: string
  readonly actorId: string
  readonly now: string
}

/** No Compass payment is applied to the draw (voided payments are released). Binds: application id. */
const NO_ACTIVE_DRAW_PAYMENTS = `NOT EXISTS (SELECT 1 FROM pay_application_payment_allocations
  WHERE application_id = ? AND released_at IS NULL)`

function changedOne(result: D1Result): PaymentWriteResult {
  return Number(result.meta.changes) === 1 ? "saved" : "stale"
}

/**
 * Marks an imported draw "Paid before Compass". Written only while the draw
 * is a listed imported draw of the project, has no Compass payment applied,
 * and has no active mark (the partial unique index backs that up).
 */
export async function markDrawPaidBeforeCompass(database: D1Database, input: PrepaidScope & {
  readonly markId: string
  readonly note: string | null
}): Promise<PaymentWriteResult> {
  const { organizationId, projectId, applicationId, actorId, now } = input
  try {
    const result = await database
      .prepare(`INSERT INTO pay_application_prepaid_marks (
          id, organization_id, project_id, application_id, note, marked_by, marked_at
        ) SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM project_budget_applications
            WHERE id = ? AND project_id = ?
              AND source_system NOT IN (${SQL_LIST(NON_IMPORTED_BILL_SOURCES)})
              AND status NOT IN (${SQL_LIST(IMPORTED_DRAW_UNBILLED_STATUSES)})) = 1
          AND ${NO_ACTIVE_DRAW_PAYMENTS}
          AND NOT EXISTS (SELECT 1 FROM pay_application_prepaid_marks WHERE application_id = ? AND released_at IS NULL)`)
      .bind(
        input.markId, organizationId, projectId, applicationId, input.note, actorId, now,
        applicationId, projectId, applicationId, applicationId,
      )
      .run()
    return changedOne(result)
  } catch (error) {
    if (isGuardFailure(error)) return "stale"
    throw error
  }
}

/** Undoes a draw's active "Paid before Compass" mark with a reason, while no Compass payment is applied. The row stays as history. */
export async function undoDrawPaidBeforeCompass(database: D1Database, input: PrepaidScope & {
  readonly reason: string
}): Promise<PaymentWriteResult> {
  const { organizationId, projectId, applicationId, actorId, now } = input
  const result = await database
    .prepare(`UPDATE pay_application_prepaid_marks
      SET released_at = ?, released_by = ?, release_reason = ?
      WHERE application_id = ? AND organization_id = ? AND project_id = ? AND released_at IS NULL
        AND ${NO_ACTIVE_DRAW_PAYMENTS}`)
    .bind(now, actorId, input.reason, applicationId, organizationId, projectId, applicationId)
    .run()
  return changedOne(result)
}

/**
 * Moves a merged company's bills, invoices, credit memos and payments to the
 * kept company. A row carrying a NetSuite id stays put (the merge preview
 * blocks on it): it belongs to that accounting record.
 */
export function companyMergeFinancialStatements(database: D1Database, move: CompanyReferenceMove): D1PreparedStatement[] {
  const guard = companyMoveGuard(move)
  const { destinationId: keep, sourceId: archive, now } = move
  if (move.side === "vendor") return [
    database.prepare(`UPDATE vendor_bills SET vendor_id = ?, updated_at = ? WHERE vendor_id = ? AND netsuite_id IS NULL AND ${guard.sql}`)
      .bind(keep, now, archive, ...guard.binds),
    database.prepare(`UPDATE payments SET vendor_id = ?, updated_at = ? WHERE vendor_id = ? AND netsuite_id IS NULL AND ${guard.sql}`)
      .bind(keep, now, archive, ...guard.binds)]
  return [
    database.prepare(`UPDATE invoices SET customer_id = ?, updated_at = ? WHERE customer_id = ? AND netsuite_id IS NULL AND ${guard.sql}`)
      .bind(keep, now, archive, ...guard.binds),
    database.prepare(`UPDATE credit_memos SET customer_id = ?, updated_at = ? WHERE customer_id = ? AND netsuite_id IS NULL AND ${guard.sql}`)
      .bind(keep, now, archive, ...guard.binds),
    database.prepare(`UPDATE payments SET customer_id = ?, updated_at = ? WHERE customer_id = ? AND netsuite_id IS NULL AND ${guard.sql}`)
      .bind(keep, now, archive, ...guard.binds)]
}
