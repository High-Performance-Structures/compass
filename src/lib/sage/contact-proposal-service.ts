import "server-only"

import { and, eq, inArray } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import { z } from "zod/v4"

import {
  sageContactChangeProposals,
  sageContactReadRequests,
  sageContactSnapshots,
} from "@/db/schema-sage"
import { recordActivityEvent, type ActivityActor } from "@/lib/activity-log"
import type { AuthUser } from "@/lib/auth"
import {
  insertSageContactChangeEvent,
  insertSageContactChangeProposal,
  insertSageContactReadRequest,
  updateSageContactChangeProposals,
} from "@/lib/domain/sage-bridge/contact-store"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { sageContactKindSchema, sageContactOrganizationMatches } from "@/lib/sage/contact-bridge"
import {
  isPrivateEmployeeContactField,
  planSageContactChange,
  sageContactProposalFields,
  type SageContactFieldChange,
  type SageContactKind,
  type SageContactProposalPlan,
  type SageContactSnapshot,
} from "@/lib/sage/contact-change-proposal"
import { getSageContactEntityIdentity, type SageContactEntityIdentity } from "@/lib/sage/contact-entity"
import {
  describeSageChanges,
  sageContactActivityEntityType,
  sameRequestedChanges,
  type SageLinkedEditKind,
} from "@/lib/sage/sage-linked-edit-fields"
import { holdingSageChange, holdingSageChanges } from "@/lib/sage/sage-held-fields"
import { applySageLinkedValuesInCompass } from "@/lib/sage/sage-linked-local-apply"
import type { Db } from "@/lib/server/action-context"
import { isClientAccountRole, isInternalStaffRole, isVendorRole } from "@/lib/user-roles"
import { sameSageRecordId } from "@/lib/sage/record-id"

/**
 * The reviewed Sage contact change pipeline shared by "Propose Sage edit"
 * and the inline Sage-linked company forms: one proposal per record, planned
 * against a recent Sage read, approved by a different authorized person, and
 * written by the Sage host's contact writer.
 */

const fieldsSchema = z.record(z.string(), z.string().nullable())
const sageContactChangesSchema = z.array(z.object({
  field: z.string(), before: z.string().nullable(), after: z.string().nullable(),
}))
const sageContactFieldSchema = z.enum([
  "name", "title", "ownerName", "addressLine1", "addressLine2", "city", "state",
  "postalCode", "billingAddressLine1", "billingAddressLine2", "billingCity",
  "billingState", "billingPostalCode", "primaryEmail", "email", "phone",
  "phoneExtension", "cellPhone",
])
const SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000

export type SageProposalResult =
  | { readonly success: true; readonly id: string; readonly status: string }
  | { readonly success: false; readonly error: string }

export type SageProposalContext = {
  readonly user: AuthUser
  readonly organizationId: string
  readonly db: Db
  readonly env: CloudflareEnv
}

export function isRecentSageRead(iso: string): boolean {
  const value = Date.parse(iso)
  return Number.isFinite(value) && value <= Date.now() &&
    Date.now() - value <= SNAPSHOT_MAX_AGE_MS
}

export function sageSnapshotFromRow(row: typeof sageContactSnapshots.$inferSelect): SageContactSnapshot | null {
  let parsed: unknown
  try { parsed = JSON.parse(row.fieldsJson) } catch { return null }
  const fields = fieldsSchema.safeParse(parsed)
  const kind = sageContactKindSchema.safeParse(row.kind)
  if (!fields.success || !kind.success) return null
  return {
    organizationId: row.organizationId,
    kind: kind.data,
    sageRecordId: row.sageRecordId,
    parentSageRecordId: row.parentSageRecordId,
    revision: row.revision,
    fields: fields.data,
  }
}

export function parseSageChanges(json: string): readonly SageContactFieldChange[] | null {
  let parsed: unknown
  try { parsed = JSON.parse(json) } catch { return null }
  const changes = sageContactChangesSchema.safeParse(parsed)
  if (!changes.success) return null
  const result: SageContactFieldChange[] = []
  for (const change of changes.data) {
    const field = sageContactFieldSchema.safeParse(change.field)
    if (!field.success) return null
    result.push({ field: field.data, before: change.before, after: change.after })
  }
  return result
}


