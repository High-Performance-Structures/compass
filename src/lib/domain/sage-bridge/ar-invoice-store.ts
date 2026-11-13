/**
 * The only writer of sage_ar_invoice_exports, sage_invoice_ar_exports and
 * sage_deposit_ar_exports (architecture standard, section 1): billed pay
 * requests, simple Compass invoices (credit memos among them) and deposit
 * requests queued for Sage as AR invoices. Writes are
 * fenced by status and claim token in the WHERE clause, like the rest of the
 * Sage bridge. No auth here: callers resolve access or verify the bridge
 * signature first.
 */
import { and, eq, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm"
import type { SQLiteColumn } from "drizzle-orm/sqlite-core"

import { sageArInvoiceExports, sageDepositArExports, sageInvoiceArExports } from "@/db/schema-sage"
import { arInvoiceExportMachine, sourcesInto } from "@/lib/domain/sage-bridge/machines"
import { SAGE_AR_INVOICE_EXPORT_STATUSES, type SageArInvoiceExportStatus } from "@/lib/domain/sage-bridge/statuses"
import { assertListFields } from "@/lib/shared/statuses"
import type { Db } from "@/lib/server/action-context"

const LISTS = { status: SAGE_AR_INVOICE_EXPORT_STATUSES }

/**
 * The record behind an export is void. Written as SQL so the check and the
 * write are one statement: a void that lands between a read and a write can't
 * slip a void record through to Sage.
 */
const SOURCE_IS_VOID = {
  pay: sql.raw(`EXISTS (SELECT 1 FROM project_budget_applications src
    WHERE src.id = sage_ar_invoice_exports.application_id AND src.status = 'void')`),
  invoice: sql.raw(`EXISTS (SELECT 1 FROM invoices src
    WHERE src.id = sage_invoice_ar_exports.invoice_id AND src.status = 'void')`),
  deposit: sql.raw(`EXISTS (SELECT 1 FROM project_contract_deposits src
    WHERE src.id = sage_deposit_ar_exports.deposit_id AND src.status = 'void')`),
} as const

export const VOIDED_WHILE_SENDING = "Voided while Sage was adding it; check Sage."

/** The export's record isn't void, for the writer polls' candidate lists (same SQL as the claim's). */
export function sageArExportSourceNotVoid(kind: keyof typeof SOURCE_IS_VOID): SQL {
  return sql`NOT ${SOURCE_IS_VOID[kind]}`
}

/** The AR export tables and the column naming their record. */
const AR_EXPORT_TABLES = {
  pay: { table: "sage_ar_invoice_exports", source: "application_id" },
  invoice: { table: "sage_invoice_ar_exports", source: "invoice_id" },
  deposit: { table: "sage_deposit_ar_exports", source: "deposit_id" },
} as const

/**
 * Sage may have this export's invoice: the writer is running it, finished it,
 * read back Sage's record, or was ever handed its payload. The writer can
 * report "failed" (or "accepted but doesn't read back") for an invoice Sage
 * did take, so anything it ran counts. A row a guard stopped before it was
 * ever sent (no payload) does not.
 */
export const POSSIBLY_IN_SAGE_SQL = "(status IN ('running', 'succeeded') OR sage_record_id IS NOT NULL OR payload_json IS NOT NULL)"

/** Whether Sage may have the invoice of `sourceId`'s export (see POSSIBLY_IN_SAGE_SQL); false with no export. */
export async function arExportPossiblyInSage(
  db: Db,
  input: { readonly kind: keyof typeof AR_EXPORT_TABLES; readonly organizationId: string; readonly sourceId: string }
): Promise<boolean> {
  const { table, source } = AR_EXPORT_TABLES[input.kind]
  const rows = await db.all<{ readonly n: number }>(sql`SELECT count(*) AS n FROM ${sql.identifier(table)}
    WHERE ${sql.identifier(source)} = ${input.sourceId} AND organization_id = ${input.organizationId} AND ${sql.raw(POSSIBLY_IN_SAGE_SQL)}`)
  return Number(rows[0]?.n ?? 0) > 0
}

/**
 * The writer's late result for a claim whose record was voided while it ran
 * (flagged "voided while sending"): Sage's record id is kept for staff, the
 * row stays needs attention, and the claim is used up (its lease token), so
 * the result answers 2xx instead of a 409 that would end the writer's run.
 * True when it was that row.
 */
export async function recordLateResultOnVoided(
  db: Db,
  input: { readonly kind: keyof typeof AR_EXPORT_TABLES; readonly id: string; readonly organizationId: string; readonly claimToken: string; readonly leaseToken: string; readonly sageRecordId: string | null; readonly now: string }
): Promise<boolean> {
  const { table } = AR_EXPORT_TABLES[input.kind]
  const result = await db.run(sql`UPDATE ${sql.identifier(table)}
    SET claim_token = ${input.leaseToken}, sage_record_id = coalesce(${input.sageRecordId}, sage_record_id), updated_at = ${input.now}
    WHERE id = ${input.id} AND organization_id = ${input.organizationId} AND claim_token = ${input.claimToken}
      AND status = 'needs_attention' AND error_message = ${VOIDED_WHILE_SENDING}`)
  return result.meta.changes === 1
}

/**
 * cancel's fence: a source state of the event, and not in Sage. A row the
 * writer added (needs_attention after Sage's total read back differently, say)
 * carries Sage's record id and is never cancelled; it is voided in Sage.
 */
function cancellable(columns: { readonly status: SQLiteColumn; readonly sageRecordId: SQLiteColumn }): SQL | undefined {
  return and(inArray(columns.status, [...arInvoiceExportMachine.transitions.cancel.from]), isNull(columns.sageRecordId))
}

/** The states the machine may move a row from into `status`: every update below is also fenced on them. */
function mayEnter(status: SageArInvoiceExportStatus): SageArInvoiceExportStatus[] {
  return [...sourcesInto(arInvoiceExportMachine, status)]
}

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
        // payload_json stays: it shows the writer was handed this invoice before (it may be in Sage).
        errorMessage: row.errorMessage,
        completedAt: null,
        updatedAt: row.now,
      },
      // queue / flag from a row that isn't running or succeeded.
      setWhere: and(
        eq(sageArInvoiceExports.organizationId, row.organizationId),
        inArray(sageArInvoiceExports.status, [...arInvoiceExportMachine.transitions.queue.from]),
        sql`NOT ${SOURCE_IS_VOID.pay}`
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
      status: arInvoiceExportMachine.transitions.claim.to,
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
        ),
        // A void record is never handed to the writer.
        sql`NOT ${SOURCE_IS_VOID.pay}`
      )
    )
    .returning({ id: sageArInvoiceExports.id })
  if (claimed.length > 0) return true
  // Queued (or failed) for a record voided since, and not in Sage: cancelled, so it stops being offered.
  await db.update(sageArInvoiceExports)
    .set({ status: arInvoiceExportMachine.transitions.cancel.to, claimToken: null, completedAt: input.now, updatedAt: input.now })
    .where(and(
      eq(sageArInvoiceExports.id, input.id),
      eq(sageArInvoiceExports.organizationId, input.organizationId),
      cancellable(sageArInvoiceExports),
      SOURCE_IS_VOID.pay
    ))
  // Running for a record voided since, and stale: never offered again; staff check Sage.
  await db.update(sageArInvoiceExports)
    // The claim token stays, so the writer's late result for it still lands (recordLateResultOnVoided).
    .set({ status: arInvoiceExportMachine.transitions.flag.to, errorMessage: VOIDED_WHILE_SENDING, completedAt: input.now, updatedAt: input.now })
    .where(and(
      eq(sageArInvoiceExports.id, input.id),
      eq(sageArInvoiceExports.organizationId, input.organizationId),
      eq(sageArInvoiceExports.status, "running"),
      lt(sageArInvoiceExports.claimedAt, input.staleBefore),
      SOURCE_IS_VOID.pay
    ))
  return false
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
  return db.update(sageArInvoiceExports).set(patch).where(and(where, inArray(sageArInvoiceExports.status, mayEnter(patch.status))))
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
  const cancelled = await exportUpdate(db, and(forApplication, cancellable(sageArInvoiceExports)), {
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
        // payload_json stays: it shows the writer was handed this invoice before (it may be in Sage).
        errorMessage: row.errorMessage,
        completedAt: null,
        updatedAt: row.now,
      },
      // queue / flag from a row that isn't running or succeeded.
      setWhere: and(
        eq(sageInvoiceArExports.organizationId, row.organizationId),
        inArray(sageInvoiceArExports.status, [...arInvoiceExportMachine.transitions.queue.from]),
        sql`NOT ${SOURCE_IS_VOID.invoice}`
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
      status: arInvoiceExportMachine.transitions.claim.to,
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
        ),
        // A void record is never handed to the writer.
        sql`NOT ${SOURCE_IS_VOID.invoice}`
      )
    )
    .returning({ id: sageInvoiceArExports.id })
  if (claimed.length > 0) return true
  // Queued (or failed) for a record voided since, and not in Sage: cancelled, so it stops being offered.
  await db.update(sageInvoiceArExports)
    .set({ status: arInvoiceExportMachine.transitions.cancel.to, claimToken: null, completedAt: input.now, updatedAt: input.now })
    .where(and(
      eq(sageInvoiceArExports.id, input.id),
      eq(sageInvoiceArExports.organizationId, input.organizationId),
      cancellable(sageInvoiceArExports),
      SOURCE_IS_VOID.invoice
    ))
  // Running for a record voided since, and stale: never offered again; staff check Sage.
  await db.update(sageInvoiceArExports)
    // The claim token stays, so the writer's late result for it still lands (recordLateResultOnVoided).
    .set({ status: arInvoiceExportMachine.transitions.flag.to, errorMessage: VOIDED_WHILE_SENDING, completedAt: input.now, updatedAt: input.now })
    .where(and(
      eq(sageInvoiceArExports.id, input.id),
      eq(sageInvoiceArExports.organizationId, input.organizationId),
      eq(sageInvoiceArExports.status, "running"),
      lt(sageInvoiceArExports.claimedAt, input.staleBefore),
      SOURCE_IS_VOID.invoice
    ))
  return false
}

