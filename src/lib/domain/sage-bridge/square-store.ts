/**
 * The only code that writes sage_square_payment_operations, the queue of
 * Square receipts and processing-fee postings bound for Sage (architecture
 * standard, section 1). Square → Sage fee posting is live: nothing here
 * decides what is posted or when. The callers own those rules and pass
 * their status fences (for example the "awaiting entry" or "open" status
 * lists) in unchanged; this module owns the write itself.
 *
 * The Drizzle builder comes back unexecuted (chain `.returning()` or await
 * it); raw statements come back bound but not run, so a caller can keep them
 * in one atomic D1 batch with the notification writes they gate. No auth.
 */
import type { SQL } from "drizzle-orm"
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import { sageSquarePaymentOperations } from "@/db/schema-sage"
import type { Db } from "@/lib/server/action-context"

function operationUpdate(db: Db, changes: SQLiteUpdateSetSource<typeof sageSquarePaymentOperations>, where: SQL | undefined) {
  return db.update(sageSquarePaymentOperations).set(changes).where(where)
}

/** Unexecuted update fenced by the caller's `where` (operation type, claim, status, stale cutoff). */
export function updateSageSquarePaymentOperations(
  db: Db,
  changes: SQLiteUpdateSetSource<typeof sageSquarePaymentOperations>,
  where: SQL | undefined
): ReturnType<typeof operationUpdate> {
  return operationUpdate(db, changes, where)
}

/** One Square receipt or fee operation, keyed by its idempotency key. */
export type SageSquareOperationUpsert = {
  readonly id: string
  readonly organizationId: string | null
  readonly projectId: string | null
  readonly operationType: string
  readonly idempotencyKey: string
  readonly squarePaymentId: string
  readonly squareInvoiceId: string
  readonly squareOrderId: string
  readonly squareLocationId: string
  readonly department: string
  readonly sageJobShortName: string | null
  readonly sageInvoiceId: string
  readonly sageInvoiceNumber: string
  readonly amountCents: number
  readonly depositAccountNumber: number
  readonly merchantFeeAccountNumber: number
  readonly payloadJson: string
  readonly status: string
  readonly paymentCompletedAt: string
  readonly now: string
}

/**
 * Inserts the operation, or on a repeated idempotency key refreshes only its
 * project scope. Amounts, accounts, payload and status never change here.
 */
export function upsertSageSquarePaymentOperationStatement(
  database: D1Database,
  input: SageSquareOperationUpsert
): D1PreparedStatement {
  return database.prepare(
    `INSERT INTO sage_square_payment_operations (
       id, organization_id, project_id, operation_type, idempotency_key, square_payment_id,
       square_invoice_id, square_order_id, square_location_id, department,
       sage_job_short_name, sage_invoice_id, sage_invoice_number, amount_cents, currency,
       deposit_account_number, merchant_fee_account_number, payload_json,
       status, payment_completed_at, requested_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(idempotency_key) DO UPDATE SET
       organization_id = excluded.organization_id,
       project_id = excluded.project_id,
       sage_job_short_name = excluded.sage_job_short_name,
       updated_at = excluded.updated_at`
  ).bind(
    input.id,
    input.organizationId,
    input.projectId,
    input.operationType,
    input.idempotencyKey,
    input.squarePaymentId,
    input.squareInvoiceId,
    input.squareOrderId,
    input.squareLocationId,
    input.department,
    input.sageJobShortName,
    input.sageInvoiceId,
    input.sageInvoiceNumber,
    input.amountCents,
    input.depositAccountNumber,
    input.merchantFeeAccountNumber,
    input.payloadJson,
    input.status,
    input.paymentCompletedAt,
    input.now,
    input.now
  )
}

/**
 * Flags every not-yet-succeeded operation of one Square payment (or invoice)
 * for review after Square reports a change or refund.
 */
export function flagSageSquareOperationsForAttentionStatement(
  database: D1Database,
  input: {
    readonly match: "square_payment_id" | "square_invoice_id"
    readonly squareId: string
    readonly errorMessage: string
    readonly now: string
  }
): D1PreparedStatement {
  return database.prepare(
    `UPDATE sage_square_payment_operations
       SET status = CASE WHEN status = 'succeeded' THEN status ELSE 'attention' END,
           error_message = ?, updated_at = ?
       WHERE ${input.match} = ?`
  ).bind(input.errorMessage, input.now, input.squareId)
}

