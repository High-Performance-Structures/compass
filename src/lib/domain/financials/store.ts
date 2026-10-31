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
 * credit memos, and the contract budget (revisions, their lines and their
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
             WHERE invoice_id = ?
           ), 0)
         ),
         amount_due = MAX(
           total - COALESCE((
             SELECT SUM(allocation_cents) / 100.0
             FROM invoice_payment_allocations
             WHERE invoice_id = ?
           ), 0),
           0
         ),
         status = CASE
           WHEN COALESCE((
             SELECT SUM(allocation_cents)
             FROM invoice_payment_allocations
             WHERE invoice_id = ?
           ), 0) >= CAST(ROUND(total * 100) AS INTEGER) THEN 'paid'
           WHEN COALESCE((
             SELECT SUM(allocation_cents)
             FROM invoice_payment_allocations
             WHERE invoice_id = ?
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
