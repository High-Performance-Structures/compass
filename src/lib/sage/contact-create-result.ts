import "server-only"

import { and, eq } from "drizzle-orm"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { customers, vendors } from "@/db/schema"
import { sageContactCreateProposals } from "@/db/schema-sage"
import { insertSageCreatedPersonStatement } from "@/lib/domain/contacts/store"
import {
  sageContactCreateFailedStatement,
  sageContactCreateOutcomeEventStatement,
  sageContactCreateSucceededStatement,
  sageContactCreateUncertainStatement,
  sageCreatedPersonSnapshotStatement,
} from "@/lib/domain/sage-bridge/contact-store"
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
  const claim = { proposalId: proposal.id, organizationId: proposal.organizationId, claimToken, now }
  const results = await database.batch([
    sageContactCreateUncertainStatement(database, claim, { reason, sageContactId, sageLineNumber }),
    sageContactCreateOutcomeEventStatement(database, claim, "needs_reconciliation",
      JSON.stringify({ reason, sageContactId, sageLineNumber })),
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
    const claim = { proposalId: proposal.id, organizationId: proposal.organizationId, claimToken: result.claimToken, now }
    const updated = await database.batch([
      sageContactCreateFailedStatement(database, claim, result.error),
      sageContactCreateOutcomeEventStatement(database, claim, "failed", JSON.stringify({ error: result.error })),
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
    ? insertSageCreatedPersonStatement(database, kind.data, [proposal.id, proposal.customerId, snapshot.fields.name,
        snapshot.fields.title, snapshot.fields.email, snapshot.fields.phone,
        snapshot.fields.phoneExtension, snapshot.fields.cellPhone,
        snapshot.sageRecordId, lineNumber, proposal.customerId, now, now, now,
        proposal.customerId, proposal.organizationId, proposal.parentSageRecordId,
        proposal.id, result.claimToken])
    : insertSageCreatedPersonStatement(database, kind.data, [proposal.id, proposal.vendorId, snapshot.fields.name,
        snapshot.fields.title, snapshot.fields.email, snapshot.fields.phone,
        snapshot.fields.phoneExtension, snapshot.fields.cellPhone,
        snapshot.sageRecordId, lineNumber, proposal.vendorId, now, now,
        proposal.vendorId, proposal.organizationId, proposal.parentSageRecordId,
        proposal.id, result.claimToken])
  const canonicalTable = kind.data === "client_person" ? "customer_contacts" : "vendor_contacts"
  const claim = { proposalId: proposal.id, organizationId: proposal.organizationId, claimToken: result.claimToken, now }
  const applied = await database.batch([
    canonicalInsert,
    sageCreatedPersonSnapshotStatement(database, {
      canonicalTable, organizationId: proposal.organizationId, kind: kind.data, personId: proposal.id,
      sageRecordId: snapshot.sageRecordId, parentSageRecordId: proposal.parentSageRecordId,
      revision: snapshot.revision, fieldsJson: JSON.stringify(snapshot.fields), now,
    }),
    sageContactCreateSucceededStatement(database, claim, {
      canonicalTable, sageContactId: snapshot.sageRecordId, sageLineNumber: lineNumber,
    }),
    sageContactCreateOutcomeEventStatement(database, claim, "succeeded", JSON.stringify({ sageContactId: snapshot.sageRecordId,
      sageLineNumber: lineNumber })),
  ])
  if (applied.some((item) => item.meta.changes !== 1)) {
    return finishUncertain(database, proposal, result.claimToken, now,
      "Sage child was added but Compass directory reconciliation did not complete.",
      snapshot.sageRecordId, lineNumber)
  }
  return accepted("succeeded")
}
