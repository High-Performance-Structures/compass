import "server-only"

import { and, eq } from "drizzle-orm"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { customers, vendors } from "@/db/schema"
import { sageContactCreateProposals } from "@/db/schema-sage"
import { readbackConfirmsCreateFields, sageContactCreateResultSchema, sageContactOrganizationMatches } from "@/lib/sage/contact-bridge"
import { planSageContactCreate, sageContactProposalFields } from "@/lib/sage/contact-change-proposal"

const kindSchema = z.enum(["client_person", "vendor_person"])
const fieldsSchema = z.record(z.string(), z.string().nullable())

type CreateResult = z.infer<typeof sageContactCreateResultSchema>

function accepted(status: string): Response {
  return Response.json({ success: true, status }, { status: 202 })
}

async function finishUncertain(
  database: D1Database,
  proposal: typeof sageContactCreateProposals.$inferSelect,
  claimToken: string,
  now: string,
  reason: string,
  sageContactId: string | null = null,
  sageLineNumber: number | null = null
): Promise<Response> {
  const results = await database.batch([
    database.prepare(
      `UPDATE sage_contact_create_proposals SET status = 'needs_reconciliation',
       error_message = ?, sage_contact_id = ?, sage_line_number = ?,
       completed_at = ?, updated_at = ? WHERE id = ? AND organization_id = ?
         AND status = 'running' AND claim_token = ?`
    ).bind(reason, sageContactId, sageLineNumber, now, now,
      proposal.id, proposal.organizationId, claimToken),
    database.prepare(
      `INSERT INTO sage_contact_create_events
       (id, proposal_id, organization_id, actor_user_id, event_type, detail_json, created_at)
       SELECT ?, id, organization_id, NULL, 'needs_reconciliation', ?, ?
       FROM sage_contact_create_proposals WHERE id = ? AND organization_id = ?
         AND status = 'needs_reconciliation' AND claim_token = ? AND completed_at = ?`
    ).bind(crypto.randomUUID(), JSON.stringify({ reason, sageContactId, sageLineNumber }), now,
      proposal.id, proposal.organizationId, claimToken, now),
  ])
  if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
    return Response.json({ error: "Sage Add claim changed concurrently" }, { status: 409 })
  }
  return accepted("needs_reconciliation")
}

