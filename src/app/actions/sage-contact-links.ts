"use server"

import { and, desc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { customerContacts, customers, internalContacts, vendorContacts, vendors } from "@/db/schema"
import { sageContactLinkEvents, sageContactReadRequests } from "@/db/schema-sage"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { requireOrg } from "@/lib/org-scope"
import { getSageContactBridgeSecret } from "@/lib/sage/bridge-auth"
import { sageContactKindSchema, sageContactOrganizationMatches, sageContactSnapshotResultSchema } from "@/lib/sage/contact-bridge"
import { getSageContactEntityIdentity } from "@/lib/sage/contact-entity"
import { SAGE_LINK_CANDIDATE_MAX_AGE_MS, sageContactLinkCandidateError, sageEmployeeNamesMatch, sageIdentityLinkReviewError, sageLinkReadbackRefreshReason } from "@/lib/sage/contact-link-review"
import type { SageContactKind } from "@/lib/sage/contact-change-proposal"

type LinkResult =
  | { readonly success: true; readonly id: string; readonly status: string; readonly disposition?: "new" | "existing" | "refreshed" }
  | { readonly success: false; readonly error: string }

export type SageContactLinkCandidate = {
  readonly id: string
  readonly kind: SageContactKind
  readonly entityId: string
  readonly directoryName: string
  readonly status: string
  readonly sageRecordNumber: string
  readonly sageRecordId: string | null
  readonly sageIdentityName: string | null
  readonly employeeNamesMatch: boolean
  readonly requestedByCurrentUser: boolean
  readonly selfReviewAllowed: boolean
  readonly reviewExpired: boolean
  readonly fields: Readonly<Record<string, string | null>>
  readonly requestedByUserId: string | null
  readonly requestedAt: string
  readonly completedAt: string | null
  readonly errorMessage: string | null
}

function validNumber(value: string): boolean {
  return /^[1-9]\d{0,9}$/.test(value) && Number.isSafeInteger(Number(value))
}

function directoryFeature(kind: SageContactKind): "customers" | "vendors" | "internal-directory" {
  return kind === "employee" ? "internal-directory"
    : kind.startsWith("client") ? "customers" : "vendors"
}

async function directoryName(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  kind: SageContactKind,
  entityId: string
): Promise<string | null> {
  if (kind === "client_company") {
    const row = await db.select({ name: customers.name }).from(customers).where(and(
      eq(customers.id, entityId), eq(customers.organizationId, organizationId)
    )).get()
    return row?.name ?? null
  }
  if (kind === "vendor_company") {
    const row = await db.select({ name: vendors.name }).from(vendors).where(and(
      eq(vendors.id, entityId), eq(vendors.organizationId, organizationId)
    )).get()
    return row?.name ?? null
  }
  if (kind === "employee") {
    const row = await db.select({ name: internalContacts.name }).from(internalContacts).where(and(
      eq(internalContacts.id, entityId), eq(internalContacts.organizationId, organizationId)
    )).get()
    return row?.name ?? null
  }
  if (kind === "client_person") {
    const row = await db.select({ name: customerContacts.name }).from(customerContacts)
      .innerJoin(customers, eq(customers.id, customerContacts.customerId))
      .where(and(eq(customerContacts.id, entityId), eq(customers.organizationId, organizationId))).get()
    return row?.name ?? null
  }
  const row = await db.select({ name: vendorContacts.name }).from(vendorContacts)
    .innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
    .where(and(eq(vendorContacts.id, entityId), eq(vendors.organizationId, organizationId))).get()
  return row?.name ?? null
}

/** Stage an exact Sage number read; no directory identity is changed here. */
export async function requestSageContactLinkCandidate(
  kindInput: string,
  entityId: string,
  numberInput: string
): Promise<LinkResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(user, "sage-contact-review", "read")
    const kind = sageContactKindSchema.safeParse(kindInput)
    if (!kind.success || !entityId.trim()) return { success: false, error: "Choose a valid directory contact." }
    await requireFeaturePermission(user, directoryFeature(kind.data), "read")
    if (kind.data === "employee") await requireFeaturePermission(user, "employee-contact-private", "read")
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!sageContactOrganizationMatches(env, orgId) || !getSageContactBridgeSecret(env)) {
      return { success: false, error: "Sage contact bridge is not configured for this organization." }
    }
    const db = getDb(env.DB)
    const identity = await getSageContactEntityIdentity(db, orgId, kind.data, entityId)
    if (!identity) return { success: false, error: "Directory contact was not found." }
    if (identity.sageRecordId) return { success: false, error: "This contact already has a verified Sage ID." }
    if ((kind.data === "client_person" || kind.data === "vendor_person") && !identity.parentSageRecordId) {
      return { success: false, error: "Review the Sage parent company link first." }
    }
    const number = numberInput.trim() || identity.sageRecordNumber?.trim() || ""
    if (!validNumber(number) || identity.sageRecordNumber && identity.sageRecordNumber !== number) {
      return { success: false, error: "Enter the exact Sage record or contact line number." }
    }
    const activeLookup = async (): Promise<typeof sageContactReadRequests.$inferSelect | undefined> =>
      db.select().from(sageContactReadRequests).where(and(
        eq(sageContactReadRequests.organizationId, orgId),
        eq(sageContactReadRequests.kind, kind.data),
        eq(sageContactReadRequests.entityId, entityId),
        eq(sageContactReadRequests.purpose, "link_candidate"),
        inArray(sageContactReadRequests.status, ["queued", "running", "awaiting_review"])
      )).get()
    const handleActiveLookup = async (existing: typeof sageContactReadRequests.$inferSelect): Promise<LinkResult> => {
      if (existing.sageRecordNumber !== number || existing.parentSageRecordId !== identity.parentSageRecordId) {
        return { success: false, error: "Another Sage number or parent identity is already pending for this contact. Reject that lookup in Sage review before choosing a different one." }
      }
      let snapshot: unknown
      try { snapshot = existing.candidateSnapshotJson ? JSON.parse(existing.candidateSnapshotJson) : null }
      catch { snapshot = null }
      const parsed = sageContactSnapshotResultSchema.safeParse(snapshot)
      const reason = sageLinkReadbackRefreshReason({
        kind: kind.data, status: existing.status, completedAt: existing.completedAt,
        snapshotValid: parsed.success, sageIdentityName: parsed.success ? parsed.data.identityName : null,
      })
      if (!reason) return { success: true, id: existing.id, status: existing.status, disposition: "existing" }

      const refreshedAt = new Date().toISOString()
      // Reset only the completed read-back; keep the requester and immutable audit history.
      const results = await env.DB.batch([
        env.DB.prepare(
          `UPDATE sage_contact_read_requests SET status = 'queued', claim_token = NULL,
           claimed_at = NULL, candidate_snapshot_json = NULL, completed_at = NULL,
           error_message = NULL, requested_at = ?
           WHERE id = ? AND organization_id = ? AND purpose = 'link_candidate'
             AND status = 'awaiting_review' AND sage_record_number = ?`
        ).bind(refreshedAt, existing.id, orgId, number),
        env.DB.prepare(
          `INSERT INTO sage_contact_link_events
           (id, request_id, organization_id, actor_user_id, event_type, detail_json, created_at)
           SELECT ?, id, organization_id, ?, 'refreshed', ?, ?
           FROM sage_contact_read_requests WHERE id = ? AND organization_id = ?
             AND status = 'queued' AND requested_at = ?
             AND NOT EXISTS (SELECT 1 FROM sage_contact_link_events
               WHERE request_id = ? AND event_type = 'refreshed' AND created_at = ?)`
        ).bind(crypto.randomUUID(), user.id, JSON.stringify({ number, reason }), refreshedAt,
          existing.id, orgId, refreshedAt, existing.id, refreshedAt),
      ])
      if (results[0]?.meta.changes === 0) {
        const current = await activeLookup()
        if (current?.sageRecordNumber === number &&
          current.parentSageRecordId === identity.parentSageRecordId) {
          return { success: true, id: current.id, status: current.status, disposition: "existing" }
        }
      }
      if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
        return { success: false, error: "Sage lookup changed during refresh. Reopen Sage review and try again." }
      }
      revalidatePath("/dashboard/contacts")
      return { success: true, id: existing.id, status: "queued", disposition: "refreshed" }
    }
    const existing = await activeLookup()
    if (existing) return handleActiveLookup(existing)
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    try {
      await db.batch([
        db.insert(sageContactReadRequests).values({
          id, organizationId: orgId, kind: kind.data, entityId,
          sageRecordId: null, sageRecordNumber: number,
          parentSageRecordId: identity.parentSageRecordId,
          purpose: "link_candidate", status: "queued",
          requestedByUserId: user.id, requestedAt: now,
        }),
        db.insert(sageContactLinkEvents).values({
          id: crypto.randomUUID(), requestId: id, organizationId: orgId,
          actorUserId: user.id, eventType: "requested",
          detailJson: JSON.stringify({ number }), createdAt: now,
        }),
      ])
    } catch (error) {
      // A concurrent click may have won the partial unique index after our first read.
      const concurrent = await activeLookup()
      if (concurrent) return handleActiveLookup(concurrent)
      throw error
    }
    revalidatePath("/dashboard/contacts")
    return { success: true, id, status: "queued", disposition: "new" }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not look up Sage contact." }
  }
}

