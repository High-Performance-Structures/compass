/**
 * The only code that writes the Sage contact review tables: read requests,
 * snapshots, change and create proposals, and their link/change/create
 * audit events (architecture standard, section 1).
 *
 * Every write here is fenced: claim tokens, statuses and reviewer stamps in
 * the WHERE clause, and audit rows inserted with `INSERT … SELECT` so they
 * exist only if the fenced update landed. Callers keep the batch order and
 * the change-count checks that decide the response. Drizzle builders come
 * back unexecuted (chain `.returning()` / `.onConflict…()` or batch them);
 * raw statements come back bound but not run. No auth here.
 */
import type { SQL } from "drizzle-orm"
import type { SQLiteInsertValue, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import {
  sageContactChangeEvents,
  sageContactChangeProposals,
  sageContactCreateEvents,
  sageContactCreateProposals,
  sageContactLinkEvents,
  sageContactReadRequests,
  sageContactSnapshots,
} from "@/db/schema-sage"
import type { Db } from "@/lib/server/action-context"

// ---------------------------------------------------------------------------
// Drizzle builders
// ---------------------------------------------------------------------------

function readRequestInsert(db: Db, values: SQLiteInsertValue<typeof sageContactReadRequests>) {
  return db.insert(sageContactReadRequests).values(values)
}
function readRequestUpdate(db: Db, changes: SQLiteUpdateSetSource<typeof sageContactReadRequests>, where: SQL | undefined) {
  return db.update(sageContactReadRequests).set(changes).where(where)
}
function snapshotInsert(db: Db, values: SQLiteInsertValue<typeof sageContactSnapshots>) {
  return db.insert(sageContactSnapshots).values(values)
}
function changeProposalInsert(db: Db, values: SQLiteInsertValue<typeof sageContactChangeProposals>) {
  return db.insert(sageContactChangeProposals).values(values)
}
function changeProposalUpdate(db: Db, changes: SQLiteUpdateSetSource<typeof sageContactChangeProposals>, where: SQL | undefined) {
  return db.update(sageContactChangeProposals).set(changes).where(where)
}
function changeEventInsert(db: Db, values: SQLiteInsertValue<typeof sageContactChangeEvents>) {
  return db.insert(sageContactChangeEvents).values(values)
}
function createProposalInsert(db: Db, values: SQLiteInsertValue<typeof sageContactCreateProposals>) {
  return db.insert(sageContactCreateProposals).values(values)
}
function createProposalUpdate(db: Db, changes: SQLiteUpdateSetSource<typeof sageContactCreateProposals>, where: SQL | undefined) {
  return db.update(sageContactCreateProposals).set(changes).where(where)
}
function createEventInsert(db: Db, values: SQLiteInsertValue<typeof sageContactCreateEvents>) {
  return db.insert(sageContactCreateEvents).values(values)
}
function linkEventInsert(db: Db, values: SQLiteInsertValue<typeof sageContactLinkEvents>) {
  return db.insert(sageContactLinkEvents).values(values)
}

/** Unexecuted insert; the partial unique index rejects a second active lookup. */
export function insertSageContactReadRequest(
  db: Db,
  values: SQLiteInsertValue<typeof sageContactReadRequests>
): ReturnType<typeof readRequestInsert> {
  return readRequestInsert(db, values)
}

/** Unexecuted update fenced by the caller's `where` (claim token, status, stale cutoff). */
export function updateSageContactReadRequests(
  db: Db,
  changes: SQLiteUpdateSetSource<typeof sageContactReadRequests>,
  where: SQL | undefined
): ReturnType<typeof readRequestUpdate> {
  return readRequestUpdate(db, changes, where)
}

/** Unexecuted insert: chain the caller's `.onConflictDoUpdate()` on (organization, kind, entity). */
export function insertSageContactSnapshot(
  db: Db,
  values: SQLiteInsertValue<typeof sageContactSnapshots>
): ReturnType<typeof snapshotInsert> {
  return snapshotInsert(db, values)
}

export function insertSageContactChangeProposal(
  db: Db,
  values: SQLiteInsertValue<typeof sageContactChangeProposals>
): ReturnType<typeof changeProposalInsert> {
  return changeProposalInsert(db, values)
}

/** Unexecuted update fenced by the caller's `where` (claim token, status, stale cutoff). */
export function updateSageContactChangeProposals(
  db: Db,
  changes: SQLiteUpdateSetSource<typeof sageContactChangeProposals>,
  where: SQL | undefined
): ReturnType<typeof changeProposalUpdate> {
  return changeProposalUpdate(db, changes, where)
}

export function insertSageContactChangeEvent(
  db: Db,
  values: SQLiteInsertValue<typeof sageContactChangeEvents>
): ReturnType<typeof changeEventInsert> {
  return changeEventInsert(db, values)
}

export function insertSageContactCreateProposal(
  db: Db,
  values: SQLiteInsertValue<typeof sageContactCreateProposals>
): ReturnType<typeof createProposalInsert> {
  return createProposalInsert(db, values)
}

/** Unexecuted update fenced by the caller's `where` (claim token, status). */
export function updateSageContactCreateProposals(
  db: Db,
  changes: SQLiteUpdateSetSource<typeof sageContactCreateProposals>,
  where: SQL | undefined
): ReturnType<typeof createProposalUpdate> {
  return createProposalUpdate(db, changes, where)
}

export function insertSageContactCreateEvent(
  db: Db,
  values: SQLiteInsertValue<typeof sageContactCreateEvents>
): ReturnType<typeof createEventInsert> {
  return createEventInsert(db, values)
}

export function insertSageContactLinkEvent(
  db: Db,
  values: SQLiteInsertValue<typeof sageContactLinkEvents>
): ReturnType<typeof linkEventInsert> {
  return linkEventInsert(db, values)
}

// ---------------------------------------------------------------------------
// Read requests and link review (raw, fenced statements)
// ---------------------------------------------------------------------------

/** A bridge read the caller holds: its id, organization and claim token. */
export type SageContactReadClaim = {
  readonly id: string
  readonly organizationId: string
  readonly claimToken: string
}

/** Marks a running link-candidate read `conflict`, then its audit event (two batch items). */
export function rejectSageLinkCandidateStatements(
  database: D1Database,
  read: SageContactReadClaim,
  reason: string,
  now: string
): D1PreparedStatement[] {
  return [
    database.prepare(
      `UPDATE sage_contact_read_requests SET status = 'conflict', error_message = ?, completed_at = ?
       WHERE id = ? AND organization_id = ? AND claim_token = ?
         AND status = 'running' AND purpose = 'link_candidate'`
    ).bind(reason, now, read.id, read.organizationId, read.claimToken),
    database.prepare(
      `INSERT INTO sage_contact_link_events
       (id, request_id, organization_id, actor_user_id, event_type, detail_json, created_at)
       SELECT ?, id, organization_id, NULL, 'conflict', ?, ?
       FROM sage_contact_read_requests WHERE id = ? AND organization_id = ?
         AND claim_token = ? AND status = 'conflict' AND completed_at = ?`
    ).bind(crypto.randomUUID(), JSON.stringify({ reason }), now,
      read.id, read.organizationId, read.claimToken, now),
  ]
}

/** Stores a candidate read-back for review, then its audit event (two batch items). */
export function awaitSageLinkReviewStatements(
  database: D1Database,
  input: { readonly readId: string; readonly claimToken: string; readonly snapshotJson: string; readonly now: string }
): D1PreparedStatement[] {
  return [
    database.prepare(
      `UPDATE sage_contact_read_requests
           SET status = 'awaiting_review', candidate_snapshot_json = ?, completed_at = ?
           WHERE id = ? AND claim_token = ? AND status = 'running' AND purpose = 'link_candidate'`
    ).bind(input.snapshotJson, input.now, input.readId, input.claimToken),
    database.prepare(
      `INSERT INTO sage_contact_link_events
           (id, request_id, organization_id, actor_user_id, event_type, detail_json, created_at)
           SELECT ?, id, organization_id, NULL, 'candidate_read', '{}', ?
           FROM sage_contact_read_requests WHERE id = ? AND status = 'awaiting_review'
             AND claim_token = ?`
    ).bind(crypto.randomUUID(), input.now, input.readId, input.claimToken),
  ]
}

/** Re-queues a completed candidate lookup for a fresh read-back, then its audit event once. */
export function refreshSageLinkLookupStatements(
  database: D1Database,
  input: {
    readonly requestId: string
    readonly organizationId: string
    readonly actorUserId: string
    readonly number: string
    readonly reason: string
    readonly refreshedAt: string
  }
): D1PreparedStatement[] {
  return [
    database.prepare(
      `UPDATE sage_contact_read_requests SET status = 'queued', claim_token = NULL,
           claimed_at = NULL, candidate_snapshot_json = NULL, completed_at = NULL,
           error_message = NULL, requested_at = ?
           WHERE id = ? AND organization_id = ? AND purpose = 'link_candidate'
             AND status = 'awaiting_review' AND sage_record_number = ?`
    ).bind(input.refreshedAt, input.requestId, input.organizationId, input.number),
    database.prepare(
      `INSERT INTO sage_contact_link_events
           (id, request_id, organization_id, actor_user_id, event_type, detail_json, created_at)
           SELECT ?, id, organization_id, ?, 'refreshed', ?, ?
           FROM sage_contact_read_requests WHERE id = ? AND organization_id = ?
             AND status = 'queued' AND requested_at = ?
             AND NOT EXISTS (SELECT 1 FROM sage_contact_link_events
               WHERE request_id = ? AND event_type = 'refreshed' AND created_at = ?)`
    ).bind(crypto.randomUUID(), input.actorUserId, JSON.stringify({ number: input.number, reason: input.reason }),
      input.refreshedAt, input.requestId, input.organizationId, input.refreshedAt, input.requestId, input.refreshedAt),
  ]
}

/** A staff review of one link candidate. */
export type SageLinkReview = {
  readonly requestId: string
  readonly organizationId: string
  readonly reviewerUserId: string
  readonly reviewNote: string | null
  readonly now: string
}

/** Rejects a candidate awaiting review, then its audit event (two batch items). */
export function rejectSageLinkReviewStatements(
  database: D1Database,
  review: SageLinkReview,
  noteJson: string
): D1PreparedStatement[] {
  return [
    database.prepare(
      `UPDATE sage_contact_read_requests SET status = 'rejected', reviewed_by_user_id = ?,
           reviewed_at = ?, review_note = ? WHERE id = ? AND organization_id = ?
           AND purpose = 'link_candidate' AND status = 'awaiting_review'`
    ).bind(review.reviewerUserId, review.now, review.reviewNote, review.requestId, review.organizationId),
    database.prepare(
      `INSERT INTO sage_contact_link_events
           (id, request_id, organization_id, actor_user_id, event_type, detail_json, created_at)
           SELECT ?, id, organization_id, ?, 'rejected', ?, ?
           FROM sage_contact_read_requests WHERE id = ? AND status = 'rejected'
             AND reviewed_by_user_id = ? AND reviewed_at = ?`
    ).bind(crypto.randomUUID(), review.reviewerUserId, noteJson, review.now,
      review.requestId, review.reviewerUserId, review.now),
  ]
}

/** Takes the `linking` claim on a candidate whose stored read-back is still `candidateSnapshotJson`. */
export function startSageLinkStatement(
  database: D1Database,
  review: SageLinkReview,
  input: { readonly reviewToken: string; readonly candidateSnapshotJson: string | null }
): D1PreparedStatement {
  return database.prepare(
    `UPDATE sage_contact_read_requests SET status = 'linking', claim_token = ?,
         reviewed_by_user_id = ?, reviewed_at = ?, review_note = ?
         WHERE id = ? AND organization_id = ? AND purpose = 'link_candidate'
           AND status = 'awaiting_review' AND candidate_snapshot_json = ?`
  ).bind(input.reviewToken, review.reviewerUserId, review.now, review.reviewNote,
    review.requestId, review.organizationId, input.candidateSnapshotJson)
}

/**
 * Marks the claim `linked` only if the directory row now carries the Sage
 * ID. `confirmedTable`, `confirmedColumn` and `confirmation` are the caller's
 * fixed per-kind SQL; `binds` follow the statement.
 */
export function confirmSageLinkStatement(
  database: D1Database,
  input: {
    readonly confirmedTable: string
    readonly confirmedColumn: string
    readonly confirmation: string
    readonly binds: readonly unknown[]
  }
): D1PreparedStatement {
  return database.prepare(
    `UPDATE sage_contact_read_requests SET status = 'linked' WHERE id = ?
       AND organization_id = ? AND status = 'linking' AND claim_token = ?
       AND EXISTS (SELECT 1 FROM ${input.confirmedTable} WHERE id = ? AND ${input.confirmedColumn} = ?${input.confirmation})`
  ).bind(...input.binds)
}

/** The `linked` audit event, present only when the confirmation landed. */
export function sageLinkedEventStatement(
  database: D1Database,
  review: SageLinkReview,
  input: { readonly reviewToken: string; readonly detailJson: string }
): D1PreparedStatement {
  return database.prepare(
    `INSERT INTO sage_contact_link_events
         (id, request_id, organization_id, actor_user_id, event_type, detail_json, created_at)
         SELECT ?, id, organization_id, ?, 'linked', ?, ? FROM sage_contact_read_requests
         WHERE id = ? AND organization_id = ? AND status = 'linked'
           AND reviewed_by_user_id = ? AND reviewed_at = ? AND claim_token = ?`
  ).bind(crypto.randomUUID(), review.reviewerUserId, input.detailJson, review.now,
    review.requestId, review.organizationId, review.reviewerUserId, review.now, input.reviewToken)
}

// ---------------------------------------------------------------------------
// Change and create proposal reviews
// ---------------------------------------------------------------------------

/** A staff decision on a pending change or create proposal. */
export type SageProposalReview = {
  readonly proposalId: string
  readonly organizationId: string
  readonly reviewerUserId: string
  readonly status: "approved" | "rejected"
  readonly reviewNote: string | null
  readonly noteJson: string
  readonly completedAt: string | null
  readonly now: string
}

/** Decides a pending change proposal, then its audit event (two batch items). */
export function reviewSageContactChangeStatements(database: D1Database, review: SageProposalReview): D1PreparedStatement[] {
  return [
    database.prepare(
      `UPDATE sage_contact_change_proposals
         SET status = ?, reviewed_by_user_id = ?, reviewed_at = ?,
             review_note = ?, updated_at = ?, completed_at = ?
         WHERE id = ? AND organization_id = ? AND status = 'pending'`
    ).bind(review.status, review.reviewerUserId, review.now, review.reviewNote, review.now,
      review.completedAt, review.proposalId, review.organizationId),
    database.prepare(
      `INSERT INTO sage_contact_change_events
         (id, proposal_id, organization_id, actor_user_id, event_type, detail_json, created_at)
         SELECT ?, id, organization_id, ?, ?, ?, ?
         FROM sage_contact_change_proposals
         WHERE id = ? AND organization_id = ? AND status = ?
           AND reviewed_by_user_id = ? AND reviewed_at = ?`
    ).bind(crypto.randomUUID(), review.reviewerUserId, review.status, review.noteJson, review.now,
      review.proposalId, review.organizationId, review.status, review.reviewerUserId, review.now),
  ]
}

/** Decides a pending create proposal, then its audit event (two batch items). */
export function reviewSageContactCreateStatements(database: D1Database, review: SageProposalReview): D1PreparedStatement[] {
  return [
    database.prepare(
      `UPDATE sage_contact_create_proposals SET status = ?, reviewed_by_user_id = ?,
         reviewed_at = ?, review_note = ?, completed_at = ?, updated_at = ?
         WHERE id = ? AND organization_id = ? AND status = 'pending'`
    ).bind(review.status, review.reviewerUserId, review.now, review.reviewNote,
      review.completedAt, review.now, review.proposalId, review.organizationId),
    database.prepare(
      `INSERT INTO sage_contact_create_events
         (id, proposal_id, organization_id, actor_user_id, event_type, detail_json, created_at)
         SELECT ?, id, organization_id, ?, ?, ?, ? FROM sage_contact_create_proposals
         WHERE id = ? AND organization_id = ? AND status = ?
           AND reviewed_by_user_id = ? AND reviewed_at = ?`
    ).bind(crypto.randomUUID(), review.reviewerUserId, review.status, review.noteJson, review.now,
      review.proposalId, review.organizationId, review.status, review.reviewerUserId, review.now),
  ]
}

// ---------------------------------------------------------------------------
// Create proposals: bridge claim and result
// ---------------------------------------------------------------------------

/**
 * Claims one approved, never-attempted Add while its parent company still
 * carries the expected Sage ID and no other Add for that parent is running
 * or unreconciled.
 */
export function claimSageContactCreateStatement(
  database: D1Database,
  input: {
    readonly kind: "client_person" | "vendor_person"
    readonly proposalId: string
    readonly organizationId: string
    readonly parentSageRecordId: string
    readonly claimToken: string
    readonly now: string
  }
): D1PreparedStatement {
  const parentTable = input.kind === "client_person" ? "customers" : "vendors"
  const parentIdColumn = input.kind === "client_person" ? "customer_id" : "vendor_id"
  const parentSageColumn = input.kind === "client_person" ? "sage_client_id" : "sage_vendor_id"
  const activeFilter = input.kind === "client_person" ? "" : "AND parent.directory_status = 'active'"
  return database.prepare(
    `UPDATE sage_contact_create_proposals
         SET status = 'running', claim_token = ?, claimed_at = ?, attempt_count = attempt_count + 1,
             updated_at = ?
         WHERE id = ? AND organization_id = ? AND status = 'approved' AND attempt_count = 0
           AND EXISTS (SELECT 1 FROM ${parentTable} parent
             WHERE parent.id = sage_contact_create_proposals.${parentIdColumn}
               AND parent.organization_id = sage_contact_create_proposals.organization_id
               AND parent.${parentSageColumn} = sage_contact_create_proposals.parent_sage_record_id
               ${activeFilter})
           AND NOT EXISTS (
             SELECT 1 FROM sage_contact_create_proposals other
             WHERE other.organization_id = ? AND other.parent_sage_record_id = ?
               AND other.status IN ('running', 'needs_reconciliation') AND other.id <> ?
           )`
  ).bind(input.claimToken, input.now, input.now, input.proposalId, input.organizationId,
    input.organizationId, input.parentSageRecordId, input.proposalId)
}

/** The running Add claim a bridge result must still hold. */
export type SageContactCreateClaim = {
  readonly proposalId: string
  readonly organizationId: string
  readonly claimToken: string
  readonly now: string
}

/** The audit event for a finished Add, present only if the proposal reached `status` at `now`. */
export function sageContactCreateOutcomeEventStatement(
  database: D1Database,
  claim: SageContactCreateClaim,
  status: "needs_reconciliation" | "failed" | "succeeded",
  detailJson: string
): D1PreparedStatement {
  return database.prepare(
    `INSERT INTO sage_contact_create_events
       (id, proposal_id, organization_id, actor_user_id, event_type, detail_json, created_at)
       SELECT ?, id, organization_id, NULL, '${status}', ?, ?
       FROM sage_contact_create_proposals WHERE id = ? AND organization_id = ?
         AND status = '${status}' AND claim_token = ? AND completed_at = ?`
  ).bind(crypto.randomUUID(), detailJson, claim.now,
    claim.proposalId, claim.organizationId, claim.claimToken, claim.now)
}

/** Parks a running Add whose outcome in Sage is uncertain. */
export function sageContactCreateUncertainStatement(
  database: D1Database,
  claim: SageContactCreateClaim,
  input: { readonly reason: string; readonly sageContactId: string | null; readonly sageLineNumber: number | null }
): D1PreparedStatement {
  return database.prepare(
    `UPDATE sage_contact_create_proposals SET status = 'needs_reconciliation',
       error_message = ?, sage_contact_id = ?, sage_line_number = ?,
       completed_at = ?, updated_at = ? WHERE id = ? AND organization_id = ?
         AND status = 'running' AND claim_token = ?`
  ).bind(input.reason, input.sageContactId, input.sageLineNumber, claim.now, claim.now,
    claim.proposalId, claim.organizationId, claim.claimToken)
}

/** Fails a running Add that Sage reported was never attempted. */
export function sageContactCreateFailedStatement(
  database: D1Database,
  claim: SageContactCreateClaim,
  error: string
): D1PreparedStatement {
  return database.prepare(
    `UPDATE sage_contact_create_proposals SET status = 'failed', error_message = ?,
         completed_at = ?, updated_at = ? WHERE id = ? AND organization_id = ?
           AND status = 'running' AND claim_token = ?`
  ).bind(error, claim.now, claim.now, claim.proposalId, claim.organizationId, claim.claimToken)
}

/**
 * The snapshot of the person Sage added, inserted only if the directory row
 * (`canonicalTable`, a fixed table name) now carries the Sage contact ID.
 */
export function sageCreatedPersonSnapshotStatement(
  database: D1Database,
  input: {
    readonly canonicalTable: "customer_contacts" | "vendor_contacts"
    readonly organizationId: string
    readonly kind: string
    readonly personId: string
    readonly sageRecordId: string
    readonly parentSageRecordId: string | null
    readonly revision: string
    readonly fieldsJson: string
    readonly now: string
  }
): D1PreparedStatement {
  return database.prepare(
    `INSERT INTO sage_contact_snapshots
       (id, organization_id, kind, entity_id, sage_record_id, parent_sage_record_id,
        revision, fields_json, captured_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? FROM ${input.canonicalTable}
       WHERE id = ? AND sage_contact_id = ?`
  ).bind(crypto.randomUUID(), input.organizationId, input.kind, input.personId,
    input.sageRecordId, input.parentSageRecordId,
    input.revision, input.fieldsJson, input.now,
    input.personId, input.sageRecordId)
}

/** Completes a running Add once the directory row carries the Sage contact ID. */
export function sageContactCreateSucceededStatement(
  database: D1Database,
  claim: SageContactCreateClaim,
  input: {
    readonly canonicalTable: "customer_contacts" | "vendor_contacts"
    readonly sageContactId: string
    readonly sageLineNumber: number
  }
): D1PreparedStatement {
  return database.prepare(
    `UPDATE sage_contact_create_proposals SET status = 'succeeded',
       sage_contact_id = ?, sage_line_number = ?, completed_at = ?, updated_at = ?
       WHERE id = ? AND organization_id = ? AND status = 'running' AND claim_token = ?
         AND EXISTS (SELECT 1 FROM ${input.canonicalTable} WHERE id = ? AND sage_contact_id = ?)`
  ).bind(input.sageContactId, input.sageLineNumber, claim.now, claim.now, claim.proposalId, claim.organizationId,
    claim.claimToken, claim.proposalId, input.sageContactId)
}
