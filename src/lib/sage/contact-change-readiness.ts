import "server-only"

import { and, desc, eq } from "drizzle-orm"

import { sageContactChangeProposals, sageContactReadRequests } from "@/db/schema-sage"
import {
  insertSageContactChangeEvent,
  insertSageContactReadRequest,
  replanSageContactChangeStatements,
  updateSageContactChangeProposals,
} from "@/lib/domain/sage-bridge/contact-store"
import { sageContactKindSchema } from "@/lib/sage/contact-bridge"
import type { SageContactFieldChange } from "@/lib/sage/contact-change-proposal"
import { getSageContactEntityIdentity } from "@/lib/sage/contact-entity"
import {
  latestSageSnapshot,
  parseSageChanges,
  recordSageChangeActivity,
  sageSnapshotFromRow,
} from "@/lib/sage/contact-proposal-service"
import { sameSageRecordId } from "@/lib/sage/record-id"
import { SAGE_FIELD_LABELS } from "@/lib/sage/sage-linked-edit-fields"
import type { Db } from "@/lib/server/action-context"
import type { ActivityActor } from "@/lib/activity-log"

/**
 * Gets an approved Sage contact change ready for the Sage writer.
 *
 * Approval is a decision about the requested values, not about how old
 * Compass's last Sage read is. Before the writer may claim an approved
 * change, Compass needs a recent read of the record (SAGE_WRITE_READ_MAX_AGE_MS)
 * whose revision the change is planned against:
 *
 * - no recent read: a fresh Sage read is queued and the change waits
 *   ("checking Sage"); the read's arrival runs this again;
 * - a recent read with the planned revision: ready;
 * - a recent read with another revision (anything in the record changed):
 *   when Sage still holds each changed field's before-value (or already holds
 *   the requested value), the change is rebased onto the new revision and is
 *   ready; when Sage itself changed one of those fields, the change becomes a
 *   conflict that names Sage's value and the requested one, for staff to
 *   reapply or reject.
 *
 * So Compass never hands the writer a change whose before-values differ from
 * a recent Sage read, and the writer re-checks revision and before-values
 * against Sage itself before writing.
 */

/** How recent the Sage read behind a write must be when the writer claims it. */
const SAGE_WRITE_READ_MAX_AGE_MS = 10 * 60 * 1000
/** A failed read is not asked for again sooner than this. */
const READ_RETRY_BACKOFF_MS = 5 * 60 * 1000

const SAGE_READ_ACTOR: ActivityActor = {
  id: null, email: "sage", displayName: "Sage read", firstName: null, lastName: null, role: "system",
}

export type SageFieldDifference = {
  readonly field: SageContactFieldChange["field"]
  /** Sage's current value; undefined when the read did not return the field. */
  readonly sageValue: string | null | undefined
  readonly requested: string | null
}

export type SageRebaseResult =
  | { readonly ok: true; readonly changes: readonly SageContactFieldChange[] }
  | { readonly ok: false; readonly differences: readonly SageFieldDifference[] }

/** Same comparison the Sage writer makes: null and blank are equal, otherwise exact. */
function sameSageValue(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left ?? "") === (right ?? "")
}

/**
 * Plans the changes against a newer Sage read. A field still holding its
 * before-value keeps it; a field already holding the requested value takes it
 * as its before-value (nothing left to write there); any other value means
 * Sage changed underneath the request.
 */
export function rebaseSageChanges(
  changes: readonly SageContactFieldChange[],
  sageFields: Readonly<Record<string, string | null | undefined>>
): SageRebaseResult {
  const differences: SageFieldDifference[] = []
  const rebased: SageContactFieldChange[] = []
  for (const change of changes) {
    const returned = Object.prototype.hasOwnProperty.call(sageFields, change.field)
    const sageValue = returned ? sageFields[change.field] ?? null : undefined
    if (returned && sameSageValue(sageValue, change.before)) rebased.push(change)
    else if (returned && sameSageValue(sageValue, change.after)) rebased.push({ ...change, before: sageValue ?? null })
    else differences.push({ field: change.field, sageValue, requested: change.after })
  }
  return differences.length > 0 ? { ok: false, differences } : { ok: true, changes: rebased }
}

function quoted(value: string | null | undefined): string {
  if (value === undefined) return "(not returned)"
  return value?.trim() ? `"${value}"` : "(blank)"
}