export async function canAccessEmployeePrivate(user: AuthUser, linkedUserId: string | null): Promise<boolean> {
  if (linkedUserId === user.id) return true
  try {
    await requireFeaturePermission(user, "employee-contact-private", "read")
    return true
  } catch {
    return false
  }
}

export async function requireSageContactEditAccess(
  user: AuthUser,
  kind: SageContactKind,
  linkedUserId: string | null,
  proposed: Readonly<Record<string, string | null>>
): Promise<void> {
  if (!user.isActive) throw new Error("Inactive accounts cannot edit contacts.")
  if (linkedUserId === user.id && (
    (kind === "employee" && isInternalStaffRole(user.role)) ||
    (kind === "client_person" && isClientAccountRole(user.role)) ||
    (kind === "vendor_person" && isVendorRole(user.role))
  )) return
  const feature = kind === "employee"
    ? "internal-directory"
    : kind.startsWith("client") ? "customers" : "vendors"
  await requireFeaturePermission(user, feature, "update")
  if (kind === "employee" && Object.keys(proposed).some((field) =>
    isPrivateEmployeeContactField(field)
  )) {
    await requireFeaturePermission(user, "employee-contact-private", "read")
  }
}

export async function latestSageSnapshot(
  db: Db,
  organizationId: string,
  kind: SageContactKind,
  entityId: string
): Promise<typeof sageContactSnapshots.$inferSelect | undefined> {
  return db.select().from(sageContactSnapshots).where(and(
    eq(sageContactSnapshots.organizationId, organizationId),
    eq(sageContactSnapshots.kind, kind),
    eq(sageContactSnapshots.entityId, entityId)
  )).get()
}

/** Activity for one step of a Sage change request on its directory record. */
export async function recordSageChangeActivity(
  db: Db,
  input: {
    readonly organizationId: string
    readonly actor: ActivityActor
    readonly kind: SageContactKind
    readonly entityId: string
    readonly proposalId: string
    readonly step: "requested" | "queued" | "updated" | "withdrawn" | "approved" | "rejected" | "succeeded" | "conflict" | "failed"
    readonly changes: readonly SageContactFieldChange[]
    readonly note?: string | null
    /** A rejection that put Sage's values back in Compass. */
    readonly reverted?: boolean
  }
): Promise<void> {
  if (input.kind === "employee") return
  const described = describeSageChanges(input.changes)
  const lead = input.step === "rejected" && input.reverted ? "Sage change rejected, reverted to Sage value" : {
    requested: "Requested a Sage change",
    queued: "Saved in Compass; the Sage change request follows",
    updated: "Updated the Sage change request",
    withdrawn: "Withdrew the Sage change request; Compass matches Sage",
    approved: "Approved a Sage change",
    rejected: "Rejected a Sage change",
    succeeded: "Sage change written and confirmed",
    conflict: "Sage change did not read back as approved",
    failed: "Sage change could not be written",
  }[input.step]
  await recordActivityEvent({
    db,
    organizationId: input.organizationId,
    actor: input.actor,
    category: "account",
    action: `sage_change.${input.step}`,
    entityType: sageContactActivityEntityType(input.kind),
    entityId: input.entityId,
    summary: `${lead}: ${described}${input.note ? ` (${input.note})` : ""}`,
    metadata: {
      proposalId: input.proposalId,
      kind: input.kind,
      changes: input.changes.map((change) => ({ field: change.field, before: change.before, after: change.after })),
    },
  })
}

type ProposalGuard =
  | { readonly success: true; readonly identity: SageContactEntityIdentity & { readonly sageRecordId: string } }
  | { readonly success: false; readonly error: string }

async function proposalIdentity(
  context: SageProposalContext,
  kind: SageContactKind,
  entityId: string,
  proposed: Readonly<Record<string, string | null>>
): Promise<ProposalGuard> {
  if (!sageContactOrganizationMatches(context.env, context.organizationId)) {
    return { success: false, error: "Sage contact sync is not configured for this organization." }
  }
  const identity = await getSageContactEntityIdentity(context.db, context.organizationId, kind, entityId)
  const sageRecordId = identity?.sageRecordId
  if (!identity || !sageRecordId) return { success: false, error: "A stable Sage record ID is required." }
  await requireSageContactEditAccess(context.user, kind, identity.linkedUserId, proposed)
  return { success: true, identity: { ...identity, sageRecordId } }
}

