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
 *
 * Status changes, here and for sage_square_webhook_events, are events of
 * ./square-machines.ts written as compare-and-set on the event's source
 * states (and the writer's claim token or the webhook attempt holding the
 * lease), so a repeated or late request never overwrites a newer outcome.
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm"
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import { sageSquarePaymentOperations } from "@/db/schema-sage"
import type { Db } from "@/lib/server/action-context"

import {
  squarePaymentOperationMachine,
  squareWebhookEventMachine,
  type SquarePaymentOperationEvent,
  type SquareWebhookEventEvent,
} from "./square-machines"

function operationUpdate(db: Db, changes: SQLiteUpdateSetSource<typeof sageSquarePaymentOperations>, where: SQL | undefined) {
  return db.update(sageSquarePaymentOperations).set(changes).where(where)
}

/** Unexecuted update fenced by the caller's `where`. Never a status: use the event functions below. */
export function updateSageSquarePaymentOperations(
  db: Db,
  changes: SQLiteUpdateSetSource<typeof sageSquarePaymentOperations>,
  where: SQL | undefined
): ReturnType<typeof operationUpdate> {
  if (Reflect.get(changes, "status") !== undefined) {
    throw new Error("Change a Square payment operation's status with the event functions in sage-bridge/square-store.ts")
  }
  return operationUpdate(db, changes, where)
}

const SQL_LIST = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(", ")

/** The operation is in a state `event` may leave from. */
function operationStatusIn(event: SquarePaymentOperationEvent): SQL {
  return inArray(sageSquarePaymentOperations.status, [...squarePaymentOperationMachine.transitions[event].from])
}

/** queued, or running with a claim older than `staleClaimIso` (the writer that held it went quiet). */
function claimable(staleClaimIso: string): SQL | undefined {
  return and(
    operationStatusIn("claim"),
    sql`(${sageSquarePaymentOperations.status} <> 'running' OR ${sageSquarePaymentOperations.claimedAt} < ${staleClaimIso})`,
  )
}

/** claim: the Sage writer takes one fee operation. False when another request claimed it first. */
export async function claimSageSquareFeeOperation(db: Db, input: {
  readonly operationId: string
  readonly claimToken: string
  readonly staleClaimIso: string
  readonly now: string
}): Promise<boolean> {
  const claimed = await operationUpdate(db, {
    status: squarePaymentOperationMachine.transitions.claim.to,
    claimToken: input.claimToken,
    claimedAt: input.now,
    attemptCount: sql`${sageSquarePaymentOperations.attemptCount} + 1`,
    updatedAt: input.now,
  }, and(
    eq(sageSquarePaymentOperations.id, input.operationId),
    eq(sageSquarePaymentOperations.operationType, "post_square_processing_fee"),
    claimable(input.staleClaimIso),
  )).returning({ id: sageSquarePaymentOperations.id })
  return claimed.length === 1
}

/**
 * succeed, fail or found_in_sage: the writer's result for the claim it holds.
 * False when the claim is gone (the lease ran out and another request took
 * it, Square flagged the payment, or the result was already recorded); the
 * caller then sends nothing else (no notification).
 */
export async function finishSageSquareFeeOperation(db: Db, input: {
  readonly operationId: string
  readonly claimToken: string
  readonly event: "succeed" | "fail" | "found_in_sage"
  readonly sageRecordId: string | null
  readonly sageRecordNumber: string | null
  readonly errorMessage: string | null
  readonly now: string
}): Promise<boolean> {
  const finished = await operationUpdate(db, {
    status: squarePaymentOperationMachine.transitions[input.event].to,
    ...(input.event === "fail" ? {} : { sageRecordId: input.sageRecordId, sageRecordNumber: input.sageRecordNumber }),
    errorMessage: input.errorMessage,
    completedAt: input.now,
    updatedAt: input.now,
  }, and(
    eq(sageSquarePaymentOperations.id, input.operationId),
    eq(sageSquarePaymentOperations.claimToken, input.claimToken),
    operationStatusIn(input.event),
    eq(sageSquarePaymentOperations.status, "running"),
  )).returning({ id: sageSquarePaymentOperations.id })
  return finished.length === 1
}

/**
 * The writer's result arrived just after Square flagged the payment (the row
 * left "running" for "attention" while the claim was out). The status stays
 * attention for a person; what Sage did (its record, when it posted) is kept
 * so they can see it. True when the row was in that state for this claim.
 */
