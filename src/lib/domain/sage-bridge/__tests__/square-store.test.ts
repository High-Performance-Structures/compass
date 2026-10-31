import { and, eq, lt, or } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { sageSquarePaymentOperations } from "@/db/schema-sage"
import { expectedShape, recordingD1, statementShape } from "@/lib/domain/__tests__/recording-d1"
import {
  flagSageSquareOperationsForAttentionStatement,
  markSageReceiptAlreadyInSageStatement,
  markSageSquareCreatorNotifiedStatement,
  recordSageReceiptCheckedStatement,
  recordSageReceiptReminderStatement,
  recordSageSquareInvoiceCreatorStatement,
  updateSageSquarePaymentOperations,
  upsertSageSquarePaymentOperationStatement,
} from "@/lib/domain/sage-bridge/square-store"

/*
 * Square → Sage fee posting is live, so each moved statement must be the one
 * the integration ran before: same SQL (whitespace aside), same binds.
 */
// @ts-expect-error Statements are only built here, never run.
const db = getDb({})
const d1 = recordingD1()
const now = "2026-10-31T08:00:00.000Z"
const OPEN_STATUSES = "('queued', 'running', 'manual_action_required', 'succeeded', 'already_in_sage')"
const AWAITING_ENTRY = `operation_type = 'post_square_receipt' AND status = 'manual_action_required'`

describe("Sage Square store", () => {
  it("keeps the fee-writer claim fence and .returning()", () => {
    const changes = { status: "manual_action_required", claimToken: null, claimedAt: null, updatedAt: now }
    const fence = and(eq(sageSquarePaymentOperations.id, "op1"), or(
      eq(sageSquarePaymentOperations.status, "queued"),
      and(eq(sageSquarePaymentOperations.status, "running"), lt(sageSquarePaymentOperations.claimedAt, now)),
    ))
    expect(updateSageSquarePaymentOperations(db, changes, fence).returning({ id: sageSquarePaymentOperations.id }).toSQL()).toEqual(
      db.update(sageSquarePaymentOperations).set(changes).where(fence).returning({ id: sageSquarePaymentOperations.id }).toSQL(),
    )
  })

  it("upserts an operation by idempotency key, refreshing only its scope", () => {
    const input = {
      id: "op1", organizationId: "org-1", projectId: "p1", operationType: "post_square_receipt", idempotencyKey: "k1",
      squarePaymentId: "sp", squareInvoiceId: "si", squareOrderId: "so", squareLocationId: "sl", department: "O",
      sageJobShortName: "O-1", sageInvoiceId: "gi", sageInvoiceNumber: "1001", amountCents: 12345,
      depositAccountNumber: 10000, merchantFeeAccountNumber: 60000, payloadJson: "{}", status: "queued",
      paymentCompletedAt: now, now,
    }
    expect(statementShape(upsertSageSquarePaymentOperationStatement(d1, input))).toEqual(expectedShape(
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
       updated_at = excluded.updated_at`,
      ["op1", "org-1", "p1", "post_square_receipt", "k1", "sp", "si", "so", "sl", "O", "O-1", "gi", "1001", 12345,
        10000, 60000, "{}", "queued", now, now, now],
    ))
  })

  it("flags a changed payment or invoice for attention as before", () => {
    for (const match of ["square_payment_id", "square_invoice_id"] as const) {
      expect(statementShape(flagSageSquareOperationsForAttentionStatement(d1, { match, squareId: "x", errorMessage: "e", now })))
        .toEqual(expectedShape(
          `UPDATE sage_square_payment_operations
       SET status = CASE WHEN status = 'succeeded' THEN status ELSE 'attention' END,
           error_message = ?, updated_at = ?
       WHERE ${match} = ?`,
          ["e", now, "x"],
        ))
    }
  })

  it("records the invoice creator and the creator alert as before", () => {
    expect(statementShape(recordSageSquareInvoiceCreatorStatement(d1, {
      operationId: "op1", organizationId: "org-1", username: "jdoe", checkedAt: now,
    }))).toEqual(expectedShape(
      `UPDATE sage_square_payment_operations
    SET sage_invoice_creator_username = COALESCE(sage_invoice_creator_username, ?), invoice_creator_lookup_at = ?
    WHERE id = ? AND organization_id = ?
      AND (sage_invoice_creator_username IS NULL OR sage_invoice_creator_username = ?)
      AND (invoice_creator_lookup_at IS NULL OR invoice_creator_lookup_at < ?)`,
      ["jdoe", now, "op1", "org-1", "jdoe", now],
    ))
    expect(statementShape(markSageSquareCreatorNotifiedStatement(d1, {
      operationId: "op1", organizationId: "org-1", eventId: "e1", openStatuses: OPEN_STATUSES, now,
    }))).toEqual(expectedShape(
      `UPDATE sage_square_payment_operations SET invoice_creator_notified_at = ?
      WHERE id = ? AND organization_id = ? AND invoice_creator_notified_at IS NULL
        AND error_message IS NULL AND status IN ${OPEN_STATUSES}
        AND EXISTS (SELECT 1 FROM notification_recipients WHERE event_id = ?)`,
      [now, "op1", "org-1", "e1"],
    ))
  })

  it("records Sage receipt checks and reminders as before", () => {
    expect(statementShape(recordSageReceiptCheckedStatement(d1, { operationId: "op1", organizationId: "org-1", checkedAt: now })))
      .toEqual(expectedShape(
        `UPDATE sage_square_payment_operations SET sage_receipt_checked_at = ? WHERE id = ? AND organization_id = ?`,
        [now, "op1", "org-1"],
      ))
    expect(statementShape(markSageReceiptAlreadyInSageStatement(d1, {
      operationId: "op1", organizationId: "org-1", sageRecordId: "r", sageRecordNumber: "n", checkedAt: "c",
      awaitingEntry: AWAITING_ENTRY, now,
    }))).toEqual(expectedShape(
      `UPDATE sage_square_payment_operations
      SET status = 'already_in_sage', sage_record_id = ?, sage_record_number = ?, sage_receipt_checked_at = ?,
        completed_at = COALESCE(completed_at, ?), updated_at = ?, claim_token = NULL
      WHERE id = ? AND organization_id = ? AND ${AWAITING_ENTRY}`,
      ["r", "n", "c", now, now, "op1", "org-1"],
    ))
    expect(statementShape(recordSageReceiptReminderStatement(d1, {
      operationId: "op1", organizationId: "org-1", previousCount: 2, eventId: "e3", now,
    }))).toEqual(expectedShape(
      `UPDATE sage_square_payment_operations SET receipt_reminded_at = ?, receipt_reminder_count = ?
        WHERE id = ? AND organization_id = ? AND receipt_reminder_count = ? AND EXISTS (SELECT 1 FROM notification_events WHERE id = ?)`,
      [now, 3, "op1", "org-1", 2, "e3"],
    ))
  })
})
