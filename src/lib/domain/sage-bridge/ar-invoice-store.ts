/**
 * The only writer of sage_ar_invoice_exports, sage_invoice_ar_exports and
 * sage_deposit_ar_exports (architecture standard, section 1): billed pay
 * requests, simple Compass invoices (credit memos among them) and deposit
 * requests queued for Sage as AR invoices. Writes are
 * fenced by status and claim token in the WHERE clause, like the rest of the
 * Sage bridge. No auth here: callers resolve access or verify the bridge
 * signature first.
 */
import { and, eq, inArray, lt, ne, or, sql, type SQL } from "drizzle-orm"

import { sageArInvoiceExports, sageDepositArExports, sageInvoiceArExports } from "@/db/schema-sage"
import { SAGE_AR_INVOICE_EXPORT_STATUSES, type SageArInvoiceExportStatus } from "@/lib/domain/sage-bridge/statuses"
import { assertListFields } from "@/lib/shared/statuses"
import type { Db } from "@/lib/server/action-context"

const LISTS = { status: SAGE_AR_INVOICE_EXPORT_STATUSES }

export type SageArInvoiceExportRequest = {
  readonly organizationId: string
  readonly projectId: string
  readonly applicationId: string
  readonly status: Extract<SageArInvoiceExportStatus, "queued" | "needs_attention">
  readonly invoiceNumber: string
  readonly requestedByUserId: string | null
  readonly automatic: boolean
  readonly errorMessage: string | null
  readonly now: string
}

/**
 * Queues (or flags) a pay request's AR invoice: a new row, or the pay
 * request's row sent round again. A row the writer is running, or that already
 * succeeded, is left alone; returns whether the row was written.
 */
export async function upsertSageArInvoiceExport(db: Db, row: SageArInvoiceExportRequest): Promise<boolean> {
  const values = {
    id: crypto.randomUUID(),
    organizationId: row.organizationId,
    projectId: row.projectId,
    applicationId: row.applicationId,
    status: row.status,
    invoiceNumber: row.invoiceNumber,
    requestedByUserId: row.requestedByUserId,
    automatic: row.automatic,
    requestedAt: row.now,
    errorMessage: row.errorMessage,
    updatedAt: row.now,
  }
  assertListFields("sage_ar_invoice_exports", values, LISTS)
  const written = await db
    .insert(sageArInvoiceExports)
    .values(values)
    .onConflictDoUpdate({
      target: sageArInvoiceExports.applicationId,
      set: {
        status: row.status,
        invoiceNumber: row.invoiceNumber,
        requestedByUserId: row.requestedByUserId,
        automatic: row.automatic,
        requestedAt: row.now,
        claimToken: null,
        claimedAt: null,
        payloadJson: null,
        errorMessage: row.errorMessage,
        completedAt: null,
        updatedAt: row.now,
      },
      setWhere: and(
        eq(sageArInvoiceExports.organizationId, row.organizationId),
        ne(sageArInvoiceExports.status, "running"),
        ne(sageArInvoiceExports.status, "succeeded")
      ),
    })
    .returning({ id: sageArInvoiceExports.id })
  return written.length > 0
}