/**
 * Stores one pending proposal against the latest Sage read, which must be
 * recent. Nothing in Compass's directory changes here.
 */
export async function createSageContactProposal(
  context: SageProposalContext,
  kind: SageContactKind,
  entityId: string,
  proposed: Readonly<Record<string, string | null>>
): Promise<SageProposalResult> {
  const guard = await proposalIdentity(context, kind, entityId, proposed)
  if (!guard.success) return guard
  const { identity } = guard
  const { db, organizationId, user } = context
  const snapshotRow = await latestSageSnapshot(db, organizationId, kind, entityId)
  if (!snapshotRow || !isRecentSageRead(snapshotRow.capturedAt)) {
    return { success: false, error: "Refresh this contact from Sage before proposing changes." }
  }
  const snapshot = sageSnapshotFromRow(snapshotRow)
  if (!snapshot || !sameSageRecordId(snapshot.sageRecordId, identity.sageRecordId) ||
    !sameSageRecordId(snapshot.parentSageRecordId, identity.parentSageRecordId)) {
    return { success: false, error: "The Sage identity changed. Refresh before editing." }
  }
  const plan = planSageContactChange({ snapshot, proposed })
  if (!plan.success) return plan
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  // A write that failed or did not read back stops holding its fields once a new request replaces it.
  const stalled = await holdingSageChange(db, organizationId, kind, entityId)
  const replaced: BatchItem<"sqlite">[] = stalled && (stalled.status === "conflict" || stalled.status === "failed")
    ? closeSageChangeStatements(db, { organizationId, actorUserId: user.id, proposal: stalled, status: "superseded", supersededBy: id, now })
    : []
  await db.batch([
    insertSageContactChangeProposal(db, {
      id, organizationId, kind, entityId,
      sageRecordId: plan.plan.sageRecordId,
      parentSageRecordId: plan.plan.parentSageRecordId,
      baseRevision: plan.plan.baseRevision,
      changesJson: JSON.stringify(plan.plan.changes),
      status: "pending", requestedByUserId: user.id,
      requestedAt: now, updatedAt: now,
    }),
    insertSageContactChangeEvent(db, {
      id: crypto.randomUUID(), proposalId: id, organizationId,
      actorUserId: user.id, eventType: "proposed",
      detailJson: JSON.stringify({ baseRevision: plan.plan.baseRevision }),
      createdAt: now,
    }),
    ...replaced,
  ])
  await recordSageChangeActivity(db, {
    organizationId, actor: user, kind, entityId, proposalId: id,
    step: "requested", changes: plan.plan.changes,
  })
  return { success: true, id, status: "pending" }
}

/** Closes an unfinished change replaced by a newer request or no longer needed. */
function closeSageChangeStatements(
  db: Db,
  input: {
    readonly organizationId: string
    readonly actorUserId: string | null
    readonly proposal: { readonly id: string; readonly status: string }
    readonly status: "superseded" | "withdrawn"
    readonly supersededBy?: string
    readonly now: string
  }
): BatchItem<"sqlite">[] {
  return [
    updateSageContactChangeProposals(db, { status: input.status, completedAt: input.now, updatedAt: input.now }, and(
      eq(sageContactChangeProposals.id, input.proposal.id),
      eq(sageContactChangeProposals.status, input.proposal.status)
    )),
    insertSageContactChangeEvent(db, {
      id: crypto.randomUUID(), proposalId: input.proposal.id, organizationId: input.organizationId,
      actorUserId: input.actorUserId, eventType: input.status,
      detailJson: JSON.stringify(input.supersededBy ? { supersededBy: input.supersededBy } : {}),
      createdAt: input.now,
    }),
  ]
}

