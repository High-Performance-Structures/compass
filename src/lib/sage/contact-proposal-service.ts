import "server-only"

import { and, desc, eq, inArray } from "drizzle-orm"
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
} from "@/lib/domain/sage-bridge/contact-store"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { sageContactKindSchema, sageContactOrganizationMatches } from "@/lib/sage/contact-bridge"
import { applySageContactSnapshotToCanonical } from "@/lib/sage/contact-canonical"
import {
  isPrivateEmployeeContactField,
  planSageContactChange,
  type SageContactFieldChange,
  type SageContactKind,
  type SageContactSnapshot,
} from "@/lib/sage/contact-change-proposal"
import { getSageContactEntityIdentity, type SageContactEntityIdentity } from "@/lib/sage/contact-entity"
import {
  describeSageChanges,
  sageContactActivityEntityType,
  sameRequestedChanges,
} from "@/lib/sage/sage-linked-edit-fields"
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
/** A proposal in these states holds the record's one open change request. */
export const OPEN_SAGE_CHANGE_STATUSES = ["pending", "approved", "running"] as const

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
    readonly step: "requested" | "approved" | "rejected" | "succeeded" | "conflict" | "failed"
    readonly changes: readonly SageContactFieldChange[]
    readonly note?: string | null
  }
): Promise<void> {
  if (input.kind === "employee") return
  const described = describeSageChanges(input.changes)
  const lead = {
    requested: "Requested a Sage change",
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
  ])
  await recordSageChangeActivity(db, {
    organizationId, actor: user, kind, entityId, proposalId: id,
    step: "requested", changes: plan.plan.changes,
  })
  return { success: true, id, status: "pending" }
}

/** The record's open change request, if any. */
async function openSageChangeRequest(
  db: Db,
  organizationId: string,
  kind: SageContactKind,
  entityId: string
): Promise<{ readonly id: string; readonly status: string; readonly changes: readonly SageContactFieldChange[] } | null> {
  const row = await db.select({
    id: sageContactChangeProposals.id,
    status: sageContactChangeProposals.status,
    changesJson: sageContactChangeProposals.changesJson,
  }).from(sageContactChangeProposals).where(and(
    eq(sageContactChangeProposals.organizationId, organizationId),
    eq(sageContactChangeProposals.kind, kind),
    eq(sageContactChangeProposals.entityId, entityId),
    inArray(sageContactChangeProposals.status, [...OPEN_SAGE_CHANGE_STATUSES])
  )).orderBy(desc(sageContactChangeProposals.requestedAt)).limit(1).get()
  if (!row) return null
  return { id: row.id, status: row.status, changes: parseSageChanges(row.changesJson) ?? [] }
}

export type SageEditRequestOutcome =
  /** A new request is waiting for approval. */
  | { readonly status: "requested"; readonly proposalId: string }
  /** The same request was already waiting. */
  | { readonly status: "already_requested" }
  /** Sage already holds these values. */
  | { readonly status: "in_sage" }
  /** Compass asked the Sage writer for a fresh read; save again shortly. */
  | { readonly status: "reading_sage" }
  | { readonly status: "blocked"; readonly error: string }

/**
 * Turns an inline edit of Sage-shared fields into the record's change
 * request. A fresh Sage read is required (as for "Propose Sage edit"); when
 * there is none, a read is queued and the caller asks the person to save
 * again once it lands. The writer runs every minute.
 */
export async function requestSageEditFromCompass(
  context: SageProposalContext,
  kind: SageContactKind,
  entityId: string,
  changes: Readonly<Partial<Record<string, string | null>>>
): Promise<SageEditRequestOutcome> {
  const proposed: Record<string, string | null> = {}
  for (const [field, value] of Object.entries(changes)) proposed[field] = value ?? null
  const guard = await proposalIdentity(context, kind, entityId, proposed)
  if (!guard.success) return { status: "blocked", error: guard.error }
  const { db, organizationId, user } = context
  const open = await openSageChangeRequest(db, organizationId, kind, entityId)
  if (open) {
    return sameRequestedChanges(open.changes, proposed)
      ? { status: "already_requested" }
      : { status: "blocked", error: "A Sage change for this record is already waiting. Approve or reject it before requesting another." }
  }
  const snapshotRow = await latestSageSnapshot(db, organizationId, kind, entityId)
  if (!snapshotRow || !isRecentSageRead(snapshotRow.capturedAt)) {
    const pendingRead = await db.select({ id: sageContactReadRequests.id }).from(sageContactReadRequests).where(and(
      eq(sageContactReadRequests.organizationId, organizationId),
      eq(sageContactReadRequests.kind, kind),
      eq(sageContactReadRequests.entityId, entityId),
      inArray(sageContactReadRequests.status, ["queued", "running"])
    )).limit(1).get()
    if (!pendingRead) {
      await insertSageContactReadRequest(db, {
        id: crypto.randomUUID(), organizationId, kind, entityId,
        sageRecordId: guard.identity.sageRecordId,
        sageRecordNumber: guard.identity.sageRecordNumber,
        parentSageRecordId: guard.identity.parentSageRecordId,
        status: "queued", requestedByUserId: user.id, requestedAt: new Date().toISOString(),
      })
    }
    return { status: "reading_sage" }
  }
  const snapshot = sageSnapshotFromRow(snapshotRow)
  if (!snapshot || !sameSageRecordId(snapshot.sageRecordId, guard.identity.sageRecordId) ||
    !sameSageRecordId(snapshot.parentSageRecordId, guard.identity.parentSageRecordId)) {
    return { status: "blocked", error: "The Sage identity changed. Refresh before editing." }
  }
  // Values Sage already holds need no request: the fresh read confirms them,
  // so Compass takes them now. The rest become the change request.
  const sageValues: Readonly<Record<string, string | null | undefined>> = snapshot.fields
  const inSage = Object.keys(proposed).filter((field) =>
    Object.prototype.hasOwnProperty.call(sageValues, field) &&
    (sageValues[field]?.trim() || null) === proposed[field])
  if (inSage.length > 0) {
    const applied = await applySageContactSnapshotToCanonical(context.env.DB, organizationId, guard.identity, {
      ...snapshot, sageRecordNumber: guard.identity.sageRecordNumber, entityId,
    }, inSage)
    if (!applied.success) return { status: "blocked", error: applied.error }
  }
  const remaining = Object.fromEntries(Object.entries(proposed).filter(([field]) => !inSage.includes(field)))
  if (Object.keys(remaining).length === 0) return { status: "in_sage" }
  const result = await createSageContactProposal(context, kind, entityId, remaining)
  if (result.success) return { status: "requested", proposalId: result.id }
  return { status: "blocked", error: result.error }
}