/** Claims one queued (or stale running) export for the writer; false when another poll got it first. */
export async function claimSageArInvoiceExport(
  db: Db,
  input: { readonly id: string; readonly organizationId: string; readonly claimToken: string; readonly now: string; readonly staleBefore: string }
): Promise<boolean> {
  const claimed = await db
    .update(sageArInvoiceExports)
    .set({
      status: "running",
      claimToken: input.claimToken,
      claimedAt: input.now,
      attemptCount: sql`${sageArInvoiceExports.attemptCount} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(sageArInvoiceExports.id, input.id),
        eq(sageArInvoiceExports.organizationId, input.organizationId),
        or(
          eq(sageArInvoiceExports.status, "queued"),
          and(eq(sageArInvoiceExports.status, "running"), lt(sageArInvoiceExports.claimedAt, input.staleBefore))
        )
      )
    )
    .returning({ id: sageArInvoiceExports.id })
  return claimed.length > 0
}

export type SageArInvoiceExportPatch = {
  readonly status: SageArInvoiceExportStatus
  readonly payloadJson?: string | null
  readonly claimToken?: string | null
  readonly sageRecordId?: string | null
  readonly sageTotalCents?: number | null
  readonly errorMessage?: string | null
  readonly completedAt?: string | null
  readonly updatedAt: string
}

function exportUpdate(db: Db, where: SQL | undefined, patch: SageArInvoiceExportPatch) {
  assertListFields("sage_ar_invoice_exports", patch, LISTS)
  return db.update(sageArInvoiceExports).set(patch).where(where)
}

/** Unexecuted update fenced by the caller's `where` (id plus claim token), for a batch. */
export function updateSageArInvoiceExportsStatement(
  db: Db,
  where: SQL | undefined,
  patch: SageArInvoiceExportPatch
): ReturnType<typeof exportUpdate> {
  return exportUpdate(db, where, patch)
}

/**
 * Cancels a pay request's export that hasn't reached Sage (billing taken
 * back). Returns false when the writer is running it or it already succeeded.
 */
export async function cancelSageArInvoiceExport(
  db: Db,
  input: { readonly organizationId: string; readonly applicationId: string; readonly now: string }
): Promise<boolean> {
  const forApplication = and(
    eq(sageArInvoiceExports.applicationId, input.applicationId),
    eq(sageArInvoiceExports.organizationId, input.organizationId)
  )
  // Fenced on the status, so a claim that lands first wins and this reports it.
  const cancelled = await exportUpdate(db, and(forApplication, inArray(sageArInvoiceExports.status, ["queued", "failed", "needs_attention", "cancelled"])), {
    status: "cancelled",
    claimToken: null,
    completedAt: input.now,
    updatedAt: input.now,
  }).returning({ id: sageArInvoiceExports.id })
  if (cancelled.length > 0) return true
  const row = await db.select({ id: sageArInvoiceExports.id }).from(sageArInvoiceExports).where(forApplication).get()
  return !row
}

// ---------------------------------------------------------------------------
// Simple Compass invoices (sage_invoice_ar_exports): the same lifecycle,
// keyed by the invoice.
// ---------------------------------------------------------------------------

export type SageInvoiceArExportRequest = {
  readonly organizationId: string
  readonly projectId: string
  readonly invoiceId: string
  readonly status: Extract<SageArInvoiceExportStatus, "queued" | "needs_attention">
  readonly invoiceNumber: string
  readonly requestedByUserId: string | null
  readonly errorMessage: string | null
  readonly now: string
}

/** Queues (or flags) an invoice's export; a running or succeeded row is left alone. Returns whether it was written. */
export async function upsertSageInvoiceArExport(db: Db, row: SageInvoiceArExportRequest): Promise<boolean> {
  const values = {
    id: crypto.randomUUID(),
    organizationId: row.organizationId,
    projectId: row.projectId,
    invoiceId: row.invoiceId,
    status: row.status,
    invoiceNumber: row.invoiceNumber,
    requestedByUserId: row.requestedByUserId,
    requestedAt: row.now,
    errorMessage: row.errorMessage,
    updatedAt: row.now,
  }
  assertListFields("sage_invoice_ar_exports", values, LISTS)
  const written = await db
    .insert(sageInvoiceArExports)
    .values(values)
    .onConflictDoUpdate({
      target: sageInvoiceArExports.invoiceId,
      set: {
        status: row.status,
        invoiceNumber: row.invoiceNumber,
        requestedByUserId: row.requestedByUserId,
        requestedAt: row.now,
        claimToken: null,
        claimedAt: null,
        payloadJson: null,
        errorMessage: row.errorMessage,
        completedAt: null,
        updatedAt: row.now,
      },
      setWhere: and(
        eq(sageInvoiceArExports.organizationId, row.organizationId),
        ne(sageInvoiceArExports.status, "running"),
        ne(sageInvoiceArExports.status, "succeeded")
      ),
    })
    .returning({ id: sageInvoiceArExports.id })
  return written.length > 0
}

/** Claims one queued (or stale running) invoice export for the writer. */
export async function claimSageInvoiceArExport(
  db: Db,
  input: { readonly id: string; readonly organizationId: string; readonly claimToken: string; readonly now: string; readonly staleBefore: string }
): Promise<boolean> {
  const claimed = await db
    .update(sageInvoiceArExports)
    .set({
      status: "running",
      claimToken: input.claimToken,
      claimedAt: input.now,
      attemptCount: sql`${sageInvoiceArExports.attemptCount} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(sageInvoiceArExports.id, input.id),
        eq(sageInvoiceArExports.organizationId, input.organizationId),
        or(
          eq(sageInvoiceArExports.status, "queued"),
          and(eq(sageInvoiceArExports.status, "running"), lt(sageInvoiceArExports.claimedAt, input.staleBefore))
        )
      )
    )
    .returning({ id: sageInvoiceArExports.id })
  return claimed.length > 0
}

function invoiceExportUpdate(db: Db, where: SQL | undefined, patch: SageArInvoiceExportPatch) {
  assertListFields("sage_invoice_ar_exports", patch, LISTS)
  return db.update(sageInvoiceArExports).set(patch).where(where)
}

/** Unexecuted update fenced by the caller's `where`, for a batch. */
export function updateSageInvoiceArExportsStatement(
  db: Db,
  where: SQL | undefined,
  patch: SageArInvoiceExportPatch
): ReturnType<typeof invoiceExportUpdate> {
  return invoiceExportUpdate(db, where, patch)
}

/**
 * Cancels an invoice's export that hasn't reached Sage (invoice reopened or
 * voided). Returns false when the writer is running it or it already succeeded.
 */
