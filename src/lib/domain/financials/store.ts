import { and, eq } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import {
  creditMemos,
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
import type { Db } from "@/lib/server/action-context"

/**
 * The only writer of the financial tables: invoices, vendor bills, payments,
 * credit memos, payment allocations (invoices and pay applications), and the contract budget (revisions, their lines and their
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

/** Recomputes an invoice's amount paid, amount due and paid status from its stored allocations. */
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
         amount_due = MAX(
           total - COALESCE((
             SELECT SUM(allocation_cents) / 100.0
             FROM invoice_payment_allocations
             WHERE invoice_id = ? AND released_at IS NULL
           ), 0),
           0
         ),
         status = CASE
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

const INVOICE_PAID_CENTS = `(SELECT CAST(ROUND(amount_paid * 100) AS INTEGER) FROM invoices
  WHERE id = ? AND organization_id = ? AND project_id = ?)`

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
    .prepare(`UPDATE invoices SET amount_paid = ?, amount_due = ?, status = ?, updated_at = ?
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
              (SELECT COUNT(*) FROM project_budget_applications
                WHERE id = ? AND project_id = ? AND source_system = 'compass_contract_budget' AND status = 'billed') = 1
              AND COALESCE((SELECT SUM(allocation_cents) FROM pay_application_payment_allocations
                WHERE application_id = ? AND released_at IS NULL), 0) = ?
              AND ${PAYMENT_GUARD}
            THEN ? ELSE 0 END, ?, ?`)
        .bind(
          allocation.allocationId, organizationId, projectId, allocation.applicationId, paymentId,
          allocation.applicationId, projectId, allocation.applicationId, allocation.expectedPaidCents,
          ...paymentBinds, allocation.cents, actorId, now,
        ),
    ]
  }
  return [
    database
      .prepare(`INSERT INTO invoice_payment_allocations (
          id, organization_id, project_id, invoice_id, payment_id, allocation_cents, created_at
        ) SELECT ?, ?, ?, ?, ?, CASE WHEN ${INVOICE_PAID_CENTS} = ? AND ${PAYMENT_GUARD} THEN ? ELSE 0 END, ?`)
      .bind(
        allocation.allocationId, organizationId, projectId, allocation.invoiceId, paymentId,
        allocation.invoiceId, organizationId, projectId, allocation.expectedPaidCents,
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
