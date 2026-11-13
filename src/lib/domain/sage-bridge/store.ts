/**
 * The only code that writes the Sage bridge queue tables: request nonces,
 * bridge heartbeats, client/project write operations, client directory
 * refreshes and entries, pay-application sync runs, and labor-hour requests
 * (architecture standard, section 1). Contact review tables live in
 * contact-store.ts and Square payment operations in square-store.ts.
 *
 * The bridge's correctness rests on fenced writes: claim tokens, statuses
 * and stale-claim cutoffs in the WHERE clause, and atomic D1 batches. The
 * routes that own each lifecycle build those fences and pass them in
 * unchanged; this module owns the write itself. Drizzle builders are returned
 * unexecuted so a caller can add `.returning()` or batch them exactly as
 * before, and raw statements come back bound but not run. No auth here:
 * bridge routes verify the HMAC signature first.
 */
import { and, eq, inArray, lt, or, sql, type SQL } from "drizzle-orm"
import type { SQLiteInsertValue, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import {
  sageBridgeRequestNonces,
  sageClientDirectoryRefreshes,
  sageClientProjectWriteOperations,
  sageEmployeeDirectoryEntries,
  sagePayApplicationSyncRuns,
  sageVendorCertificateSyncs,
  sageVendorDirectoryEntries,
} from "@/db/schema-sage"
import { sageLaborRequests } from "@/db/schema-shop-tickets"
import { chunkD1InsertRows, chunkD1Rows } from "@/lib/d1-query"
import { clientProjectWriteMachine, sourcesInto, vendorCertificateSyncMachine } from "@/lib/domain/sage-bridge/machines"
import type { SageBridgeHeartbeatId } from "@/lib/domain/sage-bridge/rules"
import {
  SAGE_CLIENT_PROJECT_WRITE_STATUSES,
  SAGE_VENDOR_CERTIFICATE_SYNC_STATUSES,
  type SageVendorCertificateSyncStatus,
} from "@/lib/domain/sage-bridge/statuses"
import { assertListFields } from "@/lib/shared/statuses"
import type { Db } from "@/lib/server/action-context"

// ---------------------------------------------------------------------------
// Request nonces and heartbeats
// ---------------------------------------------------------------------------

function nonceInsert(db: Db, values: SQLiteInsertValue<typeof sageBridgeRequestNonces>) {
  return db.insert(sageBridgeRequestNonces).values(values)
}
function nonceDelete(db: Db, where: SQL | undefined) {
  return db.delete(sageBridgeRequestNonces).where(where)
}

/** Unexecuted insert of a consumed request ID; a duplicate ID makes it throw. */
export function insertSageBridgeRequestNonce(
  db: Db,
  values: SQLiteInsertValue<typeof sageBridgeRequestNonces>
): ReturnType<typeof nonceInsert> {
  return nonceInsert(db, values)
}

/** Unexecuted delete of the nonces matching the caller's retention cutoff. */
export function deleteSageBridgeRequestNonces(db: Db, where: SQL | undefined): ReturnType<typeof nonceDelete> {
  return nonceDelete(db, where)
}

/** Records that `bridgeId` made an authenticated request at `now`. */
export function sageBridgeHeartbeatStatement(
  database: D1Database,
  bridgeId: SageBridgeHeartbeatId,
  now: string
): D1PreparedStatement {
  return database.prepare(
    `INSERT INTO sage_bridge_status (id, last_seen_at, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       updated_at = excluded.updated_at`
  ).bind(bridgeId, now, now)
}

// ---------------------------------------------------------------------------
// Client/project write operations
// ---------------------------------------------------------------------------

function clientProjectWriteInsert(db: Db, values: SQLiteInsertValue<typeof sageClientProjectWriteOperations>) {
  return db.insert(sageClientProjectWriteOperations).values(values)
}

/** Unexecuted insert of a queued Sage client/job write, for the caller's batch with the Compass record. */
export function insertSageClientProjectWriteOperation(
  db: Db,
  values: SQLiteInsertValue<typeof sageClientProjectWriteOperations>
): ReturnType<typeof clientProjectWriteInsert> {
  return clientProjectWriteInsert(db, values)
}

const CLIENT_PROJECT_LISTS = { status: SAGE_CLIENT_PROJECT_WRITE_STATUSES }

/** The write is in a state its machine may move into `status` from. */
function clientProjectWriteMayEnter(status: unknown): SQL | undefined {
  if (typeof status !== "string") return undefined
  const to = SAGE_CLIENT_PROJECT_WRITE_STATUSES.find((state) => state === status)
  if (!to) return undefined
  return inArray(sageClientProjectWriteOperations.status, [...sourcesInto(clientProjectWriteMachine, to)])
}

function clientProjectWriteUpdate(
  db: Db,
  changes: SQLiteUpdateSetSource<typeof sageClientProjectWriteOperations>,
  where: SQL | undefined
) {
  assertListFields("sage_client_project_write_operations", changes, CLIENT_PROJECT_LISTS)
  // A status change also lands only from a state the machine allows it from.
  return db.update(sageClientProjectWriteOperations).set(changes).where(and(where, clientProjectWriteMayEnter(changes.status)))
}

/**
 * Unexecuted update fenced by the caller's `where` (claim token, status, stale
 * cutoff) and, when it sets a status, by the machine's source states.
 */
export function updateSageClientProjectWriteOperations(
  db: Db,
  changes: SQLiteUpdateSetSource<typeof sageClientProjectWriteOperations>,
  where: SQL | undefined
): ReturnType<typeof clientProjectWriteUpdate> {
  return clientProjectWriteUpdate(db, changes, where)
}

/** claim: takes one queued (or stale running) write for a writer poll; false when another poll got it first. */
export async function claimSageClientProjectWrite(
  db: Db,
  input: { readonly id: string; readonly claimToken: string; readonly now: string; readonly staleBefore: string }
): Promise<boolean> {
  const claimed = await clientProjectWriteUpdate(
    db,
    {
      status: clientProjectWriteMachine.transitions.claim.to,
      claimToken: input.claimToken,
      claimedAt: input.now,
      attemptCount: sql`${sageClientProjectWriteOperations.attemptCount} + 1`,
      updatedAt: input.now,
    },
    and(
      eq(sageClientProjectWriteOperations.id, input.id),
      or(
        eq(sageClientProjectWriteOperations.status, "queued"),
        and(eq(sageClientProjectWriteOperations.status, "running"), lt(sageClientProjectWriteOperations.claimedAt, input.staleBefore))
      )
    )
  ).returning({ id: sageClientProjectWriteOperations.id })
  return claimed.length > 0
}

/**
 * resend: puts a failed client/job write back in the queue with `payloadJson`,
 * so the Windows writer tries again, under `customerId` (the client it now
 * belongs to). Fenced on the row still being failed, so a Send to Sage while
 * the writer is running (or after it succeeded) changes nothing.
 */
export function requeueFailedSageClientProjectWriteStatement(database: D1Database, input: {
  readonly operationId: string; readonly organizationId: string
  readonly customerId: string | null; readonly payloadJson: string; readonly now: string
}): D1PreparedStatement {
  const { from, to } = clientProjectWriteMachine.transitions.resend
  return database.prepare(
    `UPDATE sage_client_project_write_operations
       SET status = ?, customer_id = ?, payload_json = ?, claim_token = NULL, claimed_at = NULL,
           error_message = NULL, completed_at = NULL, updated_at = ?
       WHERE id = ? AND organization_id = ? AND status IN (${from.map(() => "?").join(", ")})`
  ).bind(to, input.customerId, input.payloadJson, input.now, input.operationId, input.organizationId, ...from)
}

/** The Sage client (and job) the Windows writer created or matched. */
export type SageClientProjectWriteSuccess = {
  readonly operationId: string
  readonly clientId: string
  readonly clientNumber: string
  readonly clientStatusNumber: number
  readonly jobId: string | null
  readonly jobNumber: string | null
  readonly jobStatusNumber: number | null
  readonly jobTypeNumber: number | null
  readonly now: string
}

/**
 * succeed: marks a write succeeded with the returned Sage identities, only
 * while it is still running under `leaseToken` (see takeSageResultLease).
 */
export function sageClientProjectWriteSucceededStatement(
  database: D1Database,
  input: SageClientProjectWriteSuccess & { readonly leaseToken: string }
): D1PreparedStatement {
  const { from, to } = clientProjectWriteMachine.transitions.succeed
  return database.prepare(
    `UPDATE sage_client_project_write_operations
       SET status = ?, sage_client_id = ?, sage_client_number = ?,
           sage_job_id = ?, sage_job_number = ?,
           resolved_client_status_number = ?, resolved_job_status_number = ?,
           resolved_job_type_number = ?, error_message = NULL,
           completed_at = ?, updated_at = ?
       WHERE id = ? AND claim_token = ? AND status IN (${from.map(() => "?").join(", ")})`
  ).bind(
    to,
    input.clientId,
    input.clientNumber,
    input.jobId,
    input.jobNumber,
    input.clientStatusNumber,
    input.jobStatusNumber,
    input.jobTypeNumber,
    input.now,
    input.now,
    input.operationId,
    input.leaseToken,
    ...from
  )
}

/** succeed for an "ensure_vendor" add: records Sage's vendor, only under `leaseToken`. */
export function sageVendorWriteSucceededStatement(
  database: D1Database,
  input: { readonly operationId: string; readonly leaseToken: string; readonly vendorId: string; readonly vendorNumber: string; readonly now: string }
): D1PreparedStatement {
  const { from, to } = clientProjectWriteMachine.transitions.succeed
  return database.prepare(
    `UPDATE sage_client_project_write_operations
       SET status = ?, sage_vendor_id = ?, sage_vendor_number = ?, completed_at = ?, updated_at = ?
       WHERE id = ? AND claim_token = ? AND status IN (${from.map(() => "?").join(", ")})`
  ).bind(to, input.vendorId, input.vendorNumber, input.now, input.now, input.operationId, input.leaseToken, ...from)
}

/** A WHERE fragment true only once the write succeeded under `leaseToken` at `now`, for its follow-ups in the same batch. */
export function sageWriteSucceededUnderLease(input: { readonly operationId: string; readonly leaseToken: string; readonly now: string }): {
  readonly sql: string; readonly binds: readonly string[]
} {
  return {
    sql: "EXISTS (SELECT 1 FROM sage_client_project_write_operations WHERE id = ? AND claim_token = ? AND status = 'succeeded' AND completed_at = ?)",
    binds: [input.operationId, input.leaseToken, input.now],
  }
}

// ---------------------------------------------------------------------------
// Result leases: one result handler per claim
// ---------------------------------------------------------------------------

/** The writer queues whose results are applied under a lease. */
export type SageResultLeaseTable =
  | "sage_client_project_write_operations"
  | "sage_change_order_exports"
  | "sage_estimate_exports"
  | "sage_ar_invoice_exports"
  | "sage_invoice_ar_exports"
  | "sage_deposit_ar_exports"

/**
 * The lease a result for `claimToken` takes. Derived from the claim, not
 * random, so once the result has landed an exact repeat of it can still be
 * recognised (sageResultAlreadyRecorded) after the row's token changed.
 */
export function sageResultLeaseToken(claimToken: string): string {
  return `${claimToken}:result`
}

/**
 * Before a writer result is applied, swaps the claim token it carries for
 * its lease, while the row is still running under that claim. Only one
 * handler can win, so a result the writer posts twice (an HTTP retry, two
 * PCs) applies its side effects once. Returns the lease token the handler's
 * writes then fence on, or null when the claim no longer holds.
 */
export async function takeSageResultLease(
  db: Db,
  table: SageResultLeaseTable,
  input: { readonly id: string; readonly organizationId: string; readonly claimToken: string; readonly now: string }
): Promise<string | null> {
  const leaseToken = sageResultLeaseToken(input.claimToken)
  // claimed_at moves to now, so a poll can't take the claim over as stale while this result is applied.
  const result = await db.run(sql`UPDATE ${sql.identifier(table)} SET claim_token = ${leaseToken}, claimed_at = ${input.now}
    WHERE id = ${input.id} AND organization_id = ${input.organizationId}
      AND status = 'running' AND claim_token = ${input.claimToken}`)
  return result.meta.changes === 1 ? leaseToken : null
}

/** Hands a lease back to the writer's claim when applying the result threw, so the writer's retry can land. */
export async function releaseSageResultLease(
  db: Db,
  table: SageResultLeaseTable,
  input: { readonly id: string; readonly claimToken: string }
): Promise<void> {
  await db.run(sql`UPDATE ${sql.identifier(table)} SET claim_token = ${input.claimToken}
    WHERE id = ${input.id} AND status = 'running' AND claim_token = ${sageResultLeaseToken(input.claimToken)}`)
}

/**
 * Whether this claim's result already landed with one of `statuses` (the
 * ones its outcome can produce). The writer stops its whole run on any
 * non-2xx answer, so an exact repeat of a recorded result is answered as
 * recorded rather than 409; a superseded claim still gets 409.
 */
export async function sageResultAlreadyRecorded(
  db: Db,
  table: SageResultLeaseTable,
  /** `organizationId` null for a bridge that isn't scoped to one company (the client/job writer). */
  input: {
    readonly id: string; readonly organizationId: string | null; readonly claimToken: string; readonly statuses: readonly string[]
    /** Tables that record Sage's id: the id the repeat reports (null: none yet). Omitted: not compared. */
    readonly sageRecordId?: string | null
  }
): Promise<string | null> {
  if (input.statuses.length === 0) return null
  const company = input.organizationId === null ? sql`` : sql` AND organization_id = ${input.organizationId}`
  const record = input.sageRecordId === undefined ? sql``
    : input.sageRecordId === null ? sql` AND sage_record_id IS NULL` : sql` AND sage_record_id = ${input.sageRecordId}`
  const rows = await db.all<{ readonly status: string }>(sql`SELECT status FROM ${sql.identifier(table)}
    WHERE id = ${input.id}${company}
      AND claim_token = ${sageResultLeaseToken(input.claimToken)}
      AND status IN (${sql.join(input.statuses.map((status) => sql`${status}`), sql`, `)})${record}`)
  return rows[0]?.status ?? null
}

// ---------------------------------------------------------------------------
// Client directory refreshes and entries
// ---------------------------------------------------------------------------

function directoryRefreshInsert(db: Db, values: SQLiteInsertValue<typeof sageClientDirectoryRefreshes>) {
  return db.insert(sageClientDirectoryRefreshes).values(values)
}
function directoryRefreshUpdate(
  db: Db,
  changes: SQLiteUpdateSetSource<typeof sageClientDirectoryRefreshes>,
  where: SQL | undefined
) {
  return db.update(sageClientDirectoryRefreshes).set(changes).where(where)
}

/** Unexecuted insert; the partial unique index rejects a second active refresh. */
export function insertSageClientDirectoryRefresh(
  db: Db,
  values: SQLiteInsertValue<typeof sageClientDirectoryRefreshes>
): ReturnType<typeof directoryRefreshInsert> {
  return directoryRefreshInsert(db, values)
}

/** Unexecuted update fenced by the caller's `where` (organization, status, claim token). */
export function updateSageClientDirectoryRefreshes(
  db: Db,
  changes: SQLiteUpdateSetSource<typeof sageClientDirectoryRefreshes>,
  where: SQL | undefined
): ReturnType<typeof directoryRefreshUpdate> {
  return directoryRefreshUpdate(db, changes, where)
}

/** The claim a directory result must still hold for its snapshot to apply. */
export type SageClientDirectoryClaim = {
  readonly refreshId: string
  readonly organizationId: string
  readonly claimToken: string
  readonly now: string
}

/**
 * Replaces the organization's directory snapshot and completes the refresh,
 * as one batch: delete, one insert per JSON chunk of entries, then the status
 * update (last, so its change count tells whether the claim still held).
 * Every statement re-checks the running claim.
 */
export function sageClientDirectoryReplaceStatements(
  database: D1Database,
  claim: SageClientDirectoryClaim,
  entryChunksJson: readonly string[]
): D1PreparedStatement[] {
  const inserts = entryChunksJson.map((chunkJson) =>
    database.prepare(`INSERT INTO sage_client_directory_entries
      (organization_id, sage_record_id, sage_client_number, name, email, captured_at)
      SELECT ?, json_extract(value, '$.sageRecordId'), json_extract(value, '$.sageClientNumber'),
        json_extract(value, '$.name'), json_extract(value, '$.email'), ? FROM json_each(?)
      WHERE EXISTS (SELECT 1 FROM sage_client_directory_refreshes WHERE id = ? AND organization_id = ?
        AND status = 'running' AND claim_token = ?)`)
      .bind(claim.organizationId, claim.now, chunkJson, claim.refreshId, claim.organizationId, claim.claimToken))
  return [
    database.prepare(`DELETE FROM sage_client_directory_entries WHERE organization_id = ?
      AND EXISTS (SELECT 1 FROM sage_client_directory_refreshes WHERE id = ? AND organization_id = ?
        AND status = 'running' AND claim_token = ?)`)
      .bind(claim.organizationId, claim.refreshId, claim.organizationId, claim.claimToken),
    ...inserts,
    database.prepare(`UPDATE sage_client_directory_refreshes SET status = 'succeeded', completed_at = ?, error_message = NULL
      WHERE id = ? AND organization_id = ? AND status = 'running' AND claim_token = ?`)
      .bind(claim.now, claim.refreshId, claim.organizationId, claim.claimToken),
  ]
}

// ---------------------------------------------------------------------------
// Pay-application sync runs
// ---------------------------------------------------------------------------

function payApplicationRunInsert(db: Db, values: SQLiteInsertValue<typeof sagePayApplicationSyncRuns>) {
  return db.insert(sagePayApplicationSyncRuns).values(values)
}
function payApplicationRunUpdate(
  db: Db,
  changes: SQLiteUpdateSetSource<typeof sagePayApplicationSyncRuns>,
  where: SQL | undefined
) {
  return db.update(sagePayApplicationSyncRuns).set(changes).where(where)
}

/** Unexecuted insert; the partial unique index rejects a second active run. */
export function insertSagePayApplicationSyncRun(
  db: Db,
  values: SQLiteInsertValue<typeof sagePayApplicationSyncRuns>
): ReturnType<typeof payApplicationRunInsert> {
  return payApplicationRunInsert(db, values)
}

/** Unexecuted update fenced by the caller's `where` (claim token, status, stale cutoff). */
export function updateSagePayApplicationSyncRuns(
  db: Db,
  changes: SQLiteUpdateSetSource<typeof sagePayApplicationSyncRuns>,
  where: SQL | undefined
): ReturnType<typeof payApplicationRunUpdate> {
  return payApplicationRunUpdate(db, changes, where)
}

/** Moves a still-claimed `running` run to `processing` for ingestion. */
export function acquireSagePayApplicationRunStatement(
  database: D1Database,
  input: { readonly runId: string; readonly claimToken: string; readonly claimedAt: string; readonly now: string }
): D1PreparedStatement {
  return database.prepare(
    `UPDATE sage_pay_application_sync_runs
     SET status = 'processing', claimed_at = ?, updated_at = ?
     WHERE id = ? AND status = 'running'
       AND claim_token = ? AND claimed_at = ?`
  ).bind(input.now, input.now, input.runId, input.claimToken, input.claimedAt)
}

/** The outcome recorded on a pay-application run that ingested a snapshot. */
export type SagePayApplicationRunOutcome = {
  readonly runId: string
  readonly projectId: string
  readonly claimToken: string
  readonly status: "completed" | "needs_review"
  readonly snapshotId: string
  readonly sourceApplicationId: string
  readonly sourceRevision: string
  readonly sourceHash: string
  readonly reconciliationJson: string
  readonly errorMessage: string | null
  readonly capturedAt: string
  readonly now: string
}

/** Finishes a `processing` run that still holds the claim. */
export function sagePayApplicationTerminalRunStatement(
  database: D1Database,
  input: SagePayApplicationRunOutcome
): D1PreparedStatement {
  return database.prepare(
    `UPDATE sage_pay_application_sync_runs
     SET status = ?, snapshot_id = ?, source_application_id = ?,
         source_revision = ?, source_hash = ?, reconciliation_json = ?,
         error_message = ?, captured_at = ?, completed_at = ?,
         updated_at = ?
     WHERE id = ? AND project_id = ?
       AND status = 'processing' AND claim_token = ?`
  ).bind(
    input.status,
    input.snapshotId,
    input.sourceApplicationId,
    input.sourceRevision,
    input.sourceHash,
    input.reconciliationJson,
    input.errorMessage,
    input.capturedAt,
    input.now,
    input.now,
    input.runId,
    input.projectId,
    input.claimToken
  )
}

// ---------------------------------------------------------------------------
// Labor-hour requests
// ---------------------------------------------------------------------------

function laborRequestInsert(db: Db, values: SQLiteInsertValue<typeof sageLaborRequests>) {
  return db.insert(sageLaborRequests).values(values)
}

/** Unexecuted insert of a queued labor-hour read request. */
export function insertSageLaborRequest(
  db: Db,
  values: SQLiteInsertValue<typeof sageLaborRequests>
): ReturnType<typeof laborRequestInsert> {
  return laborRequestInsert(db, values)
}

function laborRequestUpdate(db: Db, changes: SQLiteUpdateSetSource<typeof sageLaborRequests>, where: SQL | undefined) {
  return db.update(sageLaborRequests).set(changes).where(where)
}

/** Unexecuted update fenced by the caller's `where` (claim token, status, stale cutoff). */
export function updateSageLaborRequests(
  db: Db,
  changes: SQLiteUpdateSetSource<typeof sageLaborRequests>,
  where: SQL | undefined
): ReturnType<typeof laborRequestUpdate> {
  return laborRequestUpdate(db, changes, where)
}

// sage_vendor_certificate_syncs: one sync row per vendor (Sage vendor certificates).

const LISTS = { status: SAGE_VENDOR_CERTIFICATE_SYNC_STATUSES }

/**
 * Queues each vendor's sync. A sync already claimed by the writer keeps
 * running; its newer requested time sends it round again when it reports.
 */
export async function queueVendorCertificateSyncs(db: Db, organizationId: string, vendorIds: readonly string[], now: string): Promise<void> {
  const rows = [...new Set(vendorIds)].map((vendorId) => ({ id: crypto.randomUUID(), organizationId, vendorId, status: "queued" as const, requestedAt: now, updatedAt: now }))
  // Each row binds one parameter per column, so chunk by row width, not by vendor count.
  for (const chunk of chunkD1InsertRows(sageVendorCertificateSyncs, rows, 2)) {
    await db
      .insert(sageVendorCertificateSyncs)
      .values(chunk)
      .onConflictDoUpdate({
        target: sageVendorCertificateSyncs.vendorId,
        set: {
          // queue moves only from its source states; a running sync stays running.
          status: sql`CASE WHEN ${inArray(sageVendorCertificateSyncs.status, [...vendorCertificateSyncMachine.transitions.queue.from])} THEN ${vendorCertificateSyncMachine.transitions.queue.to} ELSE ${sageVendorCertificateSyncs.status} END`,
          requestedAt: now,
          updatedAt: now,
        },
      })
  }
}

/** Claims one queued (or stale running) sync for the writer; false when another poll got it first. */
export async function claimVendorCertificateSync(db: Db, id: string, claimToken: string, now: string, staleBefore: string): Promise<boolean> {
  const claimed = await db
    .update(sageVendorCertificateSyncs)
    .set({ status: "running", claimToken, claimedAt: now, attemptCount: sql`${sageVendorCertificateSyncs.attemptCount} + 1`, updatedAt: now })
    .where(
      and(
        eq(sageVendorCertificateSyncs.id, id),
        or(
          eq(sageVendorCertificateSyncs.status, "queued"),
          and(eq(sageVendorCertificateSyncs.status, "running"), lt(sageVendorCertificateSyncs.claimedAt, staleBefore))
        )
      )
    )
    .returning({ id: sageVendorCertificateSyncs.id })
  return claimed.length > 0
}

export type VendorCertificateSyncPatch = {
  readonly status: SageVendorCertificateSyncStatus
  readonly payloadJson?: string | null
  readonly resultJson?: string | null
  readonly errorMessage?: string | null
  readonly completedAt?: string | null
  readonly updatedAt: string
}

/**
 * Updates syncs matching the caller's fence (for example id plus claim
 * token), only from a state the machine may move into `patch.status` from.
 */
export async function updateVendorCertificateSyncs(db: Db, where: SQL | undefined, patch: VendorCertificateSyncPatch): Promise<number> {
  assertListFields("sage_vendor_certificate_syncs", patch, LISTS)
  const rows = await db.update(sageVendorCertificateSyncs).set(patch)
    .where(and(where, inArray(sageVendorCertificateSyncs.status, [...sourcesInto(vendorCertificateSyncMachine, patch.status)])))
    .returning({ id: sageVendorCertificateSyncs.id })
  return rows.length
}

/**
 * succeed / fail, or requeue_changed: finishes a running sync the writer
 * reported under `claimToken`, in one write. Trade docs that changed while
 * the writer worked (requested after the claim) send it round again, decided
 * in the same statement so a change landing meanwhile is never lost and the
 * result always lands. Returns the rows written (0: the claim no longer holds).
 */
export async function finishVendorCertificateSync(
  db: Db,
  input: {
    readonly id: string
    readonly claimToken: string
    readonly outcome: "succeeded" | "failed"
    readonly patch: Omit<VendorCertificateSyncPatch, "status">
  }
): Promise<number> {
  const { requeue_changed: requeue, succeed, fail } = vendorCertificateSyncMachine.transitions
  const finished = input.outcome === "succeeded" ? succeed : fail
  const changedSince = sql`${sageVendorCertificateSyncs.requestedAt} > coalesce(${sageVendorCertificateSyncs.claimedAt}, ${sageVendorCertificateSyncs.requestedAt})`
  const rows = await db.update(sageVendorCertificateSyncs)
    .set({ ...input.patch, status: sql`CASE WHEN ${changedSince} THEN ${requeue.to} ELSE ${finished.to} END` })
    .where(and(
      eq(sageVendorCertificateSyncs.id, input.id),
      eq(sageVendorCertificateSyncs.claimToken, input.claimToken),
      inArray(sageVendorCertificateSyncs.status, [...new Set([...requeue.from, ...finished.from])])
    ))
    .returning({ id: sageVendorCertificateSyncs.id })
  return rows.length
}

// sage_vendor_directory_entries: the read-only copy of Sage's vendor records.

/** What Sage holds for a vendor beyond its name, from writers new enough to read it. */
export type SageVendorDirectoryDetails = {
  readonly ownerName: string | null
  readonly addressLine1: string | null
  readonly addressLine2: string | null
  readonly city: string | null
  readonly state: string | null
  readonly postalCode: string | null
  readonly phone: string | null
  readonly vendorType: string | null
}

const NO_SAGE_VENDOR_DETAILS: SageVendorDirectoryDetails = {
  ownerName: null, addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, phone: null, vendorType: null,
}

export type SageVendorDirectoryRow = {
  readonly sageRecordId: string
  readonly sageVendorNumber: string
  readonly name: string
  readonly email: string | null
  readonly details: SageVendorDirectoryDetails | null
}

/** Replaces the organization's copy of Sage's vendors in one atomic batch. */
export async function replaceSageVendorDirectory(db: Db, organizationId: string, rows: readonly SageVendorDirectoryRow[], now: string): Promise<void> {
  // Every row carries every column so the chunk size counts them all.
  const values = rows.map(({ details, ...row }) => ({
    organizationId, ...row, ...(details ?? NO_SAGE_VENDOR_DETAILS), detailsReceived: details !== null, capturedAt: now,
  }))
  const inserts = chunkD1Rows(values).map((chunk) =>
    db.insert(sageVendorDirectoryEntries).values(chunk)
  )
  await db.batch([db.delete(sageVendorDirectoryEntries).where(eq(sageVendorDirectoryEntries.organizationId, organizationId)), ...inserts])
}

export type SageEmployeeDirectoryRow = {
  /** Lower case, as Compass stores Sage GUIDs. */
  readonly sageRecordId: string
  readonly sageEmployeeNumber: string
  readonly firstName: string | null
  readonly lastName: string | null
  /** Trimmed and lower case. */
  readonly email: string | null
  readonly sageStatusCode: number | null
  readonly inactive: boolean
}

/** Replaces the organization's copy of Sage's employees in one atomic batch. */
export async function replaceSageEmployeeDirectory(db: Db, organizationId: string, rows: readonly SageEmployeeDirectoryRow[], now: string): Promise<void> {
  const values = rows.map((row) => ({ organizationId, ...row, capturedAt: now }))
  const inserts = chunkD1Rows(values).map((chunk) => db.insert(sageEmployeeDirectoryEntries).values(chunk))
  await db.batch([db.delete(sageEmployeeDirectoryEntries).where(eq(sageEmployeeDirectoryEntries.organizationId, organizationId)), ...inserts])
}