export async function recordResultOnFlaggedSageSquareOperation(db: Db, input: {
  readonly operationId: string
  readonly claimToken: string
  readonly sageRecordId: string | null
  readonly sageRecordNumber: string | null
  readonly now: string
}): Promise<boolean> {
  const updated = await operationUpdate(db, {
    sageRecordId: sql`COALESCE(${input.sageRecordId}, ${sageSquarePaymentOperations.sageRecordId})`,
    sageRecordNumber: sql`COALESCE(${input.sageRecordNumber}, ${sageSquarePaymentOperations.sageRecordNumber})`,
    updatedAt: input.now,
  }, and(
    eq(sageSquarePaymentOperations.id, input.operationId),
    eq(sageSquarePaymentOperations.claimToken, input.claimToken),
    eq(sageSquarePaymentOperations.status, squarePaymentOperationMachine.transitions.flag.to),
  )).returning({ id: sageSquarePaymentOperations.id })
  return updated.length === 1
}

/** hand_to_staff: an older queued (or stale running) receipt becomes a manual Sage entry. */
export async function handSageSquareReceiptToStaff(db: Db, input: {
  readonly operationId: string
  readonly staleClaimIso: string
  readonly now: string
}): Promise<boolean> {
  const moved = await operationUpdate(db, {
    status: squarePaymentOperationMachine.transitions.hand_to_staff.to,
    claimToken: null,
    claimedAt: null,
    updatedAt: input.now,
  }, and(
    eq(sageSquarePaymentOperations.id, input.operationId),
    eq(sageSquarePaymentOperations.operationType, "post_square_receipt"),
    operationStatusIn("hand_to_staff"),
    sql`(${sageSquarePaymentOperations.status} <> 'running' OR ${sageSquarePaymentOperations.claimedAt} < ${input.staleClaimIso})`,
  )).returning({ id: sageSquarePaymentOperations.id })
  return moved.length === 1
}

/** Every fee operation is claimable while queued or after this stale cutoff; for the writer's discovery query. */
export function claimableSageSquareFeeOperations(staleClaimIso: string): SQL | undefined {
  return and(eq(sageSquarePaymentOperations.operationType, "post_square_processing_fee"), claimable(staleClaimIso))
}

/** Reclaimable older receipts (queued, or running past the cutoff); for the reconciliation query. */
export function receiptsAwaitingHandOff(staleClaimIso: string): SQL | undefined {
  return and(
    eq(sageSquarePaymentOperations.operationType, "post_square_receipt"),
    operationStatusIn("hand_to_staff"),
    sql`(${sageSquarePaymentOperations.status} <> 'running' OR ${sageSquarePaymentOperations.claimedAt} < ${staleClaimIso})`,
  )
}

/**
 * Queues the next processing-fee posting for a Square payment: `deltaCents`
 * on top of the `recordedCents` already queued. Written only while the
 * payment's queued fees still add up to `recordedCents`, so two webhook
 * deliveries that saw different fee totals at once can't both queue a delta
 * (which would post the fee twice). A repeated idempotency key (the same
 * total queued before) refreshes only the project scope. Returns whether the
 * row is there now: false means the fees changed in between; read them again.
 */