export async function listSageContactLinkCandidates(): Promise<readonly SageContactLinkCandidate[]> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "sage-contact-review", "read")
  const orgId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const canSeeEmployee = await requireFeaturePermission(user, "employee-contact-private", "read")
    .then(() => true).catch(() => false)
  const canSeeClients = await requireFeaturePermission(user, "customers", "read")
    .then(() => true).catch(() => false)
  const canSeeVendors = await requireFeaturePermission(user, "vendors", "read")
    .then(() => true).catch(() => false)
  const canSeeInternal = await requireFeaturePermission(user, "internal-directory", "read")
    .then(() => true).catch(() => false)
  const rows = await db.select().from(sageContactReadRequests).where(and(
    eq(sageContactReadRequests.organizationId, orgId),
    eq(sageContactReadRequests.purpose, "link_candidate")
  )).orderBy(desc(sageContactReadRequests.requestedAt)).limit(100)
  const result: SageContactLinkCandidate[] = []
  for (const row of rows) {
    if (row.kind === "employee" && !canSeeEmployee) continue
    const kind = sageContactKindSchema.safeParse(row.kind)
    if (!kind.success || !row.sageRecordNumber) continue
    if (kind.data.startsWith("client") && !canSeeClients ||
      kind.data.startsWith("vendor") && !canSeeVendors ||
      kind.data === "employee" && !canSeeInternal) continue
    const name = await directoryName(db, orgId, kind.data, row.entityId)
    if (!name) continue
    let snapshot: unknown
    try { snapshot = row.candidateSnapshotJson ? JSON.parse(row.candidateSnapshotJson) : null } catch { snapshot = null }
    const parsed = sageContactSnapshotResultSchema.safeParse(snapshot)
    const sageIdentityName = parsed.success ? parsed.data.identityName?.trim() || null : null
    const employeeNamesMatch = kind.data === "employee" && sageEmployeeNamesMatch(name, sageIdentityName)
    const requestedByCurrentUser = row.requestedByUserId === user.id
    const completedAt = row.completedAt ? Date.parse(row.completedAt) : Number.NaN
    result.push({
      id: row.id, kind: kind.data, entityId: row.entityId, directoryName: name,
      status: row.status, sageRecordNumber: row.sageRecordNumber,
      sageRecordId: parsed.success ? parsed.data.sageRecordId : null,
      sageIdentityName, employeeNamesMatch, requestedByCurrentUser,
      selfReviewAllowed: requestedByCurrentUser && kind.data === "employee",
      reviewExpired: row.status === "awaiting_review" &&
        (!Number.isFinite(completedAt) || Date.now() - completedAt > SAGE_LINK_CANDIDATE_MAX_AGE_MS),
      fields: parsed.success ? parsed.data.fields : {},
      requestedByUserId: row.requestedByUserId,
      requestedAt: row.requestedAt, completedAt: row.completedAt,
      errorMessage: row.errorMessage,
    })
  }
  return result
}

