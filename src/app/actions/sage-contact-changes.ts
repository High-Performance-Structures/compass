"use server"

import { and, desc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { customerContacts, customers, internalContacts, users, vendorContacts, vendors } from "@/db/schema"
import {
  sageContactChangeProposals,
  sageContactReadRequests,
  sageContactSnapshots,
} from "@/db/schema-sage"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import {
  insertSageContactReadRequest,
  reviewSageContactChangeStatements,
} from "@/lib/domain/sage-bridge/contact-store"
import { isDemoUser } from "@/lib/demo"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { sageContactReviewerAllowed } from "@/lib/feature-settings/sage-contact-review-settings"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { requireOrg } from "@/lib/org-scope"
import {
  isPrivateEmployeeContactField,
  sageContactProposalFields,
  type SageContactFieldChange,
  type SageContactKind,
} from "@/lib/sage/contact-change-proposal"
import { prepareApprovedSageChange, replanSageChange } from "@/lib/sage/contact-change-readiness"
import { getSageContactEntityIdentity } from "@/lib/sage/contact-entity"
import {
  isSageReviewListStatus,
  plainSageProblem,
  SAGE_REVIEW_LIST_STATUSES,
  sageContactKindLabel,
  sageRequesterName,
  sageReviewState,
  sortForSageReview,
  type SageReviewListStatus,
  type SageReviewState,
} from "@/lib/sage/contact-proposal-review-list"
import {
  advanceQueuedSageChanges,
  canAccessEmployeePrivate,
  createSageContactProposal,
  isRecentSageRead,
  latestSageSnapshot,
  parseSageChanges,
  recordSageChangeActivity,
  requireSageContactEditAccess,
  sageSnapshotFromRow,
} from "@/lib/sage/contact-proposal-service"
import { sageContactOrganizationMatches } from "@/lib/sage/contact-bridge"
import type { SageLinkedEditKind } from "@/lib/sage/sage-linked-edit-fields"
import { heldSageFields } from "@/lib/sage/sage-held-fields"
import { applySageLinkedValuesInCompass } from "@/lib/sage/sage-linked-local-apply"
import { orgContext, requireUserContext, type Db } from "@/lib/server/action-context"
import { sameSageRecordId } from "@/lib/sage/record-id"

const kindSchema = z.enum([
  "client_company", "client_person", "vendor_company", "vendor_person", "employee",
])
const fieldsSchema = z.record(z.string(), z.string().nullable())
const changesSchema = z.array(z.object({
  field: z.string(), before: z.string().nullable(), after: z.string().nullable(),
}))

type ActionResult =
  | { readonly success: true; readonly id: string; readonly status: string }
  | { readonly success: false; readonly error: string }

export type SageContactProposalListItem = {
  readonly id: string
  readonly kind: SageContactKind
  /** "Client", "Vendor contact", ... */
  readonly kindLabel: string
  readonly entityId: string
  /** The directory record's current Compass name, for the reviewer. */
  readonly entityName: string | null
  readonly status: SageReviewListStatus
  readonly state: SageReviewState
  readonly changes: readonly SageContactFieldChange[]
  readonly requestedByName: string
  readonly requestedAt: string
  readonly reviewNote: string | null
  /** Why a request needs attention, in plain English. */
  readonly problem: string | null
}

export type MySageContactProposalStatus = {
  readonly id: string
  readonly kind: string
  readonly entityId: string
  readonly status: string
  readonly requestedAt: string
  readonly errorMessage: string | null
  readonly reviewNote: string | null
}

export async function listMySageContactProposalStatuses(): Promise<readonly MySageContactProposalStatus[]> {
  const { user, db } = await requireUserContext()
  if (!user.isActive) return []
  const orgId = requireOrg(user)
  return db.select({
    id: sageContactChangeProposals.id,
    kind: sageContactChangeProposals.kind,
    entityId: sageContactChangeProposals.entityId,
    status: sageContactChangeProposals.status,
    requestedAt: sageContactChangeProposals.requestedAt,
    errorMessage: sageContactChangeProposals.errorMessage,
    reviewNote: sageContactChangeProposals.reviewNote,
  }).from(sageContactChangeProposals).where(and(
    eq(sageContactChangeProposals.organizationId, orgId),
    eq(sageContactChangeProposals.requestedByUserId, user.id)
  )).orderBy(desc(sageContactChangeProposals.requestedAt)).limit(20)
}

export type SageContactEditorState = {
  readonly linked: boolean
  readonly capturedAt: string | null
  readonly fresh: boolean
  readonly refreshStatus: string | null
  readonly fields: Readonly<Record<string, string | null>>
  readonly editableFields: readonly string[]
}

export async function getSageContactEditorState(
  kindInput: string,
  entityId: string
): Promise<SageContactEditorState | null> {
  const user = await requireAuth()
  const kind = kindSchema.safeParse(kindInput)
  if (!kind.success || !entityId.trim()) return null
  const orgId = requireOrg(user)
  const { env } = await getCloudflareContext()
  if (!sageContactOrganizationMatches(env, orgId)) return null
  const db = getDb(env.DB)
  const identity = await getSageContactEntityIdentity(db, orgId, kind.data, entityId)
  if (!identity) return null
  await requireSageContactEditAccess(user, kind.data, identity.linkedUserId, {})
  const [snapshotRow, refreshRow] = await Promise.all([
    db.select().from(sageContactSnapshots).where(and(
      eq(sageContactSnapshots.organizationId, orgId),
      eq(sageContactSnapshots.kind, kind.data),
      eq(sageContactSnapshots.entityId, entityId)
    )).get(),
    db.select({ status: sageContactReadRequests.status })
      .from(sageContactReadRequests).where(and(
        eq(sageContactReadRequests.organizationId, orgId),
        eq(sageContactReadRequests.kind, kind.data),
        eq(sageContactReadRequests.entityId, entityId)
      )).orderBy(desc(sageContactReadRequests.requestedAt)).limit(1).get(),
  ])
  const snapshot = snapshotRow ? sageSnapshotFromRow(snapshotRow) : null
  const canSeePrivate = kind.data !== "employee" ||
    await canAccessEmployeePrivate(user, identity.linkedUserId)
  const editableFields = sageContactProposalFields(kind.data).filter((field) =>
    canSeePrivate || !isPrivateEmployeeContactField(field)
  )
  const fields: Record<string, string | null> = {}
  if (snapshot && sameSageRecordId(snapshot.sageRecordId, identity.sageRecordId) &&
    sameSageRecordId(snapshot.parentSageRecordId, identity.parentSageRecordId)) {
    for (const field of editableFields) {
      if (Object.prototype.hasOwnProperty.call(snapshot.fields, field)) {
        fields[field] = snapshot.fields[field] ?? null
      }
    }
  }
  return {
    linked: Boolean(identity.sageRecordId),
    capturedAt: snapshotRow?.capturedAt ?? null,
    fresh: Boolean(snapshotRow && snapshot && isRecentSageRead(snapshotRow.capturedAt) &&
      sameSageRecordId(snapshot.sageRecordId, identity.sageRecordId) &&
      sameSageRecordId(snapshot.parentSageRecordId, identity.parentSageRecordId)),
    refreshStatus: refreshRow?.status ?? null,
    fields,
    editableFields,
  }
}

export async function requestSageContactRefresh(
  kindInput: string,
  entityId: string
): Promise<ActionResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    const kind = kindSchema.safeParse(kindInput)
    if (!kind.success || !entityId.trim()) return { success: false, error: "Invalid contact" }
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!sageContactOrganizationMatches(env, orgId)) {
      return { success: false, error: "Sage contact sync is not configured for this organization." }
    }
    const db = getDb(env.DB)
    const identity = await getSageContactEntityIdentity(db, orgId, kind.data, entityId)
    if (!identity?.sageRecordId) {
      return { success: false, error: "Review and link the stable Sage record ID before refreshing this contact." }
    }
    if ((kind.data === "client_person" || kind.data === "vendor_person") &&
      !identity.parentSageRecordId) {
      return { success: false, error: "Link the Sage parent company before refreshing this person." }
    }
    await requireSageContactEditAccess(user, kind.data, identity.linkedUserId, {})
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    await insertSageContactReadRequest(db, {
      id, organizationId: orgId, kind: kind.data, entityId,
      sageRecordId: identity.sageRecordId,
      sageRecordNumber: identity.sageRecordNumber,
      parentSageRecordId: identity.parentSageRecordId,
      status: "queued", requestedByUserId: user.id, requestedAt: now,
    })
    revalidatePath("/dashboard/contacts")
    return { success: true, id, status: "queued" }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not request a Sage refresh" }
  }
}

