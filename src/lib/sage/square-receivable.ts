type SquareOwnerReceivableInput = {
  readonly organizationId: string;
  readonly projectId: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly sageJobShortName: string;
  readonly sageInvoiceId: string;
  readonly sageInvoiceNumber: string;
  readonly squareInvoiceId: string;
  readonly squarePaymentId: string;
  readonly invoiceIssueDate: string;
  readonly invoiceDueDate: string | null;
  readonly invoiceTotalCents: number;
  readonly invoiceTaxCents: number;
  readonly paymentCompletedAt: string;
  readonly paymentAmountCents: number;
  readonly processingFeeCents: number;
};

export type SquareOwnerReceivableIds = {
  readonly invoiceId: string;
  readonly paymentId: string;
  readonly allocationId: string;
  readonly invoiceOperationId: string;
  readonly paymentOperationId: string;
};

function cents(value: number, label: string, allowZero = false): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    (!allowZero && value === 0)
  ) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function dateOnly(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is invalid`);
  return new Date(parsed).toISOString().slice(0, 10);
}

function dollars(value: number): number {
  return value / 100;
}

export function squareOwnerReceivableIds(
  sageInvoiceId: string,
  squarePaymentId: string,
): SquareOwnerReceivableIds {
  return {
    invoiceId: `sage-square-invoice-${sageInvoiceId}`,
    paymentId: `sage-square-payment-${squarePaymentId}`,
    allocationId: `sage-square-allocation-${sageInvoiceId}-${squarePaymentId}`,
    invoiceOperationId: `sage-square-owner-invoice-${sageInvoiceId}`,
    paymentOperationId: `sage-square-owner-payment-${squarePaymentId}`,
  };
}

export async function upsertSquareOwnerReceivable(
  env: CloudflareEnv,
  input: SquareOwnerReceivableInput,
  now: string,
): Promise<SquareOwnerReceivableIds> {
  const invoiceTotalCents = cents(input.invoiceTotalCents, "Invoice total");
  const invoiceTaxCents = cents(input.invoiceTaxCents, "Invoice tax", true);
  const paymentAmountCents = cents(input.paymentAmountCents, "Payment amount");
  const processingFeeCents = cents(
    input.processingFeeCents,
    "Processing fee",
    true,
  );
  if (invoiceTaxCents > invoiceTotalCents) {
    throw new Error("Invoice tax exceeds the invoice total");
  }
  if (processingFeeCents > paymentAmountCents) {
    throw new Error("Square processing fee exceeds the payment");
  }

  const generatedIds = squareOwnerReceivableIds(
    input.sageInvoiceId,
    input.squarePaymentId,
  );
  const issueDate = dateOnly(input.invoiceIssueDate, "Invoice issue date");
  const dueDate = input.invoiceDueDate
    ? dateOnly(input.invoiceDueDate, "Invoice due date")
    : null;
  const paymentDate = dateOnly(
    input.paymentCompletedAt,
    "Payment completion date",
  );
  const invoiceTotal = dollars(invoiceTotalCents);
  const invoiceTax = dollars(invoiceTaxCents);
  const invoiceSubtotal = dollars(invoiceTotalCents - invoiceTaxCents);
  const paymentAmount = dollars(paymentAmountCents);
  const netAmountCents = paymentAmountCents - processingFeeCents;
  const invoiceSourceId = `sage-ar-invoice:${input.sageInvoiceId}`;
  const paymentSourceId = `square-payment:${input.squarePaymentId}`;
  const existingInvoice = await env.DB.prepare(
    `SELECT id, project_id, customer_id, invoice_number, total
     FROM invoices
     WHERE organization_id = ? AND source_system = 'sage'
       AND source_external_id = ?
     LIMIT 1`,
  )
    .bind(input.organizationId, invoiceSourceId)
    .first<{
      id: string;
      project_id: string | null;
      customer_id: string;
      invoice_number: string | null;
      total: number;
    }>();
  if (
    existingInvoice &&
    (existingInvoice.project_id !== input.projectId ||
      existingInvoice.customer_id !== input.customerId ||
      (existingInvoice.invoice_number !== null &&
        existingInvoice.invoice_number !== input.sageInvoiceNumber) ||
      (existingInvoice.total > 0 &&
        Math.round(existingInvoice.total * 100) !== invoiceTotalCents))
  ) {
    throw new Error(
      "Existing Compass invoice conflicts with the exact Sage invoice identity",
    );
  }
  const numberCollision = await env.DB.prepare(
    `SELECT id, source_external_id
     FROM invoices
     WHERE organization_id = ? AND project_id = ? AND source_system = 'sage'
       AND invoice_number = ? AND COALESCE(source_external_id, '') <> ?
     LIMIT 1`,
  )
    .bind(
      input.organizationId,
      input.projectId,
      input.sageInvoiceNumber,
      invoiceSourceId,
    )
    .first<{ id: string; source_external_id: string | null }>();
  if (numberCollision) {
    throw new Error(
      "Compass already contains this Sage invoice number with a different identity",
    );
  }
  const existingPayment = await env.DB.prepare(
    `SELECT id, project_id, customer_id, amount, gross_amount_cents
     FROM payments
     WHERE organization_id = ? AND source_system = 'sage'
       AND source_external_id = ?
     LIMIT 1`,
  )
    .bind(input.organizationId, paymentSourceId)
    .first<{
      id: string;
      project_id: string | null;
      customer_id: string | null;
      amount: number;
      gross_amount_cents: number | null;
    }>();
  const existingPaymentCents = existingPayment
    ? (existingPayment.gross_amount_cents ??
      Math.round(existingPayment.amount * 100))
    : null;
  if (
    existingPayment &&
    (existingPayment.project_id !== input.projectId ||
      existingPayment.customer_id !== input.customerId ||
      existingPaymentCents !== paymentAmountCents)
  ) {
    throw new Error(
      "Existing Compass payment conflicts with the exact Square payment identity",
    );
  }
  const ids: SquareOwnerReceivableIds = {
    ...generatedIds,
    invoiceId: existingInvoice?.id ?? generatedIds.invoiceId,
    paymentId: existingPayment?.id ?? generatedIds.paymentId,
  };

  await env.DB.batch([
    env.DB.prepare(
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
      ids.invoiceId,
      input.organizationId,
      input.customerId,
      input.projectId,
      invoiceSourceId,
      input.sageInvoiceNumber,
      issueDate,
      dueDate,
      invoiceSubtotal,
      invoiceTax,
      invoiceTotal,
      invoiceTotal,
      `Sage invoice ${input.sageInvoiceNumber}; Square invoice ${input.squareInvoiceId}.`,
      now,
      now,
    ),
    env.DB.prepare(
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
      ids.paymentId,
      input.organizationId,
      input.customerId,
      input.projectId,
      paymentSourceId,
      paymentAmount,
      paymentAmountCents,
      processingFeeCents,
      netAmountCents,
      paymentDate,
      input.squarePaymentId,
      `Square payment for Sage invoice ${input.sageInvoiceNumber}.`,
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO invoice_payment_allocations (
         id, organization_id, project_id, invoice_id, payment_id,
         allocation_cents, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(invoice_id, payment_id) DO UPDATE SET
         allocation_cents = excluded.allocation_cents`,
    ).bind(
      ids.allocationId,
      input.organizationId,
      input.projectId,
      ids.invoiceId,
      ids.paymentId,
      paymentAmountCents,
      now,
    ),
    env.DB.prepare(
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
    ).bind(
      ids.invoiceOperationId,
      input.projectId,
      invoiceSourceId,
      input.sageInvoiceNumber,
      `Owner invoice ${input.sageInvoiceNumber}`,
      `Imported from Sage and collected through Square invoice ${input.squareInvoiceId}.`,
      input.customerName,
      issueDate,
      dueDate,
      invoiceTotal,
      input.sageJobShortName,
      now,
      now,
      now,
    ),
    env.DB.prepare(
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
    ).bind(
      ids.paymentOperationId,
      input.projectId,
      paymentSourceId,
      input.squarePaymentId,
      `Square payment for ${input.sageInvoiceNumber}`,
      `Received in Square and awaiting the supported Sage receipt posting step.`,
      input.customerName,
      paymentDate,
      paymentAmount,
      input.sageJobShortName,
      now,
      now,
      now,
    ),
  ]);

  await env.DB.prepare(
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
  )
    .bind(
      ids.invoiceId,
      ids.invoiceId,
      ids.invoiceId,
      ids.invoiceId,
      now,
      ids.invoiceId,
      input.organizationId,
      input.projectId,
    )
    .run();

  const invoice = await env.DB.prepare(
    `SELECT status FROM invoices
     WHERE id = ? AND organization_id = ? AND project_id = ?`,
  )
    .bind(ids.invoiceId, input.organizationId, input.projectId)
    .first<{ status: string }>();
  if (!invoice) throw new Error("Compass owner receivable was not stored");

  await env.DB.prepare(
    `UPDATE project_operations
     SET status = ?, updated_at = ?
     WHERE id = ? AND project_id = ?`,
  )
    .bind(invoice.status, now, ids.invoiceOperationId, input.projectId)
    .run();

  return ids;
}