/** The second reviewer links only the exact number/GUID returned by Sage. */
export async function reviewSageContactLinkCandidate(
  requestId: string,
  decision: "link" | "reject",
  note = "",
  confirmDifferentEmployeeName = false
): Promise<LinkResult> {
  try {
    if (decision !== "link" && decision !== "reject") return { success: false, error: "Invalid decision." }
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(user, "sage-contact-review", "approve")
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!sageContactOrganizationMatches(env, orgId)) return { success: false, error: "Sage contact bridge is not configured." }
    const db = getDb(env.DB)
    const row = await db.select().from(sageContactReadRequests).where(and(
      eq(sageContactReadRequests.id, requestId),
      eq(sageContactReadRequests.organizationId, orgId),
      eq(sageContactReadRequests.purpose, "link_candidate"),
      eq(sageContactReadRequests.status, "awaiting_review")
    )).get()
    if (!row || !row.candidateSnapshotJson || !row.sageRecordNumber) {
      return { success: false, error: "Candidate is no longer awaiting review." }
    }
    const kind = sageContactKindSchema.safeParse(row.kind)
    let raw: unknown
    try { raw = JSON.parse(row.candidateSnapshotJson) } catch { raw = null }
    const parsed = sageContactSnapshotResultSchema.safeParse(raw)
    if (!kind.success || !parsed.success) return { success: false, error: "Candidate read-back is invalid." }
    const snapshot = parsed.data
    await requireFeaturePermission(user, directoryFeature(kind.data), "update")
    if (kind.data === "employee") await requireFeaturePermission(user, "employee-contact-private", "approve")
    const now = new Date().toISOString()
    const reviewNote = note.trim().slice(0, 1000)
    if (decision === "reject") {
      const results = await env.DB.batch([
        env.DB.prepare(
          `UPDATE sage_contact_read_requests SET status = 'rejected', reviewed_by_user_id = ?,
           reviewed_at = ?, review_note = ? WHERE id = ? AND organization_id = ?
           AND purpose = 'link_candidate' AND status = 'awaiting_review'`
        ).bind(user.id, now, reviewNote || null, requestId, orgId),
        env.DB.prepare(
          `INSERT INTO sage_contact_link_events
           (id, request_id, organization_id, actor_user_id, event_type, detail_json, created_at)
           SELECT ?, id, organization_id, ?, 'rejected', ?, ?
           FROM sage_contact_read_requests WHERE id = ? AND status = 'rejected'
             AND reviewed_by_user_id = ? AND reviewed_at = ?`
        ).bind(crypto.randomUUID(), user.id, JSON.stringify({ note: reviewNote }), now,
          requestId, user.id, now),
      ])
      if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
        return { success: false, error: "Candidate changed during review." }
      }
      revalidatePath("/dashboard/contacts")
      return { success: true, id: requestId, status: "rejected" }
    }
    const name = kind.data === "employee"
      ? await directoryName(db, orgId, kind.data, row.entityId) : null
    const reviewError = sageIdentityLinkReviewError({
      kind: kind.data, requesterIsReviewer: row.requestedByUserId === user.id,
      compassName: name, sageName: snapshot.identityName,
      reviewNote,
    })
    if (reviewError) return { success: false, error: reviewError }
    if (kind.data === "employee" && name && !sageEmployeeNamesMatch(name, snapshot.identityName) &&
      !confirmDifferentEmployeeName) {
      return { success: false, error: "Confirm the different Compass and Sage employee names before linking." }
    }
    const captured = row.completedAt ? Date.parse(row.completedAt) : Number.NaN
    if (!Number.isFinite(captured) || captured > Date.now() ||
      Date.now() - captured > SAGE_LINK_CANDIDATE_MAX_AGE_MS) {
      return { success: false, error: "Sage candidate read is stale. Refresh the read-back before linking." }
    }
    const identity = await getSageContactEntityIdentity(db, orgId, kind.data, row.entityId)
    if (!identity) return { success: false, error: "Directory record no longer exists." }
    const identityError = sageContactLinkCandidateError(identity, {
      kind: kind.data, entityId: row.entityId,
      sageRecordNumber: row.sageRecordNumber,
      parentSageRecordId: row.parentSageRecordId,
    }, {
      kind: snapshot.kind, entityId: snapshot.entityId,
      sageRecordNumber: snapshot.sageRecordNumber ?? "",
      parentSageRecordId: snapshot.parentSageRecordId,
      sageRecordId: snapshot.sageRecordId,
    })
    if (identityError) return { success: false, error: identityError }
    const reviewToken = crypto.randomUUID()
    const number = row.sageRecordNumber
    const id = snapshot.sageRecordId
    const parent = row.parentSageRecordId
    const guard = `EXISTS (SELECT 1 FROM sage_contact_read_requests
      WHERE id = ? AND organization_id = ? AND status = 'linking' AND claim_token = ?)`
    const linkSql = kind.data === "client_company"
      ? `UPDATE customers SET sage_client_id = ?, sage_client_number = ?
         WHERE id = ? AND organization_id = ? AND sage_client_id IS NULL
           AND (sage_client_number IS NULL OR sage_client_number = ?) AND ${guard}`
      : kind.data === "vendor_company"
        ? `UPDATE vendors SET sage_vendor_id = ?, sage_vendor_number = ?
           WHERE id = ? AND organization_id = ? AND sage_vendor_id IS NULL
             AND (sage_vendor_number IS NULL OR sage_vendor_number = ?) AND ${guard}`
        : kind.data === "employee"
          ? `UPDATE internal_contacts SET sage_employee_id = ?, sage_employee_number = ?
             WHERE id = ? AND organization_id = ? AND sage_employee_id IS NULL
               AND (sage_employee_number IS NULL OR sage_employee_number = ?) AND ${guard}`
          : kind.data === "client_person"
            ? `UPDATE customer_contacts SET sage_contact_id = ?, sage_line_number = ?
               WHERE id = ? AND sage_contact_id IS NULL
                 AND (sage_line_number IS NULL OR sage_line_number = ?)
                 AND customer_id IN (SELECT id FROM customers WHERE organization_id = ? AND sage_client_id = ?)
                 AND ${guard}`
            : `UPDATE vendor_contacts SET sage_contact_id = ?, sage_line_number = ?
               WHERE id = ? AND sage_contact_id IS NULL
                 AND (sage_line_number IS NULL OR sage_line_number = ?)
                 AND vendor_id IN (SELECT id FROM vendors WHERE organization_id = ? AND sage_vendor_id = ?)
                 AND ${guard}`
    const linkStatement = kind.data === "client_person" || kind.data === "vendor_person"
      ? env.DB.prepare(linkSql).bind(id, Number(number), row.entityId, Number(number), orgId,
          parent, requestId, orgId, reviewToken)
      : env.DB.prepare(linkSql).bind(id, number, row.entityId, orgId, number,
          requestId, orgId, reviewToken)
    const confirmedTable = kind.data === "client_company" ? "customers"
      : kind.data === "vendor_company" ? "vendors"
        : kind.data === "employee" ? "internal_contacts"
          : kind.data === "client_person" ? "customer_contacts" : "vendor_contacts"
    const confirmedColumn = kind.data === "client_company" ? "sage_client_id"
      : kind.data === "vendor_company" ? "sage_vendor_id"
        : kind.data === "employee" ? "sage_employee_id" : "sage_contact_id"
    const confirmation = kind.data === "client_person"
      ? ` AND customer_id IN (SELECT id FROM customers WHERE organization_id = ? AND sage_client_id = ?)`
      : kind.data === "vendor_person"
        ? ` AND vendor_id IN (SELECT id FROM vendors WHERE organization_id = ? AND sage_vendor_id = ?)`
        : ` AND organization_id = ?`
    const confirmedStatement = env.DB.prepare(
      `UPDATE sage_contact_read_requests SET status = 'linked' WHERE id = ?
       AND organization_id = ? AND status = 'linking' AND claim_token = ?
       AND EXISTS (SELECT 1 FROM ${confirmedTable} WHERE id = ? AND ${confirmedColumn} = ?${confirmation})`
    )
    const confirmationArgs = kind.data === "client_person" || kind.data === "vendor_person"
      ? [requestId, orgId, reviewToken, row.entityId, id, orgId, parent]
      : [requestId, orgId, reviewToken, row.entityId, id, orgId]
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE sage_contact_read_requests SET status = 'linking', claim_token = ?,
         reviewed_by_user_id = ?, reviewed_at = ?, review_note = ?
         WHERE id = ? AND organization_id = ? AND purpose = 'link_candidate'
           AND status = 'awaiting_review' AND candidate_snapshot_json = ?`
      ).bind(reviewToken, user.id, now, reviewNote || null, requestId, orgId, row.candidateSnapshotJson),
      linkStatement,
      confirmedStatement.bind(...confirmationArgs),
      env.DB.prepare(
        `INSERT INTO sage_contact_link_events
         (id, request_id, organization_id, actor_user_id, event_type, detail_json, created_at)
         SELECT ?, id, organization_id, ?, 'linked', ?, ? FROM sage_contact_read_requests
         WHERE id = ? AND organization_id = ? AND status = 'linked'
           AND reviewed_by_user_id = ? AND reviewed_at = ? AND claim_token = ?`
      ).bind(crypto.randomUUID(), user.id,
        JSON.stringify({ sageRecordId: id, sageRecordNumber: number,
          differentEmployeeNameConfirmed: kind.data === "employee" && Boolean(name) &&
            !sageEmployeeNamesMatch(name ?? "", snapshot.identityName), note: reviewNote }), now,
        requestId, orgId, user.id, now, reviewToken),
    ])
    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1 ||
      results[2]?.meta.changes !== 1 || results[3]?.meta.changes !== 1) {
      if (results[0]?.meta.changes === 1 && results[1]?.meta.changes !== 1) {
        await db.batch([
          db.update(sageContactReadRequests).set({ status: "conflict", errorMessage: "Directory link changed during review." })
            .where(and(eq(sageContactReadRequests.id, requestId), eq(sageContactReadRequests.claimToken, reviewToken))),
          db.insert(sageContactLinkEvents).values({
            id: crypto.randomUUID(), requestId, organizationId: orgId,
            actorUserId: user.id, eventType: "conflict", detailJson: "{}", createdAt: now,
          }),
        ])
      }
      return { success: false, error: "Candidate changed during review. Inspect the Sage link before retrying." }
    }
    await db.insert(sageContactReadRequests).values({
      id: crypto.randomUUID(), organizationId: orgId, kind: kind.data,
      entityId: row.entityId, sageRecordId: id,
      sageRecordNumber: number, parentSageRecordId: parent,
      purpose: "refresh", status: "queued", requestedByUserId: user.id,
      requestedAt: now,
    })
    revalidatePath("/dashboard/contacts")
    return { success: true, id: requestId, status: "linked" }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not review Sage link." }
  }
}