export async function handleSageContactCreateResult(
  env: object,
  database: D1Database,
  result: CreateResult,
  now: string
): Promise<Response> {
  const db = getDb(database)
  const proposal = await db.select().from(sageContactCreateProposals).where(and(
    eq(sageContactCreateProposals.id, result.id),
    eq(sageContactCreateProposals.claimToken, result.claimToken),
    eq(sageContactCreateProposals.status, "running")
  )).get()
  if (!proposal || !sageContactOrganizationMatches(env, proposal.organizationId)) {
    return Response.json({ error: "Sage Add claim is missing or outside the bridge organization" }, { status: 409 })
  }
  if (result.outcome === "failed") {
    if (result.attempted) {
      return finishUncertain(database, proposal, result.claimToken, now,
        `Sage Add may have committed: ${result.error}`.slice(0, 1000))
    }
    const updated = await database.batch([
      database.prepare(
        `UPDATE sage_contact_create_proposals SET status = 'failed', error_message = ?,
         completed_at = ?, updated_at = ? WHERE id = ? AND organization_id = ?
           AND status = 'running' AND claim_token = ?`
      ).bind(result.error, now, now, proposal.id, proposal.organizationId, result.claimToken),
      database.prepare(
        `INSERT INTO sage_contact_create_events
         (id, proposal_id, organization_id, actor_user_id, event_type, detail_json, created_at)
         SELECT ?, id, organization_id, NULL, 'failed', ?, ?
         FROM sage_contact_create_proposals WHERE id = ? AND organization_id = ?
           AND status = 'failed' AND claim_token = ? AND completed_at = ?`
      ).bind(crypto.randomUUID(), JSON.stringify({ error: result.error }), now,
        proposal.id, proposal.organizationId, result.claimToken, now),
    ])
    if (updated[0]?.meta.changes !== 1 || updated[1]?.meta.changes !== 1) {
      return Response.json({ error: "Sage Add claim changed concurrently" }, { status: 409 })
    }
    return accepted("failed")
  }

  const snapshot = result.snapshot
  const kind = kindSchema.safeParse(proposal.kind)
  let raw: unknown
  try { raw = JSON.parse(proposal.fieldsJson) } catch { raw = null }
  const fields = fieldsSchema.safeParse(raw)
  const plan = kind.success && fields.success
    ? planSageContactCreate(kind.data, fields.data) : null
  const lineNumber = snapshot.sageRecordNumber && /^[1-9]\d*$/.test(snapshot.sageRecordNumber)
    ? Number(snapshot.sageRecordNumber) : null
  const fieldsComplete = kind.success &&
    Object.keys(snapshot.fields).length === sageContactProposalFields(kind.data).length &&
    sageContactProposalFields(kind.data).every((field) =>
      Object.prototype.hasOwnProperty.call(snapshot.fields, field))
  const identityValid = kind.success && plan?.success &&
    snapshot.kind === kind.data && snapshot.entityId === proposal.id &&
    snapshot.parentSageRecordId === proposal.parentSageRecordId &&
    snapshot.sageRecordId.trim().length > 0 &&
    lineNumber !== null && Number.isSafeInteger(lineNumber) &&
    fieldsComplete && readbackConfirmsCreateFields(plan.fields, snapshot.fields)
  if (!identityValid || !kind.success || !plan?.success || lineNumber === null) {
    return finishUncertain(database, proposal, result.claimToken, now,
      "Sage child Add returned an unexpected identity or field value.",
      snapshot.sageRecordId || null, lineNumber)
  }

  const company = kind.data === "client_person" && proposal.customerId
    ? await db.select({ sageRecordId: customers.sageClientId }).from(customers).where(and(
      eq(customers.id, proposal.customerId), eq(customers.organizationId, proposal.organizationId))).get()
    : kind.data === "vendor_person" && proposal.vendorId
      ? await db.select({ sageRecordId: vendors.sageVendorId }).from(vendors).where(and(
        eq(vendors.id, proposal.vendorId), eq(vendors.organizationId, proposal.organizationId),
        eq(vendors.directoryStatus, "active"))).get()
      : null
  if (!company || company.sageRecordId !== proposal.parentSageRecordId) {
    return finishUncertain(database, proposal, result.claimToken, now,
      "Parent directory Sage link changed after Add.", snapshot.sageRecordId, lineNumber)
  }

  const canonicalInsert = kind.data === "client_person"
    ? database.prepare(
        `INSERT INTO customer_contacts
         (id, customer_id, name, title, email, phone, phone_extension, cell_phone,
          sage_contact_id, sage_line_number, is_primary, active, source_system,
          sync_status, last_synced_at, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           CASE WHEN EXISTS (SELECT 1 FROM customer_contacts WHERE customer_id = ? AND active = 1) THEN 0 ELSE 1 END,
           1, 'sage', 'synced', ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM customers WHERE id = ? AND organization_id = ? AND sage_client_id = ?)
           AND EXISTS (SELECT 1 FROM sage_contact_create_proposals
             WHERE id = ? AND status = 'running' AND claim_token = ?)`
      ).bind(proposal.id, proposal.customerId, snapshot.fields.name,
        snapshot.fields.title, snapshot.fields.email, snapshot.fields.phone,
        snapshot.fields.phoneExtension, snapshot.fields.cellPhone,
        snapshot.sageRecordId, lineNumber, proposal.customerId, now, now, now,
        proposal.customerId, proposal.organizationId, proposal.parentSageRecordId,
        proposal.id, result.claimToken)
    : database.prepare(
        `INSERT INTO vendor_contacts
         (id, vendor_id, name, title, email, phone, phone_extension, cell_phone,
          sage_contact_id, sage_line_number, is_primary, active, source_system,
          created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           CASE WHEN EXISTS (SELECT 1 FROM vendor_contacts WHERE vendor_id = ? AND active = 1) THEN 0 ELSE 1 END,
           1, 'sage', ?, ?
         WHERE EXISTS (SELECT 1 FROM vendors WHERE id = ? AND organization_id = ?
           AND sage_vendor_id = ? AND directory_status = 'active')
           AND EXISTS (SELECT 1 FROM sage_contact_create_proposals
             WHERE id = ? AND status = 'running' AND claim_token = ?)`
      ).bind(proposal.id, proposal.vendorId, snapshot.fields.name,
        snapshot.fields.title, snapshot.fields.email, snapshot.fields.phone,
        snapshot.fields.phoneExtension, snapshot.fields.cellPhone,
        snapshot.sageRecordId, lineNumber, proposal.vendorId, now, now,
        proposal.vendorId, proposal.organizationId, proposal.parentSageRecordId,
        proposal.id, result.claimToken)
  const canonicalTable = kind.data === "client_person" ? "customer_contacts" : "vendor_contacts"
  const applied = await database.batch([
    canonicalInsert,
    database.prepare(
      `INSERT INTO sage_contact_snapshots
       (id, organization_id, kind, entity_id, sage_record_id, parent_sage_record_id,
        revision, fields_json, captured_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? FROM ${canonicalTable}
       WHERE id = ? AND sage_contact_id = ?`
    ).bind(crypto.randomUUID(), proposal.organizationId, kind.data, proposal.id,
      snapshot.sageRecordId, proposal.parentSageRecordId,
      snapshot.revision, JSON.stringify(snapshot.fields), now,
      proposal.id, snapshot.sageRecordId),
    database.prepare(
      `UPDATE sage_contact_create_proposals SET status = 'succeeded',
       sage_contact_id = ?, sage_line_number = ?, completed_at = ?, updated_at = ?
       WHERE id = ? AND organization_id = ? AND status = 'running' AND claim_token = ?
         AND EXISTS (SELECT 1 FROM ${canonicalTable} WHERE id = ? AND sage_contact_id = ?)`
    ).bind(snapshot.sageRecordId, lineNumber, now, now, proposal.id, proposal.organizationId,
      result.claimToken, proposal.id, snapshot.sageRecordId),
    database.prepare(
      `INSERT INTO sage_contact_create_events
       (id, proposal_id, organization_id, actor_user_id, event_type, detail_json, created_at)
       SELECT ?, id, organization_id, NULL, 'succeeded', ?, ?
       FROM sage_contact_create_proposals WHERE id = ? AND organization_id = ?
         AND status = 'succeeded' AND claim_token = ? AND completed_at = ?`
    ).bind(crypto.randomUUID(), JSON.stringify({ sageContactId: snapshot.sageRecordId,
      sageLineNumber: lineNumber }), now, proposal.id, proposal.organizationId,
      result.claimToken, now),
  ])
  if (applied.some((item) => item.meta.changes !== 1)) {
    return finishUncertain(database, proposal, result.claimToken, now,
      "Sage child was added but Compass directory reconciliation did not complete.",
      snapshot.sageRecordId, lineNumber)
  }
  return accepted("succeeded")
}