export async function proposeSageContactChange(
  kindInput: string,
  entityId: string,
  proposed: Readonly<Record<string, string | null>>
): Promise<ActionResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    const kind = kindSchema.safeParse(kindInput)
    if (!kind.success || !entityId.trim()) return { success: false, error: "Invalid contact" }
    const submitted = fieldsSchema.safeParse(proposed)
    if (!submitted.success) return { success: false, error: "Invalid contact fields" }
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const result = await createSageContactProposal(
      { user, organizationId: orgId, db: getDb(env.DB), env }, kind.data, entityId, submitted.data
    )
    if (result.success) revalidatePath("/dashboard/contacts")
    return result
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not propose contact change" }
  }
}

/**
 * The review list: requests waiting for a decision or needing attention, and
 * approved ones on their way to Sage. Finished ones stay in Activity.
 */
export async function listSageContactChangeProposals(): Promise<readonly SageContactProposalListItem[]> {
  const { user, db } = await requireUserContext()
  const orgId = requireOrg(user)
  await requireFeaturePermission(user, "sage-contact-review", "read")
  const rows = await db.select().from(sageContactChangeProposals)
    .where(and(
      eq(sageContactChangeProposals.organizationId, orgId),
      inArray(sageContactChangeProposals.status, [...SAGE_REVIEW_LIST_STATUSES])
    ))
    .orderBy(desc(sageContactChangeProposals.requestedAt)).limit(100)
  const privateAccess = await canAccessEmployeePrivate(user, null)
  const [names, requesters] = await Promise.all([
    directoryNames(db, orgId, rows.map((row) => row.entityId)),
    requesterNames(db, rows.map((row) => row.requestedByUserId)),
  ])
  const result: SageContactProposalListItem[] = []
  for (const row of rows) {
    const state = sageReviewState(row.status)
    if (!state || !isSageReviewListStatus(row.status)) continue
    const kind = kindSchema.safeParse(row.kind)
    let parsed: unknown
    try { parsed = JSON.parse(row.changesJson) } catch { continue }
    const changes = changesSchema.safeParse(parsed)
    if (!kind.success || !changes.success) continue
    if (kind.data === "employee" && !privateAccess && changes.data.some((change) =>
      isPrivateEmployeeContactField(change.field)
    )) continue
    result.push({
      id: row.id, kind: kind.data, kindLabel: sageContactKindLabel(kind.data), entityId: row.entityId,
      entityName: names.get(row.entityId) ?? null,
      status: row.status,
      state,
      changes: changes.data.filter((change): change is SageContactFieldChange =>
        isSageContactFieldChange(change.field, kind.data)
      ),
      requestedByName: requesters.get(row.requestedByUserId) ?? sageRequesterName(null),
      requestedAt: row.requestedAt,
      reviewNote: row.reviewNote,
      problem: state.stage === "fix" ? plainSageProblem(row.errorMessage) : null,
    })
  }
  return sortForSageReview(result)
}