/** Asks the Sage writer for a fresh read of the record unless one is already waiting. */
async function queueSageRead(
  context: SageProposalContext,
  kind: SageContactKind,
  entityId: string,
  identity: SageContactEntityIdentity & { readonly sageRecordId: string }
): Promise<void> {
  const { db, organizationId, user } = context
  const pendingRead = await db.select({ id: sageContactReadRequests.id }).from(sageContactReadRequests).where(and(
    eq(sageContactReadRequests.organizationId, organizationId),
    eq(sageContactReadRequests.kind, kind),
    eq(sageContactReadRequests.entityId, entityId),
    inArray(sageContactReadRequests.status, ["queued", "running"])
  )).limit(1).get()
  if (pendingRead) return
  await insertSageContactReadRequest(db, {
    id: crypto.randomUUID(), organizationId, kind, entityId,
    sageRecordId: identity.sageRecordId,
    sageRecordNumber: identity.sageRecordNumber,
    parentSageRecordId: identity.parentSageRecordId,
    status: "queued", requestedByUserId: user.id, requestedAt: new Date().toISOString(),
  })
}

export type SageEditRequestOutcome =
  /** Compass shows the new values; a new request is waiting for approval. */
  | { readonly status: "requested"; readonly proposalId: string }
  /** Compass shows the new values; the record's waiting request now asks for them. */
  | { readonly status: "updated"; readonly proposalId: string }
  /** The same request was already waiting. */
  | { readonly status: "already_requested" }
  /** Sage already holds these values; Compass now matches it and nothing is requested. */
  | { readonly status: "in_sage" }
  /**
   * Compass shows the new values and holds them; the Sage request follows on
   * its own once Compass has read the record from Sage, or once the write
   * Sage is running now finishes.
   */
  | { readonly status: "queued"; readonly reason: "reading_sage" | "sage_writing" }
  /**
   * Compass shows the new values; nothing goes to Sage because the record is
   * not linked to a verified Sage record, or Sage contact sync is not set up
   * (then the values are held so Sage's lists cannot put old ones back).
   */
  | { readonly status: "compass_only"; readonly reason: "not_linked" | "sync_off" }
  | { readonly status: "blocked"; readonly error: string }

type HoldingRow = typeof sageContactChangeProposals.$inferSelect

/** Stand-in base revision of a request planned before Compass ever read the record. */
const UNREAD_REVISION = "unread"

const SAGE_READ_ACTOR: ActivityActor = {
  id: null, email: "sage", displayName: "Sage read", firstName: null, lastName: null, role: "system",
}

