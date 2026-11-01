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
import { and, eq, lt, or, sql, type SQL } from "drizzle-orm"
import type { SQLiteInsertValue, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import {
  sageBridgeRequestNonces,
  sageClientDirectoryRefreshes,
  sageClientProjectWriteOperations,
  sagePayApplicationSyncRuns,
  sageVendorCertificateSyncs,
  sageVendorDirectoryEntries,
} from "@/db/schema-sage"
import { sageLaborRequests } from "@/db/schema-shop-tickets"
import { chunkD1Rows, chunkD1Values } from "@/lib/d1-query"
import type { SageBridgeHeartbeatId } from "@/lib/domain/sage-bridge/rules"
import { SAGE_VENDOR_CERTIFICATE_SYNC_STATUSES, type SageVendorCertificateSyncStatus } from "@/lib/domain/sage-bridge/statuses"
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

function clientProjectWriteUpdate(
  db: Db,
  changes: SQLiteUpdateSetSource<typeof sageClientProjectWriteOperations>,
  where: SQL | undefined
) {
  return db.update(sageClientProjectWriteOperations).set(changes).where(where)
}

/** Unexecuted update fenced by the caller's `where` (claim token, status, stale cutoff). */
export function updateSageClientProjectWriteOperations(
  db: Db,
  changes: SQLiteUpdateSetSource<typeof sageClientProjectWriteOperations>,
  where: SQL | undefined
): ReturnType<typeof clientProjectWriteUpdate> {
  return clientProjectWriteUpdate(db, changes, where)
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

/** Marks a write operation succeeded with the returned Sage identities. */
export function sageClientProjectWriteSucceededStatement(
  database: D1Database,
  input: SageClientProjectWriteSuccess
): D1PreparedStatement {
  return database.prepare(
    `UPDATE sage_client_project_write_operations
       SET status = 'succeeded', sage_client_id = ?, sage_client_number = ?,
           sage_job_id = ?, sage_job_number = ?,
           resolved_client_status_number = ?, resolved_job_status_number = ?,
           resolved_job_type_number = ?, error_message = NULL,
           completed_at = ?, updated_at = ?
       WHERE id = ?`
  ).bind(
    input.clientId,
    input.clientNumber,
    input.jobId,
    input.jobNumber,
    input.clientStatusNumber,
    input.jobStatusNumber,
    input.jobTypeNumber,
    input.now,
    input.now,
    input.operationId
  )
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
  for (const ids of chunkD1Values([...new Set(vendorIds)])) {
    if (ids.length === 0) continue
    await db
      .insert(sageVendorCertificateSyncs)
      .values(ids.map((vendorId) => ({ id: crypto.randomUUID(), organizationId, vendorId, status: "queued" as const, requestedAt: now, updatedAt: now })))
      .onConflictDoUpdate({
        target: sageVendorCertificateSyncs.vendorId,
        set: {
          status: sql`CASE WHEN ${sageVendorCertificateSyncs.status} = 'running' THEN 'running' ELSE 'queued' END`,
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

/** Updates syncs matching the caller's fence (for example id plus claim token). */
export async function updateVendorCertificateSyncs(db: Db, where: SQL | undefined, patch: VendorCertificateSyncPatch): Promise<number> {
  assertListFields("sage_vendor_certificate_syncs", patch, LISTS)
  const rows = await db.update(sageVendorCertificateSyncs).set(patch).where(where).returning({ id: sageVendorCertificateSyncs.id })
  return rows.length
}

// sage_vendor_directory_entries: the read-only copy of Sage's vendor records.

export type SageVendorDirectoryRow = {
  readonly sageRecordId: string
  readonly sageVendorNumber: string
  readonly name: string
  readonly email: string | null
}

/** Replaces the organization's copy of Sage's vendors in one atomic batch. */
export async function replaceSageVendorDirectory(db: Db, organizationId: string, rows: readonly SageVendorDirectoryRow[], now: string): Promise<void> {
  const inserts = chunkD1Rows(rows.map((row) => ({ organizationId, ...row, capturedAt: now }))).map((chunk) =>
    db.insert(sageVendorDirectoryEntries).values(chunk)
  )
  await db.batch([db.delete(sageVendorDirectoryEntries).where(eq(sageVendorDirectoryEntries.organizationId, organizationId)), ...inserts])
}