function invoiceExportUpdate(db: Db, where: SQL | undefined, patch: SageArInvoiceExportPatch) {
  assertListFields("sage_invoice_ar_exports", patch, LISTS)
  return db.update(sageInvoiceArExports).set(patch).where(and(where, inArray(sageInvoiceArExports.status, mayEnter(patch.status))))
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
  const cancelled = await invoiceExportUpdate(db, and(forInvoice, cancellable(sageInvoiceArExports)), {
    status: "cancelled",
    claimToken: null,
    completedAt: input.now,
    updatedAt: input.now,
  }).returning({ id: sageInvoiceArExports.id })
  if (cancelled.length > 0) return true
  const row = await db.select({ id: sageInvoiceArExports.id }).from(sageInvoiceArExports).where(forInvoice).get()
  return !row
}

/**
 * cancel, as an unexecuted statement for the caller's batch: the invoice's
 * export that hasn't reached Sage, only while `when` holds (the caller's own
 * write in the same batch landed).
 */
export function cancelSageInvoiceArExportStatement(
  db: Db,
  input: { readonly organizationId: string; readonly invoiceId: string; readonly now: string; readonly when: SQL }
) {
  return invoiceExportUpdate(db, and(
    eq(sageInvoiceArExports.invoiceId, input.invoiceId),
    eq(sageInvoiceArExports.organizationId, input.organizationId),
    cancellable(sageInvoiceArExports),
    input.when
  ), { status: "cancelled", claimToken: null, completedAt: input.now, updatedAt: input.now })
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
        // payload_json stays: it shows the writer was handed this invoice before (it may be in Sage).
        errorMessage: row.errorMessage,
        completedAt: null,
        updatedAt: row.now,
      },
      // queue / flag from a row that isn't running or succeeded.
      setWhere: and(
        eq(sageDepositArExports.organizationId, row.organizationId),
        inArray(sageDepositArExports.status, [...arInvoiceExportMachine.transitions.queue.from]),
        sql`NOT ${SOURCE_IS_VOID.deposit}`
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
      status: arInvoiceExportMachine.transitions.claim.to,
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
        ),
        // A void record is never handed to the writer.
        sql`NOT ${SOURCE_IS_VOID.deposit}`
      )
    )
    .returning({ id: sageDepositArExports.id })
  if (claimed.length > 0) return true
  // Queued (or failed) for a record voided since, and not in Sage: cancelled, so it stops being offered.
  await db.update(sageDepositArExports)
    .set({ status: arInvoiceExportMachine.transitions.cancel.to, claimToken: null, completedAt: input.now, updatedAt: input.now })
    .where(and(
      eq(sageDepositArExports.id, input.id),
      eq(sageDepositArExports.organizationId, input.organizationId),
      cancellable(sageDepositArExports),
      SOURCE_IS_VOID.deposit
    ))
  // Running for a record voided since, and stale: never offered again; staff check Sage.
  await db.update(sageDepositArExports)
    // The claim token stays, so the writer's late result for it still lands (recordLateResultOnVoided).
    .set({ status: arInvoiceExportMachine.transitions.flag.to, errorMessage: VOIDED_WHILE_SENDING, completedAt: input.now, updatedAt: input.now })
    .where(and(
      eq(sageDepositArExports.id, input.id),
      eq(sageDepositArExports.organizationId, input.organizationId),
      eq(sageDepositArExports.status, "running"),
      lt(sageDepositArExports.claimedAt, input.staleBefore),
      SOURCE_IS_VOID.deposit
    ))
  return false
}

function depositExportUpdate(db: Db, where: SQL | undefined, patch: SageArInvoiceExportPatch) {
  assertListFields("sage_deposit_ar_exports", patch, LISTS)
  return db.update(sageDepositArExports).set(patch).where(and(where, inArray(sageDepositArExports.status, mayEnter(patch.status))))
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
  const cancelled = await depositExportUpdate(db, and(forDeposit, cancellable(sageDepositArExports)), {
    status: "cancelled",
    claimToken: null,
    completedAt: input.now,
    updatedAt: input.now,
  }).returning({ id: sageDepositArExports.id })
  if (cancelled.length > 0) return true
  const row = await db.select({ id: sageDepositArExports.id }).from(sageDepositArExports).where(forDeposit).get()
  return !row
}