/** The conflict message staff see: Sage's value against the requested one, per field. */
export function describeSageDifferences(differences: readonly SageFieldDifference[]): string {
  const labels: Readonly<Record<string, string>> = SAGE_FIELD_LABELS
  const parts = differences.map((difference) =>
    `${labels[difference.field] ?? difference.field}: Sage now has ${quoted(difference.sageValue)}, requested ${quoted(difference.requested)}`)
  return `Sage changed since this was requested. ${parts.join("; ")}.`
}

type ProposalRow = typeof sageContactChangeProposals.$inferSelect

export type SageWriteReadiness =
  | {
    readonly state: "ready"
    /** The change to claim: the same one, or its rebased copy. */
    readonly id: string
    readonly baseRevision: string
    readonly changes: readonly SageContactFieldChange[]
  }
  /** A fresh Sage read is queued or running; the change waits for it. */
  | { readonly state: "checking_sage" }
  | { readonly state: "conflict"; readonly message: string }
  /** The change moved on (reviewed, claimed or replaced) meanwhile. */
  | { readonly state: "gone" }

function isRecentRead(capturedAt: string, now: Date): boolean {
  const value = Date.parse(capturedAt)
  return Number.isFinite(value) && value <= now.getTime() &&
    now.getTime() - value <= SAGE_WRITE_READ_MAX_AGE_MS
}

/** Queues a Sage read of the record unless one is waiting or one just failed. */
async function queueReadForWrite(
  db: Db,
  proposal: ProposalRow,
  sageRecordNumber: string | null,
  now: Date
): Promise<void> {
  const last = await db.select({ status: sageContactReadRequests.status, requestedAt: sageContactReadRequests.requestedAt })
    .from(sageContactReadRequests).where(and(
      eq(sageContactReadRequests.organizationId, proposal.organizationId),
      eq(sageContactReadRequests.kind, proposal.kind),
      eq(sageContactReadRequests.entityId, proposal.entityId),
      eq(sageContactReadRequests.purpose, "refresh")
    )).orderBy(desc(sageContactReadRequests.requestedAt)).limit(1).get()
  if (last && (last.status === "queued" || last.status === "running")) return
  if (last?.status === "failed" && now.getTime() - Date.parse(last.requestedAt) < READ_RETRY_BACKOFF_MS) return
  await insertSageContactReadRequest(db, {
    id: crypto.randomUUID(), organizationId: proposal.organizationId, kind: proposal.kind, entityId: proposal.entityId,
    sageRecordId: proposal.sageRecordId, sageRecordNumber, parentSageRecordId: proposal.parentSageRecordId,
    status: "queued", requestedByUserId: proposal.reviewedByUserId, requestedAt: now.toISOString(),
  })
}

async function markConflict(
  db: Db,
  proposal: ProposalRow,
  changes: readonly SageContactFieldChange[],
  message: string,
  nowIso: string
): Promise<SageWriteReadiness> {
  const updated = await updateSageContactChangeProposals(db, {
    status: "conflict", errorMessage: message, claimToken: null, completedAt: nowIso, updatedAt: nowIso,
  }, and(eq(sageContactChangeProposals.id, proposal.id), eq(sageContactChangeProposals.status, proposal.status)))
    .returning({ id: sageContactChangeProposals.id })
  if (updated.length !== 1) return { state: "gone" }
  await insertSageContactChangeEvent(db, {
    id: crypto.randomUUID(), proposalId: proposal.id, organizationId: proposal.organizationId,
    actorUserId: null, eventType: "conflict", detailJson: JSON.stringify({ message }), createdAt: nowIso,
  })
  const kind = sageContactKindSchema.safeParse(proposal.kind)
  if (kind.success) {
    await recordSageChangeActivity(db, {
      organizationId: proposal.organizationId, actor: SAGE_READ_ACTOR, kind: kind.data,
      entityId: proposal.entityId, proposalId: proposal.id, step: "conflict", changes, note: message.slice(0, 300),
    })
  }
  return { state: "conflict", message }
}

/**
 * Checks one approved change (or a claim that went stale while running)
 * against Compass's latest Sage read; see the module comment. A stale
 * running claim that needs a new read goes back to approved first.
 */
