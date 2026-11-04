"use server"

import { and, desc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { customerContacts, customers, internalContacts, vendorContacts, vendors } from "@/db/schema"
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
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { requireOrg } from "@/lib/org-scope"
import {
  isPrivateEmployeeContactField,
  isSageContactProposalCurrent,
  sageContactProposalFields,
  type SageContactFieldChange,
  type SageContactKind,
} from "@/lib/sage/contact-change-proposal"
import { getSageContactEntityIdentity } from "@/lib/sage/contact-entity"
import {
  canAccessEmployeePrivate,
  createSageContactProposal,
  isRecentSageRead,
  recordSageChangeActivity,
  requireSageContactEditAccess,
  sageSnapshotFromRow,
} from "@/lib/sage/contact-proposal-service"
import { sageContactOrganizationMatches } from "@/lib/sage/contact-bridge"
import { requireUserContext, type Db } from "@/lib/server/action-context"
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
  readonly entityId: string
  /** The directory record's current Compass name, for the reviewer. */
  readonly entityName: string | null
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

export async function listSageContactChangeProposals(): Promise<readonly SageContactProposalListItem[]> {
  const { user, db } = await requireUserContext()
  const orgId = requireOrg(user)
  await requireFeaturePermission(user, "sage-contact-review", "read")
  const rows = await db.select().from(sageContactChangeProposals)
    .where(eq(sageContactChangeProposals.organizationId, orgId))
    .orderBy(desc(sageContactChangeProposals.requestedAt)).limit(100)
  const privateAccess = await canAccessEmployeePrivate(user, null)
  const names = await directoryNames(db, orgId, rows.map((row) => row.entityId))
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
      entityName: names.get(row.entityId) ?? null,
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
      const snapshot = snapshotRow ? sageSnapshotFromRow(snapshotRow) : null
      if (!snapshotRow || !snapshot || !isRecentSageRead(snapshotRow.capturedAt) ||
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
    const noteValue = note.trim().slice(0, 1000)
    const results = await env.DB.batch(reviewSageContactChangeStatements(env.DB, {
      proposalId, organizationId: orgId, reviewerUserId: user.id, status,
      reviewNote: noteValue || null, noteJson: JSON.stringify({ note: noteValue }),
      completedAt: decision === "reject" ? now : null, now,
    }))
    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
      return { success: false, error: "Proposal was reviewed concurrently." }
    }
    await recordSageChangeActivity(db, {
      organizationId: orgId, actor: user, kind: kind.data, entityId: proposal.entityId,
      proposalId, step: status,
      changes: changes.data.filter((change): change is SageContactFieldChange =>
        isSageContactFieldChange(change.field, kind.data)),
      note: noteValue || null,
    })
    revalidatePath("/dashboard/contacts")
    return { success: true, id: proposalId, status }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not review contact change" }
  }
}