/** "Requested … by <name>" names of the requesting staff, by user id. */
async function requesterNames(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const people = await db.select({
    id: users.id, displayName: users.displayName, firstName: users.firstName, lastName: users.lastName, email: users.email,
  }).from(users).where(inArray(users.id, unique))
  return new Map(people.map((person) => [person.id, sageRequesterName(person)]))
}

/** Current Compass names of the proposals' directory records, by id. */
async function directoryNames(db: Db, organizationId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)]
  const names = new Map<string, string>()
  if (unique.length === 0) return names
  const [vendorRows, customerRows, vendorPeople, customerPeople, staff] = await Promise.all([
    db.select({ id: vendors.id, name: vendors.name }).from(vendors)
      .where(and(eq(vendors.organizationId, organizationId), inArray(vendors.id, unique))),
    db.select({ id: customers.id, name: customers.name }).from(customers)
      .where(and(eq(customers.organizationId, organizationId), inArray(customers.id, unique))),
    db.select({ id: vendorContacts.id, name: vendorContacts.name, company: vendors.name }).from(vendorContacts)
      .innerJoin(vendors, eq(vendorContacts.vendorId, vendors.id))
      .where(and(eq(vendors.organizationId, organizationId), inArray(vendorContacts.id, unique))),
    db.select({ id: customerContacts.id, name: customerContacts.name, company: customers.name }).from(customerContacts)
      .innerJoin(customers, eq(customerContacts.customerId, customers.id))
      .where(and(eq(customers.organizationId, organizationId), inArray(customerContacts.id, unique))),
    db.select({ id: internalContacts.id, name: internalContacts.name }).from(internalContacts)
      .where(and(eq(internalContacts.organizationId, organizationId), inArray(internalContacts.id, unique))),
  ])
  for (const row of [...vendorRows, ...customerRows, ...staff]) names.set(row.id, row.name)
  for (const row of [...vendorPeople, ...customerPeople]) names.set(row.id, `${row.name} (${row.company})`)
  return names
}

