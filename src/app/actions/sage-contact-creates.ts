"use server"

import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { customers, vendors } from "@/db/schema"
import { sageContactCreateEvents, sageContactCreateProposals } from "@/db/schema-sage"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { requireOrg } from "@/lib/org-scope"
import { sageContactCreationEnabled, sageContactOrganizationMatches } from "@/lib/sage/contact-bridge"
import { planSageContactCreate, type SageContactCreateFields } from "@/lib/sage/contact-change-proposal"

const kindSchema = z.enum(["client_person", "vendor_person"])
const fieldsSchema = z.record(z.string(), z.string().nullable())
const storedFieldsSchema = z.object({
  name: z.string().min(1), title: z.string().nullable(), phone: z.string().nullable(),
  phoneExtension: z.string().nullable(), email: z.string().nullable(), cellPhone: z.string().nullable(),
})

type ActionResult =
  | { readonly success: true; readonly id: string; readonly status: string }
  | { readonly success: false; readonly error: string }

export type SageContactCreateListItem = {
  readonly id: string
  readonly kind: "client_person" | "vendor_person"
  readonly companyName: string
  readonly fields: SageContactCreateFields
  readonly status: string
  readonly requestedByUserId: string
  readonly requestedAt: string
  readonly reviewedByUserId: string | null
  readonly reviewNote: string | null
  readonly errorMessage: string | null
}

function directoryFeature(kind: "client_person" | "vendor_person"): "customers" | "vendors" {
  return kind === "client_person" ? "customers" : "vendors"
}

async function dedupeKey(
  kind: "client_person" | "vendor_person",
  parentId: string,
  fields: SageContactCreateFields
): Promise<string> {
  // The key blocks a duplicate while an uncertain Sage Add awaits reconciliation.
  const canonical = [kind, parentId, fields.name.toLocaleLowerCase("en-US"),
    fields.email?.toLocaleLowerCase("en-US") ?? ""].join("\u0000")
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function proposeSageContactCreate(
  kindInput: string,
  companyId: string,
  submitted: Readonly<Record<string, string | null>>
): Promise<ActionResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    const kind = kindSchema.safeParse(kindInput)
    const fields = fieldsSchema.safeParse(submitted)
    if (!kind.success || !fields.success || !companyId.trim()) {
      return { success: false, error: "Choose a valid company and contact details." }
    }
    await requireFeaturePermission(user, directoryFeature(kind.data), "create")
    const plan = planSageContactCreate(kind.data, fields.data)
    if (!plan.success) return plan
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!sageContactCreationEnabled(env)) {
      return { success: false, error: "Sage child-contact creation is not enabled yet." }
    }
    if (!sageContactOrganizationMatches(env, orgId)) {
      return { success: false, error: "Sage contact sync is not configured for this organization." }
    }
    const db = getDb(env.DB)
    const company = kind.data === "client_person"
      ? await db.select({ id: customers.id, sageRecordId: customers.sageClientId })
        .from(customers).where(and(eq(customers.id, companyId), eq(customers.organizationId, orgId))).get()
      : await db.select({ id: vendors.id, sageRecordId: vendors.sageVendorId })
        .from(vendors).where(and(eq(vendors.id, companyId), eq(vendors.organizationId, orgId),
          eq(vendors.directoryStatus, "active"))).get()
    if (!company?.sageRecordId) {
      return { success: false, error: "Verify the parent company's stable Sage ID before adding a person." }
    }
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    await db.batch([
      db.insert(sageContactCreateProposals).values({
        id, organizationId: orgId, kind: kind.data,
        customerId: kind.data === "client_person" ? companyId : null,
        vendorId: kind.data === "vendor_person" ? companyId : null,
        parentSageRecordId: company.sageRecordId,
        fieldsJson: JSON.stringify(plan.fields),
        dedupeKey: await dedupeKey(kind.data, company.sageRecordId, plan.fields),
        status: "pending", requestedByUserId: user.id,
        requestedAt: now, updatedAt: now,
      }),
      db.insert(sageContactCreateEvents).values({
        id: crypto.randomUUID(), proposalId: id, organizationId: orgId,
        actorUserId: user.id, eventType: "proposed", detailJson: "{}", createdAt: now,
      }),
    ])
    revalidatePath("/dashboard/contacts")
    return { success: true, id, status: "pending" }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not propose Sage contact." }
  }
}