export async function insertSageSquareFeeOperation(
  database: D1Database,
  input: SageSquareOperationUpsert & { readonly recordedCents: number }
): Promise<boolean> {
  const result = await database.prepare(
    `INSERT INTO sage_square_payment_operations (
       id, organization_id, project_id, operation_type, idempotency_key, square_payment_id,
       square_invoice_id, square_order_id, square_location_id, department,
       sage_job_short_name, sage_invoice_id, sage_invoice_number, amount_cents, currency,
       deposit_account_number, merchant_fee_account_number, payload_json,
       status, payment_completed_at, requested_at, updated_at
     ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?
     WHERE (SELECT COALESCE(SUM(amount_cents), 0) FROM sage_square_payment_operations
            WHERE square_payment_id = ? AND operation_type = 'post_square_processing_fee') = ?
     ON CONFLICT(idempotency_key) DO UPDATE SET
       organization_id = excluded.organization_id,
       project_id = excluded.project_id,
       sage_job_short_name = excluded.sage_job_short_name,
       updated_at = excluded.updated_at`
  ).bind(
    input.id, input.organizationId, input.projectId, input.operationType, input.idempotencyKey,
    input.squarePaymentId, input.squareInvoiceId, input.squareOrderId, input.squareLocationId,
    input.department, input.sageJobShortName, input.sageInvoiceId, input.sageInvoiceNumber,
    input.amountCents, input.depositAccountNumber, input.merchantFeeAccountNumber, input.payloadJson,
    input.status, input.paymentCompletedAt, input.now, input.now,
    input.squarePaymentId, input.recordedCents,
  ).run()
  if (Number(result.meta.changes) > 0) return true
  const stored = await database
    .prepare(`SELECT 1 AS found FROM sage_square_payment_operations WHERE idempotency_key = ?`)
    .bind(input.idempotencyKey)
    .first<{ found: number }>()
  return stored !== null
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
  // flag: every state but succeeded (and attention, already there); every row takes the newer message, as before.
  return database.prepare(
    `UPDATE sage_square_payment_operations
       SET status = CASE WHEN status IN (${SQL_LIST(squarePaymentOperationMachine.transitions.flag.from)}) THEN '${squarePaymentOperationMachine.transitions.flag.to}' ELSE status END,
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
  // found_in_sage, from the caller's "awaiting entry" fence (a manual receipt).
  return database.prepare(`UPDATE sage_square_payment_operations
      SET status = '${squarePaymentOperationMachine.transitions.found_in_sage.to}', sage_record_id = ?, sage_record_number = ?, sage_receipt_checked_at = ?,
        completed_at = COALESCE(completed_at, ?), updated_at = ?, claim_token = NULL
      WHERE id = ? AND organization_id = ? AND ${input.awaitingEntry}
        AND status IN (${SQL_LIST(squarePaymentOperationMachine.transitions.found_in_sage.from)})`)
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

// ---------------------------------------------------------------------------
// sage_square_webhook_events: one row per Square event id. Square delivers at
// least once; the row's lease (status "processing" + attempt_count) makes
// sure one request at a time processes an event, and that only the request
// holding the current attempt records its outcome.
// ---------------------------------------------------------------------------

export type SquareWebhookLease =
  | { readonly outcome: "process"; readonly attempt: number }
  | { readonly outcome: "duplicate" }

/**
 * Starts processing an event: a new event id, a failed one, or one whose
 * processing lease ran out (`staleBefore`). Anything else is a duplicate
 * delivery and is answered without processing it again.
 */
export async function beginSquareWebhookEventLease(database: D1Database, input: {
  readonly eventId: string
  readonly eventType: string
  readonly squareObjectId: string | null
  readonly squareCreatedAt: string
  readonly staleBefore: string
  readonly now: string
}): Promise<SquareWebhookLease> {
  const inserted = await database.prepare(
    `INSERT INTO sage_square_webhook_events (
       event_id, event_type, square_object_id, square_created_at,
       status, attempt_count, received_at, updated_at
     ) VALUES (?, ?, ?, ?, '${squareWebhookEventMachine.initial}', 1, ?, ?)
     ON CONFLICT(event_id) DO NOTHING`
  ).bind(input.eventId, input.eventType, input.squareObjectId, input.squareCreatedAt, input.now, input.now).run()
  if (Number(inserted.meta.changes) > 0) return { outcome: "process", attempt: 1 }
  // retry, but not from attention: only the recovery pass reopens those.
  const reclaimed = await database.prepare(
    `UPDATE sage_square_webhook_events
     SET status = '${squareWebhookEventMachine.transitions.retry.to}', attempt_count = attempt_count + 1,
         error_message = NULL, updated_at = ?
     WHERE event_id = ?
       AND (status = 'failed' OR (status = 'processing' AND updated_at <= ?))
     RETURNING attempt_count`
  ).bind(input.now, input.eventId, input.staleBefore).first<{ attempt_count: number }>()
  return reclaimed ? { outcome: "process", attempt: Number(reclaimed.attempt_count) } : { outcome: "duplicate" }
}

/**
 * The recovery pass reopens a flagged or failed event (the caller's
 * candidate query picked only known, fixable causes). Null when another
 * pass took it first.
 */
export async function reopenSquareWebhookEventLease(database: D1Database, input: {
  readonly eventId: string
  readonly retryBefore: string
  readonly now: string
}): Promise<number | null> {
  const claimed = await database.prepare(
    `UPDATE sage_square_webhook_events
     SET status = '${squareWebhookEventMachine.transitions.retry.to}', attempt_count = attempt_count + 1,
         error_message = NULL, updated_at = ?
     WHERE event_id = ? AND status IN ('attention', 'failed')
       AND updated_at <= ?
     RETURNING attempt_count`
  ).bind(input.now, input.eventId, input.retryBefore).first<{ attempt_count: number }>()
  return claimed ? Number(claimed.attempt_count) : null
}

/**
 * complete, fail or flag: records the outcome of the attempt holding the
 * lease. False when the lease was lost (it ran out and another request took
 * over); that request records the outcome instead.
 */
export async function finishSquareWebhookEvent(database: D1Database, input: {
  readonly eventId: string
  readonly attempt: number
  readonly event: Exclude<SquareWebhookEventEvent, "retry">
  readonly errorMessage: string | null
  readonly now: string
}): Promise<boolean> {
  const rule = squareWebhookEventMachine.transitions[input.event]
  const processedAt = input.event === "fail" ? "processed_at" : "?"
  const result = await database.prepare(
    `UPDATE sage_square_webhook_events
     SET status = '${rule.to}', error_message = ?, processed_at = ${processedAt}, updated_at = ?
     WHERE event_id = ? AND attempt_count = ? AND status IN (${SQL_LIST(rule.from)})`
  ).bind(
    input.errorMessage === null ? null : input.errorMessage.slice(0, 1000),
    ...(input.event === "fail" ? [] : [input.now]),
    input.now, input.eventId, input.attempt,
  ).run()
  return Number(result.meta.changes) === 1
}