function isSageContactFieldChange(field: string, kind: SageContactKind): field is SageContactFieldChange["field"] {
  return sageContactProposalFields(kind).some((known) => known === field)
}

/**
 * Puts Sage's values back in Compass for the fields of a rejected change:
 * Sage's last read, or the change's own before-value when that read lacks
 * the field. True when Compass was updated.
 */
async function revertToSageValues(
  db: Db,
  organizationId: string,
  kind: SageLinkedEditKind,
  entityId: string,
  changes: readonly SageContactFieldChange[],
  now: string
): Promise<boolean> {
  const snapshotRow = await db.select().from(sageContactSnapshots).where(and(
    eq(sageContactSnapshots.organizationId, organizationId),
    eq(sageContactSnapshots.kind, kind),
    eq(sageContactSnapshots.entityId, entityId)
  )).get()
  const sageFields: Readonly<Record<string, string | null | undefined>> =
    (snapshotRow ? sageSnapshotFromRow(snapshotRow)?.fields : undefined) ?? {}
  // A newer Compass edit still waiting for Sage keeps its own value.
  const stillHeld = await heldSageFields(db, organizationId, kind, entityId)
  const values: Record<string, string | null> = {}
  for (const change of changes.filter((item) => !stillHeld.has(item.field))) {
    values[change.field] = Object.prototype.hasOwnProperty.call(sageFields, change.field)
      ? sageFields[change.field] ?? null
      : change.before
  }
  const applied = await applySageLinkedValuesInCompass(db, organizationId, kind, entityId, values, now)
  return applied.success
}

/** "approved" (the writer takes it next), "checking_sage" (a fresh read comes first) or "conflict". */
async function approvedOutcome(db: Db, database: D1Database, proposalId: string): Promise<string> {
  const approved = await db.select().from(sageContactChangeProposals).where(and(
    eq(sageContactChangeProposals.id, proposalId), eq(sageContactChangeProposals.status, "approved")
  )).get()
  if (!approved) return "approved"
  const readiness = await prepareApprovedSageChange(db, database, approved)
  return readiness.state === "ready" || readiness.state === "gone" ? "approved" : readiness.state
}