/**
 * Records the Sage login that created the invoice, first answer wins. Never
 * touches posting status, amounts, or the write queue.
 */
export function recordSageSquareInvoiceCreatorStatement(
  database: D1Database,
  input: { readonly operationId: string; readonly organizationId: string; readonly username: string | null; readonly checkedAt: string }
): D1PreparedStatement {
  return database.prepare(`UPDATE sage_square_payment_operations
    SET sage_invoice_creator_username = COALESCE(sage_invoice_creator_username, ?), invoice_creator_lookup_at = ?
    WHERE id = ? AND organization_id = ?
      AND (sage_invoice_creator_username IS NULL OR sage_invoice_creator_username = ?)
      AND (invoice_creator_lookup_at IS NULL OR invoice_creator_lookup_at < ?)`)
    .bind(input.username, input.checkedAt, input.operationId, input.organizationId, input.username, input.checkedAt)
}

/**
 * Stamps the creator alert as sent, only while the receipt is still in one
 * of `openStatuses` (the caller's SQL list) and its recipients were stored.
 */
export function markSageSquareCreatorNotifiedStatement(
  database: D1Database,
  input: { readonly operationId: string; readonly organizationId: string; readonly eventId: string; readonly openStatuses: string; readonly now: string }
): D1PreparedStatement {
  return database.prepare(`UPDATE sage_square_payment_operations SET invoice_creator_notified_at = ?
      WHERE id = ? AND organization_id = ? AND invoice_creator_notified_at IS NULL
        AND error_message IS NULL AND status IN ${input.openStatuses}
        AND EXISTS (SELECT 1 FROM notification_recipients WHERE event_id = ?)`)
    .bind(input.now, input.operationId, input.organizationId, input.eventId)
}

/** Remembers when Sage was last checked for a receipt that is not there yet. */
export function recordSageReceiptCheckedStatement(
  database: D1Database,
  input: { readonly operationId: string; readonly organizationId: string; readonly checkedAt: string }
): D1PreparedStatement {
  return database.prepare(`UPDATE sage_square_payment_operations SET sage_receipt_checked_at = ? WHERE id = ? AND organization_id = ?`)
    .bind(input.checkedAt, input.operationId, input.organizationId)
}

/** Marks a receipt staff entered in Sage themselves, while it still matches `awaitingEntry`. */
export function markSageReceiptAlreadyInSageStatement(
  database: D1Database,
  input: {
    readonly operationId: string
    readonly organizationId: string
    readonly sageRecordId: string | null
    readonly sageRecordNumber: string | null
    readonly checkedAt: string
    readonly awaitingEntry: string
    readonly now: string
  }
): D1PreparedStatement {
  return database.prepare(`UPDATE sage_square_payment_operations
      SET status = 'already_in_sage', sage_record_id = ?, sage_record_number = ?, sage_receipt_checked_at = ?,
        completed_at = COALESCE(completed_at, ?), updated_at = ?, claim_token = NULL
      WHERE id = ? AND organization_id = ? AND ${input.awaitingEntry}`)
    .bind(input.sageRecordId, input.sageRecordNumber, input.checkedAt, input.now, input.now, input.operationId, input.organizationId)
}

/** Advances the reminder counter from `previousCount`, only if reminder `eventId` was stored. */
export function recordSageReceiptReminderStatement(
  database: D1Database,
  input: { readonly operationId: string; readonly organizationId: string; readonly previousCount: number; readonly eventId: string; readonly now: string }
): D1PreparedStatement {
  return database.prepare(`UPDATE sage_square_payment_operations SET receipt_reminded_at = ?, receipt_reminder_count = ?
        WHERE id = ? AND organization_id = ? AND receipt_reminder_count = ? AND EXISTS (SELECT 1 FROM notification_events WHERE id = ?)`)
    .bind(input.now, input.previousCount + 1, input.operationId, input.organizationId, input.previousCount, input.eventId)
}