export async function listSageContactCreateProposals(): Promise<readonly SageContactCreateListItem[]> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "sage-contact-review", "read")
  const orgId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const canSeeClients = await requireFeaturePermission(user, "customers", "read")
    .then(() => true).catch(() => false)
  const canSeeVendors = await requireFeaturePermission(user, "vendors", "read")
    .then(() => true).catch(() => false)
  const rows = await db.select().from(sageContactCreateProposals)
    .where(eq(sageContactCreateProposals.organizationId, orgId))
    .orderBy(desc(sageContactCreateProposals.requestedAt)).limit(100)
  const result: SageContactCreateListItem[] = []
  for (const row of rows) {
    const kind = kindSchema.safeParse(row.kind)
    if (!kind.success || kind.data === "client_person" && !canSeeClients ||
      kind.data === "vendor_person" && !canSeeVendors) continue
    let raw: unknown
    try { raw = JSON.parse(row.fieldsJson) } catch { raw = null }
    const fields = storedFieldsSchema.safeParse(raw)
    if (!fields.success) continue
    const company = kind.data === "client_person" && row.customerId
      ? await db.select({ name: customers.name }).from(customers).where(and(
        eq(customers.id, row.customerId), eq(customers.organizationId, orgId))).get()
      : kind.data === "vendor_person" && row.vendorId
        ? await db.select({ name: vendors.name }).from(vendors).where(and(
          eq(vendors.id, row.vendorId), eq(vendors.organizationId, orgId))).get()
        : null
    if (!company) continue
    result.push({
      id: row.id, kind: kind.data, companyName: company.name,
      fields: fields.data, status: row.status,
      requestedByUserId: row.requestedByUserId, requestedAt: row.requestedAt,
      reviewedByUserId: row.reviewedByUserId,
      reviewNote: row.reviewNote, errorMessage: row.errorMessage,
    })
  }
  return result
}

export async function reviewSageContactCreate(
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
      return { success: false, error: "Sage contact bridge is not configured." }
    }
    if (decision === "approve" && !sageContactCreationEnabled(env)) {
      return { success: false, error: "Sage contact creation is paused until the guarded bridge is enabled." }
    }
    const db = getDb(env.DB)
    const proposal = await db.select().from(sageContactCreateProposals).where(and(
      eq(sageContactCreateProposals.id, proposalId),
      eq(sageContactCreateProposals.organizationId, orgId),
      eq(sageContactCreateProposals.status, "pending")
    )).get()
    if (!proposal) return { success: false, error: "Proposal is no longer pending." }
    if (proposal.requestedByUserId === user.id) {
      return { success: false, error: "A proposer cannot approve their own Sage contact." }
    }
    const kind = kindSchema.safeParse(proposal.kind)
    if (!kind.success) return { success: false, error: "Stored contact kind is invalid." }
    await requireFeaturePermission(user, directoryFeature(kind.data), "create")
    const company = kind.data === "client_person" && proposal.customerId
      ? await db.select({ sageRecordId: customers.sageClientId }).from(customers).where(and(
        eq(customers.id, proposal.customerId), eq(customers.organizationId, orgId))).get()
      : kind.data === "vendor_person" && proposal.vendorId
        ? await db.select({ sageRecordId: vendors.sageVendorId }).from(vendors).where(and(
          eq(vendors.id, proposal.vendorId), eq(vendors.organizationId, orgId),
          eq(vendors.directoryStatus, "active"))).get()
        : null
    if (!company || company.sageRecordId !== proposal.parentSageRecordId) {
      return { success: false, error: "Parent Sage identity changed. Propose this person again." }
    }
    let raw: unknown
    try { raw = JSON.parse(proposal.fieldsJson) } catch { raw = null }
    const fields = storedFieldsSchema.safeParse(raw)
    if (!fields.success || !planSageContactCreate(kind.data, fields.data).success) {
      return { success: false, error: "Stored contact fields are invalid." }
    }
    const now = new Date().toISOString()
    const status = decision === "approve" ? "approved" : "rejected"
    const reviewNote = note.trim().slice(0, 1000)
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE sage_contact_create_proposals SET status = ?, reviewed_by_user_id = ?,
         reviewed_at = ?, review_note = ?, completed_at = ?, updated_at = ?
         WHERE id = ? AND organization_id = ? AND status = 'pending'`
      ).bind(status, user.id, now, reviewNote || null,
        decision === "reject" ? now : null, now, proposalId, orgId),
      env.DB.prepare(
        `INSERT INTO sage_contact_create_events
         (id, proposal_id, organization_id, actor_user_id, event_type, detail_json, created_at)
         SELECT ?, id, organization_id, ?, ?, ?, ? FROM sage_contact_create_proposals
         WHERE id = ? AND organization_id = ? AND status = ?
           AND reviewed_by_user_id = ? AND reviewed_at = ?`
      ).bind(crypto.randomUUID(), user.id, status, JSON.stringify({ note: reviewNote }), now,
        proposalId, orgId, status, user.id, now),
    ])
    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
      return { success: false, error: "Proposal changed during review." }
    }
    revalidatePath("/dashboard/contacts")
    return { success: true, id: proposalId, status }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not review Sage contact." }
  }
}