function cleanValue(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

/** What Sage should end up holding: each unfinished change's new values, oldest first. */
function desiredValues(rows: readonly HoldingRow[]): Record<string, string | null> {
  const desired: Record<string, string | null> = {}
  for (const row of rows) {
    for (const change of parseSageChanges(row.changesJson) ?? []) desired[change.field] = change.after
  }
  return desired
}

/** The desired values Sage does not hold yet (a field Sage's read lacks counts as differing). */
function differingFromSage(
  desired: Readonly<Record<string, string | null>>,
  sageFields: Readonly<Record<string, string | null | undefined>>
): Record<string, string | null> {
  return Object.fromEntries(Object.entries(desired).filter(([field, value]) =>
    !Object.prototype.hasOwnProperty.call(sageFields, field) || cleanValue(sageFields[field]) !== value))
}

function isPersonKind(kind: SageContactKind): boolean {
  return kind === "client_person" || kind === "vendor_person"
}

/** True when the stored Sage read is of the record Compass links to now. */
function snapshotMatches(
  snapshot: SageContactSnapshot | null,
  identity: { readonly sageRecordId: string; readonly parentSageRecordId: string | null }
): snapshot is SageContactSnapshot {
  return snapshot !== null && sameSageRecordId(snapshot.sageRecordId, identity.sageRecordId) &&
    sameSageRecordId(snapshot.parentSageRecordId, identity.parentSageRecordId)
}

async function applyInCompass(
  context: SageProposalContext,
  kind: SageLinkedEditKind,
  entityId: string,
  values: Readonly<Record<string, string | null>>,
  now: string,
  outcome: SageEditRequestOutcome
): Promise<SageEditRequestOutcome> {
  const applied = await applySageLinkedValuesInCompass(context.db, context.organizationId, kind, entityId, values, now)
  return applied.success ? outcome : { status: "blocked", error: applied.error }
}

/**
 * An inline edit of Sage-shared fields. Compass always takes the new values
 * at once; only what happens on the Sage side depends on the Sage link:
 *
 * - Not linked to a verified Sage record: Compass only. No Sage read path
 *   touches a record without a Sage id, so nothing needs holding.
 * - Sage contact sync not set up: Compass only, but the values are held by a
 *   "queued" change so Sage's daily vendor list cannot put old ones back.
 * - Never read from Sage, or Sage is writing an earlier change right now:
 *   the values are held by a "queued" change and a read is asked for; the
 *   request is planned and sent for review on its own once the read or the
 *   running write lands (advanceQueuedSageChanges).
 * - Otherwise the record's one Sage change request is planned against the
 *   last Sage read (its before-values and revision). Editing again replaces
 *   the waiting request instead of adding one. Approval still needs a fresh
 *   read and a different person, so a read is queued when the last is old.
 *
 * While a request is unfinished its fields are held (sage-held-fields.ts):
 * Sage → Compass syncs leave them alone.
 */
export async function requestSageEditFromCompass(
  context: SageProposalContext,
  kind: SageLinkedEditKind,
  entityId: string,
  changes: Readonly<Partial<Record<string, string | null>>>
): Promise<SageEditRequestOutcome> {
  const proposed: Record<string, string | null> = {}
  for (const [field, value] of Object.entries(changes)) proposed[field] = cleanValue(value)
  const { db, organizationId, user, env } = context
  const found = await getSageContactEntityIdentity(db, organizationId, kind, entityId)
  if (!found) return { status: "blocked", error: "This record was not found." }
  await requireSageContactEditAccess(user, kind, found.linkedUserId, proposed)
  const now = new Date().toISOString()
  const sageRecordId = found.sageRecordId
  // A Sage person also needs its company's verified Sage id to be addressed in Sage.
  if (!sageRecordId || (isPersonKind(kind) && !found.parentSageRecordId)) {
    return applyInCompass(context, kind, entityId, proposed, now, { status: "compass_only", reason: "not_linked" })
  }
  const identity = { ...found, sageRecordId }
  const configured = sageContactOrganizationMatches(env, organizationId)
  const rows = await holdingSageChanges(db, organizationId, kind, entityId)
  const running = rows.find((row) => row.status === "running")
  // The running write is left alone; every other unfinished change folds into this one.
  const others = rows.filter((row) => row.status !== "running")
  const desired = { ...desiredValues(others), ...proposed }
  const snapshotRow = configured ? await latestSageSnapshot(db, organizationId, kind, entityId) : undefined
  const parsedSnapshot = snapshotRow ? sageSnapshotFromRow(snapshotRow) : null
  // A read of a record Compass no longer links to counts as no read.
  const snapshot = snapshotMatches(parsedSnapshot, identity) ? parsedSnapshot : null
  if (configured && snapshotRow && (!snapshot || !isRecentSageRead(snapshotRow.capturedAt))) {
    await queueSageRead(context, kind, entityId, identity)
  }
  if (!configured || running || !snapshot) {
    if (configured && !snapshotRow) await queueSageRead(context, kind, entityId, identity)
    const outcome: SageEditRequestOutcome = !configured
      ? { status: "compass_only", reason: "sync_off" }
      : { status: "queued", reason: running ? "sage_writing" : "reading_sage" }
    return deferSageEdit(context, kind, entityId, { identity, snapshot, others, desired, proposed, now, outcome })
  }

  const toRequest = differingFromSage(desired, snapshot.fields)
  let plan: SageContactProposalPlan | null = null
  if (Object.keys(toRequest).length > 0) {
    const planned = planSageContactChange({ snapshot, proposed: toRequest, allowUnreadExtended: true })
    if (!planned.success) return { status: "blocked", error: planned.error }
    plan = planned.plan
  }
  const [only] = others
  const waiting = others.length === 1 && only && (only.status === "pending" || only.status === "approved") ? only : undefined
  if (waiting && plan && sameRequestedChanges(parseSageChanges(waiting.changesJson) ?? [], toRequest)) {
    return applyInCompass(context, kind, entityId, proposed, now, { status: "already_requested" })
  }

  const id = crypto.randomUUID()
  const statements: BatchItem<"sqlite">[] = [
    ...others.flatMap((row) => closeSageChangeStatements(db, {
      organizationId, actorUserId: user.id, proposal: row,
      status: plan ? "superseded" : "withdrawn", supersededBy: plan ? id : undefined, now,
    })),
    ...(plan ? insertProposalStatements(db, {
      id, entityId, plan, status: "pending", requestedByUserId: user.id, replaces: others.at(-1)?.id ?? null, now,
    }) : []),
  ]
  const [first, ...rest] = statements
  if (first) {
    try {
      // The request (which holds the fields) lands before Compass changes.
      await db.batch([first, ...rest])
    } catch {
      return { status: "blocked", error: "The Sage change for this record changed while saving. Reload and try again." }
    }
  }
  const applied = await applySageLinkedValuesInCompass(db, organizationId, kind, entityId, proposed, now)
  if (!applied.success) return { status: "blocked", error: applied.error }
  const replaced = others.at(-1)
  if (plan) {
    await recordSageChangeActivity(db, {
      organizationId, actor: user, kind, entityId, proposalId: id,
      step: replaced ? "updated" : "requested", changes: plan.changes,
    })
    return replaced ? { status: "updated", proposalId: id } : { status: "requested", proposalId: id }
  }
  if (replaced) {
    await recordSageChangeActivity(db, {
      organizationId, actor: user, kind, entityId, proposalId: replaced.id, step: "withdrawn",
      changes: parseSageChanges(replaced.changesJson) ?? [],
    })
  }
  return { status: "in_sage" }
}

function insertProposalStatements(
  db: Db,
  input: {
    readonly id: string
    readonly entityId: string
    readonly plan: SageContactProposalPlan
    readonly status: "pending" | "queued"
    readonly requestedByUserId: string
    readonly actorUserId?: string | null
    readonly replaces: string | null
    readonly now: string
  }
): BatchItem<"sqlite">[] {
  const { id, plan, now } = input
  return [
    insertSageContactChangeProposal(db, {
      id, organizationId: plan.organizationId, kind: plan.kind, entityId: input.entityId,
      sageRecordId: plan.sageRecordId,
      parentSageRecordId: plan.parentSageRecordId,
      baseRevision: plan.baseRevision,
      changesJson: JSON.stringify(plan.changes),
      status: input.status, requestedByUserId: input.requestedByUserId,
      requestedAt: now, updatedAt: now,
    }),
    insertSageContactChangeEvent(db, {
      id: crypto.randomUUID(), proposalId: id, organizationId: plan.organizationId,
      actorUserId: input.actorUserId === undefined ? input.requestedByUserId : input.actorUserId,
      eventType: input.status === "queued" ? "queued" : "proposed",
      detailJson: JSON.stringify({ baseRevision: plan.baseRevision, replaces: input.replaces }),
      createdAt: now,
    }),
  ]
}

/**
 * Holds an edit whose Sage request cannot be planned or sent yet: one
 * "queued" change carries every unfinished new value of the record (except
 * the write Sage is running), planned against the last Sage read or, before
 * any read, against unknown before-values. It is replanned before review.
 */
async function deferSageEdit(
  context: SageProposalContext,
  kind: SageLinkedEditKind,
  entityId: string,
  input: {
    readonly identity: SageContactEntityIdentity & { readonly sageRecordId: string }
    readonly snapshot: SageContactSnapshot | null
    readonly others: readonly HoldingRow[]
    readonly desired: Readonly<Record<string, string | null>>
    readonly proposed: Readonly<Record<string, string | null>>
    readonly now: string
    readonly outcome: SageEditRequestOutcome
  }
): Promise<SageEditRequestOutcome> {
  const { db, organizationId, user } = context
  const { identity, snapshot, others, desired, now } = input
  const base: SageContactSnapshot = snapshot ?? {
    organizationId, kind, sageRecordId: identity.sageRecordId, parentSageRecordId: identity.parentSageRecordId,
    revision: UNREAD_REVISION,
    fields: Object.fromEntries(sageContactProposalFields(kind).map((field) => [field, null])),
  }
  // Before any read, a blank value has nothing to ask Sage for.
  const toRequest = snapshot
    ? differingFromSage(desired, snapshot.fields)
    : Object.fromEntries(Object.entries(desired).filter(([, value]) => value !== null))
  let plan: SageContactProposalPlan | null = null
  if (Object.keys(toRequest).length > 0) {
    const planned = planSageContactChange({ snapshot: base, proposed: toRequest, allowUnreadExtended: true })
    if (!planned.success) return { status: "blocked", error: planned.error }
    plan = { ...planned.plan, organizationId }
  }
  const id = crypto.randomUUID()
  const statements: BatchItem<"sqlite">[] = [
    ...others.flatMap((row) => closeSageChangeStatements(db, {
      organizationId, actorUserId: user.id, proposal: row,
      status: plan ? "superseded" : "withdrawn", supersededBy: plan ? id : undefined, now,
    })),
    ...(plan ? insertProposalStatements(db, {
      id, entityId, plan, status: "queued", requestedByUserId: user.id, replaces: others.at(-1)?.id ?? null, now,
    }) : []),
  ]
  const [first, ...rest] = statements
  if (first) {
    try {
      await db.batch([first, ...rest])
    } catch {
      return { status: "blocked", error: "The Sage change for this record changed while saving. Reload and try again." }
    }
  }
  const applied = await applySageLinkedValuesInCompass(db, organizationId, kind, entityId, input.proposed, now)
  if (!applied.success) return { status: "blocked", error: applied.error }
  if (plan) {
    await recordSageChangeActivity(db, {
      organizationId, actor: user, kind, entityId, proposalId: id, step: "queued", changes: plan.changes,
    })
  }
  return input.outcome
}

/** Unfinished states that wait on Sage or on staff, so a queued change keeps waiting. */
const BUSY_STATUSES: ReadonlySet<string> = new Set(["running", "approved", "conflict", "failed"])

/**
 * After a Sage read or write of a record lands: a change that was waiting
 * (queued, or pending against an older Sage read) becomes one pending
 * request planned against the newest read, for review by a different staff
 * member as usual. It is still requested by the person who saved it. Waits
 * while Sage is writing, an approved write is not yet claimed, or a failed
 * write is waiting for staff to retry or reject it. Never throws.
 */
export async function advanceQueuedSageChanges(
  db: Db,
  env: object,
  organizationId: string,
  kind: SageContactKind,
  entityId: string
): Promise<void> {
  try {
    if (!sageContactOrganizationMatches(env, organizationId)) return
    const rows = await holdingSageChanges(db, organizationId, kind, entityId)
    const latest = rows.at(-1)
    if (!latest || rows.some((row) => BUSY_STATUSES.has(row.status))) return
    const snapshotRow = await latestSageSnapshot(db, organizationId, kind, entityId)
    const snapshot = snapshotRow ? sageSnapshotFromRow(snapshotRow) : null
    if (!snapshot) return
    if (!rows.some((row) => row.status === "queued" || row.baseRevision !== snapshot.revision)) return
    const identity = await getSageContactEntityIdentity(db, organizationId, kind, entityId)
    const sageRecordId = identity?.sageRecordId
    if (!identity || !sageRecordId ||
      !snapshotMatches(snapshot, { sageRecordId, parentSageRecordId: identity.parentSageRecordId })) return
    const toRequest = differingFromSage(desiredValues(rows), snapshot.fields)
    let plan: SageContactProposalPlan | null = null
    if (Object.keys(toRequest).length > 0) {
      const planned = planSageContactChange({ snapshot, proposed: toRequest, allowUnreadExtended: true })
      // An invalid value stays held in Compass; staff see it pending and can edit it.
      if (!planned.success) return
      plan = planned.plan
    }
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const [first, ...rest]: BatchItem<"sqlite">[] = [
      ...rows.flatMap((row) => closeSageChangeStatements(db, {
        organizationId, actorUserId: null, proposal: row,
        status: plan ? "superseded" : "withdrawn", supersededBy: plan ? id : undefined, now,
      })),
      ...(plan ? insertProposalStatements(db, {
        id, entityId, plan, status: "pending", requestedByUserId: latest.requestedByUserId,
        actorUserId: null, replaces: latest.id, now,
      }) : []),
    ]
    if (!first) return
    try {
      await db.batch([first, ...rest])
    } catch {
      return
    }
    await recordSageChangeActivity(db, {
      organizationId, actor: SAGE_READ_ACTOR, kind, entityId,
      proposalId: plan ? id : latest.id, step: plan ? "updated" : "withdrawn",
      changes: plan ? plan.changes : parseSageChanges(latest.changesJson) ?? [],
    })
  } catch (error) {
    console.error("Could not send a waiting Sage change for review", error)
  }
}
