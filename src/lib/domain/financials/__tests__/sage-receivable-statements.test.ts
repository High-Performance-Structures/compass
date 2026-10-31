import { describe, expect, it } from "vitest"

import { expectedShape, recordingD1, statementShape } from "@/lib/domain/__tests__/recording-d1"
import {
  refreshInvoicePaidStatusStatement,
  upsertInvoicePaymentAllocationStatement,
  upsertSageReceivableInvoiceStatement,
  upsertSageReceivablePaymentStatement,
} from "@/lib/domain/financials/store"

/*
 * The Square owner receivable used to write these with raw SQL in
 * src/lib/sage/square-receivable.ts. Same SQL (whitespace aside), same binds.
 */
const d1 = recordingD1()
const now = "2026-10-31T08:00:00.000Z"

describe("financials store: Square owner receivable", () => {
  it("upserts the invoice open and unpaid", () => {
    expect(statementShape(upsertSageReceivableInvoiceStatement(d1, {
      id: "i1", organizationId: "org-1", customerId: "c1", projectId: "p1", sourceExternalId: "sage-ar-invoice:g1",
      invoiceNumber: "1001", issueDate: "2026-10-01", dueDate: null, subtotal: 90, tax: 10, total: 100, memo: "m", now,
    }))).toEqual(expectedShape(
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
      ["i1", "org-1", "c1", "p1", "sage-ar-invoice:g1", "1001", "2026-10-01", null, 90, 10, 100, 100, "m", now, now],
    ))
  })

  it("upserts the received Square payment", () => {
    expect(statementShape(upsertSageReceivablePaymentStatement(d1, {
      id: "pay1", organizationId: "org-1", customerId: "c1", projectId: "p1", sourceExternalId: "square-payment:sp",
      amount: 100, grossAmountCents: 10000, processingFeeCents: 290, netAmountCents: 9710, paymentDate: "2026-10-02",
      referenceNumber: "sp", memo: "m", now,
    }))).toEqual(expectedShape(
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
      ["pay1", "org-1", "c1", "p1", "square-payment:sp", 100, 10000, 290, 9710, "2026-10-02", "sp", "m", now, now],
    ))
  })

  it("allocates the payment and recomputes the invoice's paid status", () => {
    expect(statementShape(upsertInvoicePaymentAllocationStatement(d1, {
      id: "a1", organizationId: "org-1", projectId: "p1", invoiceId: "i1", paymentId: "pay1", allocationCents: 10000, now,
    }))).toEqual(expectedShape(
      `INSERT INTO invoice_payment_allocations (
         id, organization_id, project_id, invoice_id, payment_id,
         allocation_cents, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(invoice_id, payment_id) DO UPDATE SET
         allocation_cents = excluded.allocation_cents`,
      ["a1", "org-1", "p1", "i1", "pay1", 10000, now],
    ))
    expect(statementShape(refreshInvoicePaidStatusStatement(d1, { invoiceId: "i1", organizationId: "org-1", projectId: "p1", now })))
      .toEqual(expectedShape(
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
        ["i1", "i1", "i1", "i1", now, "i1", "org-1", "p1"],
      ))
  })
})
