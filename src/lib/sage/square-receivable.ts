import {
  refreshInvoicePaidStatusStatement,
  upsertInvoicePaymentAllocationStatement,
  upsertSageReceivableInvoiceStatement,
  upsertSageReceivablePaymentStatement,
} from "@/lib/domain/financials/store";
import {
  setSquareInvoiceOperationStatus,
  squareOwnerInvoiceOperationUpsertStatement,
  squarePaymentOperationUpsertStatement,
} from "@/lib/domain/operations/store";

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
    upsertSageReceivableInvoiceStatement(env.DB, {
      id: ids.invoiceId,
      organizationId: input.organizationId,
      customerId: input.customerId,
      projectId: input.projectId,
      sourceExternalId: invoiceSourceId,
      invoiceNumber: input.sageInvoiceNumber,
      issueDate,
      dueDate,
      subtotal: invoiceSubtotal,
      tax: invoiceTax,
      total: invoiceTotal,
      memo: `Sage invoice ${input.sageInvoiceNumber}; Square invoice ${input.squareInvoiceId}.`,
      now,
    }),
    upsertSageReceivablePaymentStatement(env.DB, {
      id: ids.paymentId,
      organizationId: input.organizationId,
      customerId: input.customerId,
      projectId: input.projectId,
      sourceExternalId: paymentSourceId,
      amount: paymentAmount,
      grossAmountCents: paymentAmountCents,
      processingFeeCents,
      netAmountCents,
      paymentDate,
      referenceNumber: input.squarePaymentId,
      memo: `Square payment for Sage invoice ${input.sageInvoiceNumber}.`,
      now,
    }),
    upsertInvoicePaymentAllocationStatement(env.DB, {
      id: ids.allocationId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      invoiceId: ids.invoiceId,
      paymentId: ids.paymentId,
      allocationCents: paymentAmountCents,
      now,
    }),
    squareOwnerInvoiceOperationUpsertStatement(env.DB, {
      id: ids.invoiceOperationId,
      projectId: input.projectId,
      sourceRecordId: invoiceSourceId,
      sourceRecordNumber: input.sageInvoiceNumber,
      title: `Owner invoice ${input.sageInvoiceNumber}`,
      description: `Imported from Sage and collected through Square invoice ${input.squareInvoiceId}.`,
      companyName: input.customerName,
      startDate: issueDate,
      dueDate,
      amount: invoiceTotal,
      sageJobNumber: input.sageJobShortName,
      now,
    }),
    squarePaymentOperationUpsertStatement(env.DB, {
      id: ids.paymentOperationId,
      projectId: input.projectId,
      sourceRecordId: paymentSourceId,
      sourceRecordNumber: input.squarePaymentId,
      title: `Square payment for ${input.sageInvoiceNumber}`,
      description: `Received in Square and awaiting the supported Sage receipt posting step.`,
      companyName: input.customerName,
      startDate: paymentDate,
      amount: paymentAmount,
      sageJobNumber: input.sageJobShortName,
      now,
    }),
  ]);

  await refreshInvoicePaidStatusStatement(env.DB, {
    invoiceId: ids.invoiceId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    now,
  }).run();

  const invoice = await env.DB.prepare(
    `SELECT status FROM invoices
     WHERE id = ? AND organization_id = ? AND project_id = ?`,
  )
    .bind(ids.invoiceId, input.organizationId, input.projectId)
    .first<{ status: string }>();
  if (!invoice) throw new Error("Compass owner receivable was not stored");

  await setSquareInvoiceOperationStatus(env.DB, {
    status: invoice.status,
    now,
    operationId: ids.invoiceOperationId,
    projectId: input.projectId,
  });

  return ids;
}
