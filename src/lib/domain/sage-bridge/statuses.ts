/*
 * Enumerated values for this domain (architecture standard, section 3).
 * Pure constants with no imports, so the Drizzle schema can type its
 * columns with them.
 */

export const SAGE_LABOR_REQUEST_STATUSES = ["queued", "running", "done", "failed"] as const
export type SageLaborRequestStatus = (typeof SAGE_LABOR_REQUEST_STATUSES)[number]

/** A vendor's certificate sync to Sage: queued again whenever their trade docs change. */
export const SAGE_VENDOR_CERTIFICATE_SYNC_STATUSES = ["queued", "running", "succeeded", "failed"] as const
export type SageVendorCertificateSyncStatus = (typeof SAGE_VENDOR_CERTIFICATE_SYNC_STATUSES)[number]

/** One change order or variance sent to Sage as an approved prime change order. */
export const SAGE_CHANGE_ORDER_EXPORT_STATUSES = ["queued", "running", "succeeded", "failed"] as const
export type SageChangeOrderExportStatus = (typeof SAGE_CHANGE_ORDER_EXPORT_STATUSES)[number]

/**
 * An accepted estimate's sync to Sage (job if missing → proposal → budget
 * when the company sends it). "waiting_for_job" holds until Sage has the job;
 * "needs_attention" is a guard that stopped it until staff fix and retry.
 */
export const SAGE_ESTIMATE_EXPORT_STATUSES = ["queued", "waiting_for_job", "running", "succeeded", "failed", "needs_attention"] as const
export type SageEstimateExportStatus = (typeof SAGE_ESTIMATE_EXPORT_STATUSES)[number]

/**
 * A billed pay request sent to Sage as an AR invoice (ARInvoiceAddRq).
 * "needs_attention" is a guard that stopped it (or Sage's totals read back
 * differently) until staff look; "cancelled" when the billing was taken back
 * before it was sent.
 */
export const SAGE_AR_INVOICE_EXPORT_STATUSES = ["queued", "running", "succeeded", "failed", "needs_attention", "cancelled"] as const
export type SageArInvoiceExportStatus = (typeof SAGE_AR_INVOICE_EXPORT_STATUSES)[number]

/**
 * A staff request to add a vendor, client, or one of their people to Sage.
 * "approved" waits for its company to reach Sage first; "sent" is with the
 * Sage writer.
 */
export const SAGE_DIRECTORY_ADD_STATUSES = ["pending", "approved", "sent", "succeeded", "failed", "rejected", "cancelled"] as const
export type SageDirectoryAddStatus = (typeof SAGE_DIRECTORY_ADD_STATUSES)[number]

export const SAGE_DIRECTORY_ADD_KINDS = ["vendor_company", "client_company", "vendor_person", "client_person"] as const
export type SageDirectoryAddKind = (typeof SAGE_DIRECTORY_ADD_KINDS)[number]

/** A Square webhook event as Compass processed it (./square-machines.ts). */
export const SQUARE_WEBHOOK_EVENT_STATUSES = ["processing", "processed", "failed", "attention"] as const
export type SquareWebhookEventStatus = (typeof SQUARE_WEBHOOK_EVENT_STATUSES)[number]

/** A Square receipt (entered in Sage by staff) or processing fee (posted by the Sage writer). */
export const SQUARE_PAYMENT_OPERATION_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "already_in_sage",
  "manual_action_required",
  "attention",
] as const
export type SquarePaymentOperationStatus = (typeof SQUARE_PAYMENT_OPERATION_STATUSES)[number]
