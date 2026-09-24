"use server"

import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { getDb } from "@/db"
import {
  sageContactChangeEvents,
  sageContactChangeProposals,
  sageContactReadRequests,
  sageContactSnapshots,
} from "@/db/schema-sage"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { requireOrg } from "@/lib/org-scope"
import {
  isPrivateEmployeeContactField,
  isSageContactProposalCurrent,
  planSageContactChange,
  sageContactProposalFields,
  type SageContactFieldChange,
  type SageContactKind,
  type SageContactSnapshot,
} from "@/lib/sage/contact-change-proposal"
import { getSageContactEntityIdentity } from "@/lib/sage/contact-entity"
import { sageContactOrganizationMatches } from "@/lib/sage/contact-bridge"
import { isInternalStaffRole } from "@/lib/user-roles"

const kindSchema = z.enum([
  "client_company", "client_person", "vendor_company", "vendor_person", "employee",
])
const fieldsSchema = z.record(z.string(), z.string().nullable())
const changesSchema = z.array(z.object({
  field: z.string(), before: z.string().nullable(), after: z.string().nullable(),
}))
const SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000

type ActionResult =
  | { readonly success: true; readonly id: string; readonly status: string }
  | { readonly success: false; readonly error: string }

export type SageContactProposalListItem = {
  readonly id: string
  readonly kind: SageContactKind
  readonly entityId: string
  readonly status: string
  readonly changes: readonly SageContactFieldChange[]
  readonly requestedByUserId: string
  readonly reviewedByUserId: string | null
  readonly requestedAt: string
  readonly reviewNote: string | null
  readonly errorMessage: string | null
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
  const user = await requireAuth()
  if (!user.isActive) return []
  const orgId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
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

function isRecent(iso: string): boolean {
  const value = Date.parse(iso)
  return Number.isFinite(value) && value <= Date.now() &&
    Date.now() - value <= SNAPSHOT_MAX_AGE_MS
}

function snapshotFromRow(row: typeof sageContactSnapshots.$inferSelect): SageContactSnapshot | null {
  let parsed: unknown
  try { parsed = JSON.parse(row.fieldsJson) } catch { return null }
  const fields = fieldsSchema.safeParse(parsed)
  const kind = kindSchema.safeParse(row.kind)
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
  await requireEditAccess(user, kind.data, identity.linkedUserId, {})
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
  const snapshot = snapshotRow ? snapshotFromRow(snapshotRow) : null
  const canSeePrivate = kind.data !== "employee" ||
    await canAccessEmployeePrivate(user, identity.linkedUserId)
  const editableFields = sageContactProposalFields(kind.data).filter((field) =>
    canSeePrivate || !isPrivateEmployeeContactField(field)
  )
  const fields: Record<string, string | null> = {}
  if (snapshot && snapshot.sageRecordId === identity.sageRecordId &&
    snapshot.parentSageRecordId === identity.parentSageRecordId) {
    for (const field of editableFields) {
      if (Object.prototype.hasOwnProperty.call(snapshot.fields, field)) {
        fields[field] = snapshot.fields[field] ?? null
      }
    }
  }
  return {
    linked: Boolean(identity.sageRecordId || identity.sageRecordNumber),
    capturedAt: snapshotRow?.capturedAt ?? null,
    fresh: Boolean(snapshotRow && snapshot && isRecent(snapshotRow.capturedAt) &&
      snapshot.sageRecordId === identity.sageRecordId &&
      snapshot.parentSageRecordId === identity.parentSageRecordId),
    refreshStatus: refreshRow?.status ?? null,
    fields,
    editableFields,
  }
}

async function canAccessEmployeePrivate(
  user: Awaited<ReturnType<typeof requireAuth>>,
  linkedUserId: string | null
): Promise<boolean> {
  if (linkedUserId === user.id) return true
  try {
    await requireFeaturePermission(user, "employee-contact-private", "read")
    return true
  } catch {
    return false
  }
}

async function requireEditAccess(
  user: Awaited<ReturnType<typeof requireAuth>>,
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
    if (!identity || (!identity.sageRecordId && !identity.sageRecordNumber)) {
      return { success: false, error: "This contact has no verified Sage link." }
    }
    if ((kind.data === "client_person" || kind.data === "vendor_person") &&
      !identity.parentSageRecordId) {
      return { success: false, error: "Link the Sage parent company before refreshing this person." }
    }
    await requireEditAccess(user, kind.data, identity.linkedUserId, {})
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    await db.insert(sageContactReadRequests).values({
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
    if (!sageContactOrganizationMatches(env, orgId)) {
      return { success: false, error: "Sage contact sync is not configured for this organization." }
    }
    const db = getDb(env.DB)
    const identity = await getSageContactEntityIdentity(db, orgId, kind.data, entityId)
    if (!identity?.sageRecordId) return { success: false, error: "A stable Sage record ID is required." }
    await requireEditAccess(user, kind.data, identity.linkedUserId, submitted.data)
    const snapshotRow = await db.select().from(sageContactSnapshots).where(and(
      eq(sageContactSnapshots.organizationId, orgId),
      eq(sageContactSnapshots.kind, kind.data),
      eq(sageContactSnapshots.entityId, entityId)
    )).get()
    if (!snapshotRow || !isRecent(snapshotRow.capturedAt)) {
      return { success: false, error: "Refresh this contact from Sage before proposing changes." }
    }
    const snapshot = snapshotFromRow(snapshotRow)
    if (!snapshot || snapshot.sageRecordId !== identity.sageRecordId ||
      snapshot.parentSageRecordId !== identity.parentSageRecordId) {
      return { success: false, error: "The Sage identity changed. Refresh before editing." }
    }
    const plan = planSageContactChange({ snapshot, proposed: submitted.data })
    if (!plan.success) return plan
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    await db.batch([
      db.insert(sageContactChangeProposals).values({
        id, organizationId: orgId, kind: kind.data, entityId,
        sageRecordId: plan.plan.sageRecordId,
        parentSageRecordId: plan.plan.parentSageRecordId,
        baseRevision: plan.plan.baseRevision,
        changesJson: JSON.stringify(plan.plan.changes),
        status: "pending", requestedByUserId: user.id,
        requestedAt: now, updatedAt: now,
      }),
      db.insert(sageContactChangeEvents).values({
        id: crypto.randomUUID(), proposalId: id, organizationId: orgId,
        actorUserId: user.id, eventType: "proposed",
        detailJson: JSON.stringify({ baseRevision: plan.plan.baseRevision }),
        createdAt: now,
      }),
    ])
    revalidatePath("/dashboard/contacts")
    return { success: true, id, status: "pending" }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not propose contact change" }
  }
}

export async function listSageContactChangeProposals(): Promise<readonly SageContactProposalListItem[]> {
  const user = await requireAuth()
  const orgId = requireOrg(user)
  await requireFeaturePermission(user, "sage-contact-review", "read")
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const rows = await db.select().from(sageContactChangeProposals)
    .where(eq(sageContactChangeProposals.organizationId, orgId))
    .orderBy(desc(sageContactChangeProposals.requestedAt)).limit(100)
  const privateAccess = await canAccessEmployeePrivate(user, null)
  const result: SageContactProposalListItem[] = []
  for (const row of rows) {
    const kind = kindSchema.safeParse(row.kind)
    let parsed: unknown
    try { parsed = JSON.parse(row.changesJson) } catch { continue }
    const changes = changesSchema.safeParse(parsed)
    if (!kind.success || !changes.success) continue
    if (kind.data === "employee" && !privateAccess && changes.data.some((change) =>
      isPrivateEmployeeContactField(change.field)
    )) continue
    result.push({
      id: row.id, kind: kind.data, entityId: row.entityId,
      status: row.status,
      changes: changes.data.filter((change): change is SageContactFieldChange =>
        isSageContactFieldChange(change.field, kind.data)
      ),
      requestedByUserId: row.requestedByUserId,
      reviewedByUserId: row.reviewedByUserId,
      requestedAt: row.requestedAt,
      reviewNote: row.reviewNote,
      errorMessage: row.errorMessage,
    })
  }
  return result
}

function isSageContactFieldChange(field: string, kind: SageContactKind): field is SageContactFieldChange["field"] {
  return sageContactProposalFields(kind).some((known) => known === field)
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
    const proposal = await db.select().from(sageContactChangeProposals).where(and(
      eq(sageContactChangeProposals.id, proposalId),
      eq(sageContactChangeProposals.organizationId, orgId),
      eq(sageContactChangeProposals.status, "pending")
    )).get()
    if (!proposal) return { success: false, error: "Proposal is no longer pending." }
    if (proposal.requestedByUserId === user.id) {
      return { success: false, error: "A proposer cannot approve their own contact change." }
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
    if (decision === "approve") {
      const snapshotRow = await db.select().from(sageContactSnapshots).where(and(
        eq(sageContactSnapshots.organizationId, orgId),
        eq(sageContactSnapshots.kind, kind.data),
        eq(sageContactSnapshots.entityId, proposal.entityId)
      )).get()
      const snapshot = snapshotRow ? snapshotFromRow(snapshotRow) : null
      if (!snapshotRow || !snapshot || !isRecent(snapshotRow.capturedAt) ||
        !isSageContactProposalCurrent({
          organizationId: orgId, kind: kind.data,
          sageRecordId: proposal.sageRecordId,
          parentSageRecordId: proposal.parentSageRecordId,
          baseRevision: proposal.baseRevision,
          changes: changes.data.filter((change): change is SageContactFieldChange =>
            isSageContactFieldChange(change.field, kind.data)
          ),
        }, snapshot)) {
        return { success: false, error: "Sage changed or the read is stale. Refresh before approval." }
      }
    }
    const now = new Date().toISOString()
    const status = decision === "approve" ? "approved" : "rejected"
    const eventId = crypto.randomUUID()
    const noteValue = note.trim().slice(0, 1000)
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE sage_contact_change_proposals
         SET status = ?, reviewed_by_user_id = ?, reviewed_at = ?,
             review_note = ?, updated_at = ?, completed_at = ?
         WHERE id = ? AND organization_id = ? AND status = 'pending'`
      ).bind(status, user.id, now, noteValue || null, now,
        decision === "reject" ? now : null, proposalId, orgId),
      env.DB.prepare(
        `INSERT INTO sage_contact_change_events
         (id, proposal_id, organization_id, actor_user_id, event_type, detail_json, created_at)
         SELECT ?, id, organization_id, ?, ?, ?, ?
         FROM sage_contact_change_proposals
         WHERE id = ? AND organization_id = ? AND status = ?
           AND reviewed_by_user_id = ? AND reviewed_at = ?`
      ).bind(eventId, user.id, status,
        JSON.stringify({ note: noteValue }), now,
        proposalId, orgId, status, user.id, now),
    ])
    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
      return { success: false, error: "Proposal was reviewed concurrently." }
    }
    revalidatePath("/dashboard/contacts")
    return { success: true, id: proposalId, status }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not review contact change" }
  }
}