export async function reviewSageContactChange(
  proposalId: string,
  decision: "approve" | "reject",
  note = ""
): Promise<ActionResult> {
  try {
    if (decision !== "approve" && decision !== "reject") {
      return { success: false, error: "Invalid Sage contact review decision." }
    }
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(user, "sage-contact-review", "approve")
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!sageContactOrganizationMatches(env, orgId)) {
      return { success: false, error: "Sage contact sync is not configured for this organization." }
    }
    if (decision === "approve" && Reflect.get(env, "SAGE_CONTACT_WRITES_ENABLED") !== "true") {
      return { success: false, error: "Sage contact writes are paused. Approval is unavailable until the bridge is validated and enabled." }
    }
    const db = getDb(env.DB)
    // A write that failed or did not read back can still be rejected (never approved again).
    const fromStatuses = decision === "approve" ? ["pending"] as const : ["pending", "conflict", "failed"] as const
    const proposal = await db.select().from(sageContactChangeProposals).where(and(
      eq(sageContactChangeProposals.id, proposalId),
      eq(sageContactChangeProposals.organizationId, orgId),
      inArray(sageContactChangeProposals.status, [...fromStatuses])
    )).get()
    if (!proposal) return { success: false, error: "Proposal is no longer pending." }
    // The requester may decide their own request unless the company requires
    // a second approver (Settings > Workflows > Sage contact review).
    if (!sageContactReviewerAllowed(
      await readFeatureSettings(db, orgId, "sage-contact-review"), proposal.requestedByUserId, user.id
    )) {
      return { success: false, error: "Your company requires another staff member to review this contact change." }
    }
    const kind = kindSchema.safeParse(proposal.kind)
    let parsed: unknown
    try { parsed = JSON.parse(proposal.changesJson) } catch { parsed = null }
    const changes = changesSchema.safeParse(parsed)
    if (!kind.success || !changes.success || changes.data.length === 0 ||
      changes.data.some((change) => !isSageContactFieldChange(change.field, kind.data))) {
      return { success: false, error: "Stored proposal is invalid." }
    }
    if (kind.data === "employee" && changes.data.some((change) =>
      isPrivateEmployeeContactField(change.field)
    )) {
      await requireFeaturePermission(user, "employee-contact-private", "approve")
    }
    const now = new Date().toISOString()
    const status = decision === "approve" ? "approved" : "rejected"
    const noteValue = note.trim().slice(0, 1000)
    const results = await env.DB.batch(reviewSageContactChangeStatements(env.DB, {
      proposalId, organizationId: orgId, reviewerUserId: user.id, status,
      reviewNote: noteValue || null, noteJson: JSON.stringify({ note: noteValue }),
      completedAt: decision === "reject" ? now : null, now,
      fromStatuses: decision === "reject" ? [...fromStatuses] : undefined,
    }))
    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
      return { success: false, error: "Proposal was reviewed concurrently." }
    }
    const reviewed = changes.data.filter((change): change is SageContactFieldChange =>
      isSageContactFieldChange(change.field, kind.data))
    // Compass already showed the requested values; a rejection puts Sage's back.
    const reverted = decision === "reject" && kind.data !== "employee"
      ? await revertToSageValues(db, orgId, kind.data, proposal.entityId, reviewed, now)
      : false
    await recordSageChangeActivity(db, {
      organizationId: orgId, actor: user, kind: kind.data, entityId: proposal.entityId,
      proposalId, step: status, changes: reviewed, note: noteValue || null, reverted,
    })
    // A Compass edit that waited behind the rejected change now goes to review.
    if (decision === "reject") await advanceQueuedSageChanges(db, env, orgId, kind.data, proposal.entityId)
    revalidatePath("/dashboard/contacts")
    if (decision === "reject") return { success: true, id: proposalId, status }
    // Approval never waits on how old the last Sage read is: an old read
    // queues a fresh one and the change goes to Sage once it lands (or
    // becomes a conflict if Sage changed those fields meanwhile).
    return { success: true, id: proposalId, status: await approvedOutcome(db, env.DB, proposalId) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not review contact change" }
  }
}