export async function prepareApprovedSageChange(
  db: Db,
  database: D1Database,
  proposal: ProposalRow,
  now: Date = new Date()
): Promise<SageWriteReadiness> {
  const nowIso = now.toISOString()
  const kind = sageContactKindSchema.safeParse(proposal.kind)
  const changes = parseSageChanges(proposal.changesJson)
  if (!kind.success || !changes || changes.length === 0) return { state: "gone" }
  const identity = await getSageContactEntityIdentity(db, proposal.organizationId, kind.data, proposal.entityId)
  if (!identity || !sameSageRecordId(identity.sageRecordId, proposal.sageRecordId) ||
    !sameSageRecordId(identity.parentSageRecordId, proposal.parentSageRecordId)) {
    return markConflict(db, proposal, changes,
      "This record's Sage link changed after the change was requested. Reject it and save the change again.", nowIso)
  }
  const snapshotRow = await latestSageSnapshot(db, proposal.organizationId, kind.data, proposal.entityId)
  const snapshot = snapshotRow ? sageSnapshotFromRow(snapshotRow) : null
  const fresh = snapshotRow && snapshot && isRecentRead(snapshotRow.capturedAt, now) &&
    sameSageRecordId(snapshot.sageRecordId, proposal.sageRecordId) &&
    sameSageRecordId(snapshot.parentSageRecordId, proposal.parentSageRecordId)
  if (!fresh || !snapshot) {
    if (proposal.status === "running") {
      const reset = await updateSageContactChangeProposals(db, { status: "approved", claimToken: null, updatedAt: nowIso },
        and(eq(sageContactChangeProposals.id, proposal.id), eq(sageContactChangeProposals.status, "running"),
          eq(sageContactChangeProposals.claimedAt, proposal.claimedAt ?? "")))
        .returning({ id: sageContactChangeProposals.id })
      if (reset.length !== 1) return { state: "gone" }
    }
    await queueReadForWrite(db, proposal, identity.sageRecordNumber, now)
    return { state: "checking_sage" }
  }
  if (snapshot.revision === proposal.baseRevision) {
    return { state: "ready", id: proposal.id, baseRevision: proposal.baseRevision, changes }
  }
  const rebase = rebaseSageChanges(changes, snapshot.fields)
  if (!rebase.ok) return markConflict(db, proposal, changes, describeSageDifferences(rebase.differences), nowIso)
  const replanned = await replanSageChange(database, proposal, {
    baseRevision: snapshot.revision, changes: rebase.changes,
    reviewedByUserId: proposal.reviewedByUserId, reviewedAt: proposal.reviewedAt,
    actorUserId: null, eventType: "rebased", now: nowIso,
  })
  return replanned
    ? { state: "ready", id: replanned, baseRevision: snapshot.revision, changes: rebase.changes }
    : { state: "gone" }
}

/**
 * Supersedes a change with an approved copy planned against `baseRevision`
 * (plans are immutable). The new id, or null when the change moved on
 * meanwhile or another change of the record is already waiting.
 */
export async function replanSageChange(
  database: D1Database,
  proposal: ProposalRow,
  next: {
    readonly baseRevision: string
    readonly changes: readonly SageContactFieldChange[]
    readonly reviewedByUserId: string | null
    readonly reviewedAt: string | null
    readonly actorUserId: string | null
    readonly eventType: "rebased" | "reapplied"
    readonly now: string
  }
): Promise<string | null> {
  const id = crypto.randomUUID()
  try {
    const results = await database.batch(replanSageContactChangeStatements(database, {
      fromId: proposal.id, fromStatus: proposal.status, toId: id, organizationId: proposal.organizationId,
      baseRevision: next.baseRevision, changesJson: JSON.stringify(next.changes),
      reviewedByUserId: next.reviewedByUserId, reviewedAt: next.reviewedAt, actorUserId: next.actorUserId,
      eventType: next.eventType, now: next.now,
      detailJson: JSON.stringify({ replaces: proposal.id, fromRevision: proposal.baseRevision, toRevision: next.baseRevision }),
    }))
    return results[0]?.meta.changes === 1 && results[2]?.meta.changes === 1 ? id : null
  } catch {
    // Only one change per record may be waiting or on its way to Sage.
    return null
  }
}

/** After a Sage read of a record lands: gets its approved change ready (or into conflict). Never throws. */
export async function prepareApprovedSageChangesFor(
  db: Db,
  database: D1Database,
  organizationId: string,
  kind: string,
  entityId: string
): Promise<void> {
  try {
    const rows = await db.select().from(sageContactChangeProposals).where(and(
      eq(sageContactChangeProposals.organizationId, organizationId),
      eq(sageContactChangeProposals.kind, kind),
      eq(sageContactChangeProposals.entityId, entityId),
      eq(sageContactChangeProposals.status, "approved")
    ))
    for (const row of rows) await prepareApprovedSageChange(db, database, row)
  } catch (error) {
    console.error("Could not check an approved Sage change against the new read", error)
  }
}