export async function cancelSageInvoiceArExport(
  db: Db,
  input: { readonly organizationId: string; readonly invoiceId: string; readonly now: string }
): Promise<boolean> {
  const forInvoice = and(eq(sageInvoiceArExports.invoiceId, input.invoiceId), eq(sageInvoiceArExports.organizationId, input.organizationId))
  const cancelled = await invoiceExportUpdate(db, and(forInvoice, inArray(sageInvoiceArExports.status, ["queued", "failed", "needs_attention", "cancelled"])), {
    status: "cancelled",
    claimToken: null,
    completedAt: input.now,
    updatedAt: input.now,
  }).returning({ id: sageInvoiceArExports.id })
  if (cancelled.length > 0) return true
  const row = await db.select({ id: sageInvoiceArExports.id }).from(sageInvoiceArExports).where(forInvoice).get()
  return !row
}

// ---------------------------------------------------------------------------
// Deposit requests (sage_deposit_ar_exports): the same lifecycle, keyed by
// the deposit.
// ---------------------------------------------------------------------------

export type SageDepositArExportRequest = {
  readonly organizationId: string
  readonly projectId: string
  readonly depositId: string
  readonly status: Extract<SageArInvoiceExportStatus, "queued" | "needs_attention">
  readonly invoiceNumber: string
  readonly requestedByUserId: string | null
  readonly errorMessage: string | null
  readonly now: string
}

/** Queues (or flags) a deposit request's export; a running or succeeded row is left alone. Returns whether it was written. */
export async function upsertSageDepositArExport(db: Db, row: SageDepositArExportRequest): Promise<boolean> {
  const values = {
    id: crypto.randomUUID(),
    organizationId: row.organizationId,
    projectId: row.projectId,
    depositId: row.depositId,
    status: row.status,
    invoiceNumber: row.invoiceNumber,
    requestedByUserId: row.requestedByUserId,
    requestedAt: row.now,
    errorMessage: row.errorMessage,
    updatedAt: row.now,
  }
  assertListFields("sage_deposit_ar_exports", values, LISTS)
  const written = await db
    .insert(sageDepositArExports)
    .values(values)
    .onConflictDoUpdate({
      target: sageDepositArExports.depositId,
      set: {
        status: row.status,
        invoiceNumber: row.invoiceNumber,
        requestedByUserId: row.requestedByUserId,
        requestedAt: row.now,
        claimToken: null,
        claimedAt: null,
        payloadJson: null,
        errorMessage: row.errorMessage,
        completedAt: null,
        updatedAt: row.now,
      },
      setWhere: and(
        eq(sageDepositArExports.organizationId, row.organizationId),
        ne(sageDepositArExports.status, "running"),
        ne(sageDepositArExports.status, "succeeded")
      ),
    })
    .returning({ id: sageDepositArExports.id })
  return written.length > 0
}

/** Claims one queued (or stale running) deposit export for the writer. */
export async function claimSageDepositArExport(
  db: Db,
  input: { readonly id: string; readonly organizationId: string; readonly claimToken: string; readonly now: string; readonly staleBefore: string }
): Promise<boolean> {
  const claimed = await db
    .update(sageDepositArExports)
    .set({
      status: "running",
      claimToken: input.claimToken,
      claimedAt: input.now,
      attemptCount: sql`${sageDepositArExports.attemptCount} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(sageDepositArExports.id, input.id),
        eq(sageDepositArExports.organizationId, input.organizationId),
        or(
          eq(sageDepositArExports.status, "queued"),
          and(eq(sageDepositArExports.status, "running"), lt(sageDepositArExports.claimedAt, input.staleBefore))
        )
      )
    )
    .returning({ id: sageDepositArExports.id })
  return claimed.length > 0
}

function depositExportUpdate(db: Db, where: SQL | undefined, patch: SageArInvoiceExportPatch) {
  assertListFields("sage_deposit_ar_exports", patch, LISTS)
  return db.update(sageDepositArExports).set(patch).where(where)
}

/** Unexecuted update fenced by the caller's `where`, for a batch. */
export function updateSageDepositArExportsStatement(
  db: Db,
  where: SQL | undefined,
  patch: SageArInvoiceExportPatch
): ReturnType<typeof depositExportUpdate> {
  return depositExportUpdate(db, where, patch)
}

/**
 * Cancels a deposit's export that hasn't reached Sage (deposit voided).
 * Returns false when the writer is running it or it already succeeded.
 */
export async function cancelSageDepositArExport(
  db: Db,
  input: { readonly organizationId: string; readonly depositId: string; readonly now: string }
): Promise<boolean> {
  const forDeposit = and(eq(sageDepositArExports.depositId, input.depositId), eq(sageDepositArExports.organizationId, input.organizationId))
  const cancelled = await depositExportUpdate(db, and(forDeposit, inArray(sageDepositArExports.status, ["queued", "failed", "needs_attention", "cancelled"])), {
    status: "cancelled",
    claimToken: null,
    completedAt: input.now,
    updatedAt: input.now,
  }).returning({ id: sageDepositArExports.id })
  if (cancelled.length > 0) return true
  const row = await db.select({ id: sageDepositArExports.id }).from(sageDepositArExports).where(forDeposit).get()
  return !row
}