/**
 * Sends a change that ended in conflict (or failed) to Sage again, planned
 * over Sage's last-read values: each before-value becomes what Sage held at
 * that read. It then goes through the same check as any approval: an old
 * read queues a fresh one, and if Sage changed those fields again since, it
 * comes back as a conflict naming Sage's value and the requested one.
 */
export async function reapplySageContactChange(proposalId: string): Promise<ActionResult> {
  try {
    const context = await orgContext({ feature: "sage-contact-review", action: "approve", mutation: true })
    if (!context.success) return context
    const { user, organizationId: orgId, db, env } = context.data
    if (!sageContactOrganizationMatches(env, orgId)) {
      return { success: false, error: "Sage contact sync is not configured for this organization." }
    }
    if (Reflect.get(env, "SAGE_CONTACT_WRITES_ENABLED") !== "true") {
      return { success: false, error: "Sage contact writes are paused. Reapply is unavailable until the bridge is enabled." }
    }
    const proposal = await db.select().from(sageContactChangeProposals).where(and(
      eq(sageContactChangeProposals.id, proposalId),
      eq(sageContactChangeProposals.organizationId, orgId),
      inArray(sageContactChangeProposals.status, ["conflict", "failed"])
    )).get()
    if (!proposal) return { success: false, error: "This change no longer needs attention." }
    if (!sageContactReviewerAllowed(
      await readFeatureSettings(db, orgId, "sage-contact-review"), proposal.requestedByUserId, user.id
    )) {
      return { success: false, error: "Your company requires another staff member to review this contact change." }
    }
    const kind = kindSchema.safeParse(proposal.kind)
    const changes = parseSageChanges(proposal.changesJson)
    if (!kind.success || !changes || changes.length === 0) return { success: false, error: "Stored proposal is invalid." }
    if (kind.data === "employee" && changes.some((change) => isPrivateEmployeeContactField(change.field))) {
      await requireFeaturePermission(user, "employee-contact-private", "approve")
    }
    const snapshotRow = await latestSageSnapshot(db, orgId, kind.data, proposal.entityId)
    const snapshot = snapshotRow ? sageSnapshotFromRow(snapshotRow) : null
    const base = snapshot && sameSageRecordId(snapshot.sageRecordId, proposal.sageRecordId) &&
      sameSageRecordId(snapshot.parentSageRecordId, proposal.parentSageRecordId) ? snapshot : null
    const rebased = base ? changes.map((change) =>
      Object.prototype.hasOwnProperty.call(base.fields, change.field)
        ? { ...change, before: base.fields[change.field] ?? null } : change) : changes
    const now = new Date().toISOString()
    // Plans are immutable: the conflict is superseded by an approved copy.
    const id = await replanSageChange(env.DB, proposal, {
      baseRevision: base ? base.revision : proposal.baseRevision, changes: rebased,
      reviewedByUserId: user.id, reviewedAt: now, actorUserId: user.id, eventType: "reapplied", now,
    })
    if (!id) {
      return { success: false, error: "This record has a newer change waiting, or this one was just updated. Refresh and review the newest one." }
    }
    await recordSageChangeActivity(db, {
      organizationId: orgId, actor: user, kind: kind.data, entityId: proposal.entityId,
      proposalId: id, step: "approved", changes: rebased, note: "reapplied over Sage's current values",
    })
    revalidatePath("/dashboard/contacts")
    return { success: true, id, status: await approvedOutcome(db, env.DB, id) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not reapply the Sage change" }
  }
}
