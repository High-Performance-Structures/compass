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
import { holdingSageChange } from "@/lib/sage/sage-held-fields"
import { applySageLinkedValuesInCompass } from "@/lib/sage/sage-linked-local-apply"
import type { Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"
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
    (kind === "client_person" && user.role === "client") ||
    (kind === "vendor_person" && (user.role === "supplier" || user.role === "subcontractor"))
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
    readonly step: "requested" | "updated" | "withdrawn" | "approved" | "rejected" | "succeeded" | "conflict" | "failed"
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
    readonly actorUserId: string
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
  /** Compass has never read this record from Sage; a read is queued. Save again shortly. */
  | { readonly status: "reading_sage" }
  | { readonly status: "blocked"; readonly error: string }

function cleanValue(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

/**
 * An inline edit of Sage-shared fields: Compass takes the new values at once
 * and the record's one Sage change request asks Sage for them.
 *
 * The request is planned against the last Sage read (its before-values and
 * revision); approval still needs a fresh read and a different person, so a
 * read is queued when the last one is old. While the request is unfinished
 * its fields are held (sage-held-fields.ts): Sage → Compass syncs leave them
 * alone. Editing again replaces the waiting request instead of adding one;
 * a change Sage is writing at this moment cannot be edited until it lands.
 * With no Sage read at all there are no before-values, so nothing changes
 * yet: a read is queued and the person saves again.
 */
export async function requestSageEditFromCompass(
  context: SageProposalContext,
  kind: SageLinkedEditKind,
  entityId: string,
  changes: Readonly<Partial<Record<string, string | null>>>
): Promise<SageEditRequestOutcome> {
  const proposed: Record<string, string | null> = {}
  for (const [field, value] of Object.entries(changes)) proposed[field] = cleanValue(value)
  const guard = await proposalIdentity(context, kind, entityId, proposed)
  if (!guard.success) return { status: "blocked", error: guard.error }
  const { db, organizationId, user } = context
  const open = await holdingSageChange(db, organizationId, kind, entityId)
  if (open?.status === "running") {
    return { status: "blocked", error: "Sage is writing the earlier change for this record right now. Try again in a minute." }
  }
  const snapshotRow = await latestSageSnapshot(db, organizationId, kind, entityId)
  if (!snapshotRow) {
    await queueSageRead(context, kind, entityId, guard.identity)
    return { status: "reading_sage" }
  }
  const snapshot = sageSnapshotFromRow(snapshotRow)
  if (!snapshot || !sameSageRecordId(snapshot.sageRecordId, guard.identity.sageRecordId) ||
    !sameSageRecordId(snapshot.parentSageRecordId, guard.identity.parentSageRecordId)) {
    return { status: "blocked", error: "The Sage identity changed. Refresh before editing." }
  }
  if (!isRecentSageRead(snapshotRow.capturedAt)) await queueSageRead(context, kind, entityId, guard.identity)

  // What Sage should end up holding: the waiting request's values, then this edit.
  const openChanges = open ? parseSageChanges(open.changesJson) ?? [] : []
  const desired: Record<string, string | null> = Object.fromEntries(openChanges.map((change) => [change.field, change.after]))
  Object.assign(desired, proposed)
  const sageValues: Readonly<Record<string, string | null | undefined>> = snapshot.fields
  const toRequest = Object.fromEntries(Object.entries(desired).filter(([field, value]) =>
    !Object.prototype.hasOwnProperty.call(sageValues, field) || cleanValue(sageValues[field]) !== value))
  let plan: SageContactProposalPlan | null = null
  if (Object.keys(toRequest).length > 0) {
    const planned = planSageContactChange({ snapshot, proposed: toRequest })
    if (!planned.success) return { status: "blocked", error: planned.error }
    plan = planned.plan
  }
  const now = new Date().toISOString()
  const stillWaiting = open && (open.status === "pending" || open.status === "approved")
  if (stillWaiting && plan && sameRequestedChanges(openChanges, toRequest)) {
    const applied = await applySageLinkedValuesInCompass(db, organizationId, kind, entityId, proposed, now)
    return applied.success ? { status: "already_requested" } : { status: "blocked", error: applied.error }
  }

  const id = crypto.randomUUID()
  const statements: BatchItem<"sqlite">[] = [
    ...(open ? closeSageChangeStatements(db, {
      organizationId, actorUserId: user.id, proposal: open,
      status: plan ? "superseded" : "withdrawn", supersededBy: plan ? id : undefined, now,
    }) : []),
    ...(plan ? [
      insertSageContactChangeProposal(db, {
        id, organizationId, kind, entityId,
        sageRecordId: plan.sageRecordId,
        parentSageRecordId: plan.parentSageRecordId,
        baseRevision: plan.baseRevision,
        changesJson: JSON.stringify(plan.changes),
        status: "pending", requestedByUserId: user.id,
        requestedAt: now, updatedAt: now,
      }),
      insertSageContactChangeEvent(db, {
        id: crypto.randomUUID(), proposalId: id, organizationId,
        actorUserId: user.id, eventType: "proposed",
        detailJson: JSON.stringify({ baseRevision: plan.baseRevision, replaces: open?.id ?? null }),
        createdAt: now,
      }),
    ] : []),
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
  if (plan) {
    await recordSageChangeActivity(db, {
      organizationId, actor: user, kind, entityId, proposalId: id,
      step: open ? "updated" : "requested", changes: plan.changes,
    })
    return open ? { status: "updated", proposalId: id } : { status: "requested", proposalId: id }
  }
  if (open) {
    await recordSageChangeActivity(db, {
      organizationId, actor: user, kind, entityId, proposalId: open.id, step: "withdrawn", changes: openChanges,
    })
  }
  return { status: "in_sage" }
}
