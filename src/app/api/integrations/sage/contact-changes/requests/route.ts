import { and, asc, eq, lt, or, sql } from "drizzle-orm"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { customers, vendors } from "@/db/schema"
import {
  sageBridgeRequestNonces,
  sageContactChangeEvents,
  sageContactChangeProposals,
  sageContactCreateEvents,
  sageContactCreateProposals,
  sageContactReadRequests,
  sageContactSnapshots,
} from "@/db/schema-sage"
import { getCloudflareContext } from "@/lib/db"
import {
  getSageContactBridgeSecret,
  SAGE_BRIDGE_REQUEST_ID_HEADER,
  verifySageBridgeRequest,
} from "@/lib/sage/bridge-auth"
import {
  hasOnlySageContactFields,
  sageContactKindSchema,
  sageContactOrganizationMatches,
} from "@/lib/sage/contact-bridge"
import { sageContactReadClaimError } from "@/lib/sage/contact-link-review"
import { planSageContactCreate } from "@/lib/sage/contact-change-proposal"

const CLAIM_RETRY_MS = 10 * 60 * 1000
const NONCE_RETENTION_MS = 15 * 60 * 1000
const MAX_BATCH = 5
const changesSchema = z.array(z.object({
  field: z.string(), before: z.string().nullable(), after: z.string().nullable(),
})).min(1)
const createKindSchema = z.enum(["client_person", "vendor_person"])
const createFieldsSchema = z.record(z.string(), z.string().nullable())

function contactWritesEnabled(env: object): boolean {
  const value: unknown = Reflect.get(env, "SAGE_CONTACT_WRITES_ENABLED")
  return value === "true"
}

function contactCreatesEnabled(env: object, request: Request): boolean {
  return contactWritesEnabled(env) &&
    Reflect.get(env, "SAGE_CONTACT_CREATES_ENABLED") === "true" &&
    request.headers.get("x-compass-contact-bridge-version") === "2"
}

export async function GET(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const secret = getSageContactBridgeSecret(env)
  if (!secret) return Response.json({ error: "Sage contact bridge is not configured" }, { status: 503 })
  const verification = await verifySageBridgeRequest(request, secret, "")
  if (!verification.success) return Response.json({ error: verification.error }, { status: 401 })
  const requestId = request.headers.get(SAGE_BRIDGE_REQUEST_ID_HEADER)
  if (!requestId) return Response.json({ error: "Missing bridge request ID" }, { status: 401 })
  const now = new Date()
  const nowIso = now.toISOString()
  const staleIso = new Date(now.getTime() - CLAIM_RETRY_MS).toISOString()
  const db = getDb(env.DB)

  await db.delete(sageBridgeRequestNonces).where(lt(
    sageBridgeRequestNonces.createdAt,
    new Date(now.getTime() - NONCE_RETENTION_MS).toISOString()
  ))
  try {
    await db.insert(sageBridgeRequestNonces).values({
      requestId, route: new URL(request.url).pathname, createdAt: nowIso,
    })
  } catch {
    return Response.json({ error: "Bridge request has already been consumed" }, { status: 409 })
  }

  const readCandidates = await db.select().from(sageContactReadRequests).where(or(
    eq(sageContactReadRequests.status, "queued"),
    and(eq(sageContactReadRequests.status, "running"),
      lt(sageContactReadRequests.claimedAt, staleIso))
  )).orderBy(asc(sageContactReadRequests.requestedAt)).limit(MAX_BATCH)
  const reads: unknown[] = []
  for (const candidate of readCandidates) {
    if (!sageContactOrganizationMatches(env, candidate.organizationId)) continue
    if (sageContactReadClaimError(candidate)) {
      await db.update(sageContactReadRequests).set({
        status: "failed",
        errorMessage: "Sage contact read has no verified identity or valid review candidate.",
        completedAt: nowIso,
      }).where(and(eq(sageContactReadRequests.id, candidate.id), or(
        eq(sageContactReadRequests.status, "queued"),
        and(eq(sageContactReadRequests.status, "running"),
          lt(sageContactReadRequests.claimedAt, staleIso))
      )))
      continue
    }
    const claimToken = crypto.randomUUID()
    const updated = await db.update(sageContactReadRequests).set({
      status: "running", claimToken, claimedAt: nowIso,
    }).where(and(eq(sageContactReadRequests.id, candidate.id), or(
      eq(sageContactReadRequests.status, "queued"),
      and(eq(sageContactReadRequests.status, "running"),
        lt(sageContactReadRequests.claimedAt, staleIso))
    ))).returning({ id: sageContactReadRequests.id })
    if (updated.length !== 1) continue
    reads.push({
      id: candidate.id, claimToken, organizationId: candidate.organizationId,
      kind: candidate.kind, entityId: candidate.entityId,
      purpose: candidate.purpose,
      sageRecordId: candidate.sageRecordId,
      sageRecordNumber: candidate.sageRecordNumber,
      parentSageRecordId: candidate.parentSageRecordId,
    })
  }

  const writes: unknown[] = []
  if (contactWritesEnabled(env)) {
    const writeCandidates = await db.select().from(sageContactChangeProposals).where(or(
      eq(sageContactChangeProposals.status, "approved"),
      and(eq(sageContactChangeProposals.status, "running"),
        lt(sageContactChangeProposals.claimedAt, staleIso))
    )).orderBy(asc(sageContactChangeProposals.requestedAt)).limit(MAX_BATCH)
    for (const candidate of writeCandidates) {
      if (!sageContactOrganizationMatches(env, candidate.organizationId)) continue
      const kind = sageContactKindSchema.safeParse(candidate.kind)
      let parsed: unknown
      try { parsed = JSON.parse(candidate.changesJson) } catch { parsed = null }
      const changes = changesSchema.safeParse(parsed)
      if (!kind.success || !changes.success || !hasOnlySageContactFields(
        kind.success ? kind.data : "employee",
        Object.fromEntries(changes.success ? changes.data.map((change) => [change.field, change.after]) : [])
      )) {
        await db.update(sageContactChangeProposals).set({
          status: "failed", errorMessage: "Stored Sage contact proposal is invalid",
          completedAt: nowIso, updatedAt: nowIso,
        }).where(eq(sageContactChangeProposals.id, candidate.id))
        continue
      }
      const snapshot = await db.select().from(sageContactSnapshots).where(and(
        eq(sageContactSnapshots.organizationId, candidate.organizationId),
        eq(sageContactSnapshots.kind, candidate.kind),
        eq(sageContactSnapshots.entityId, candidate.entityId)
      )).get()
      const capturedAt = snapshot ? Date.parse(snapshot.capturedAt) : Number.NaN
      if (!snapshot || snapshot.revision !== candidate.baseRevision ||
        snapshot.sageRecordId !== candidate.sageRecordId ||
        snapshot.parentSageRecordId !== candidate.parentSageRecordId ||
        !Number.isFinite(capturedAt) || now.getTime() - capturedAt > CLAIM_RETRY_MS) {
        await db.batch([
          db.update(sageContactChangeProposals).set({
            status: "conflict", errorMessage: "Sage snapshot changed or expired before bridge claim",
            completedAt: nowIso, updatedAt: nowIso,
          }).where(eq(sageContactChangeProposals.id, candidate.id)),
          db.insert(sageContactChangeEvents).values({
            id: crypto.randomUUID(), proposalId: candidate.id,
            organizationId: candidate.organizationId, actorUserId: null,
            eventType: "conflict", detailJson: "{}", createdAt: nowIso,
          }),
        ])
        continue
      }
      const claimToken = crypto.randomUUID()
      const updated = await db.update(sageContactChangeProposals).set({
        status: "running", claimToken, claimedAt: nowIso,
        attemptCount: sql`${sageContactChangeProposals.attemptCount} + 1`,
        updatedAt: nowIso,
      }).where(and(eq(sageContactChangeProposals.id, candidate.id), or(
        eq(sageContactChangeProposals.status, "approved"),
        and(eq(sageContactChangeProposals.status, "running"),
          lt(sageContactChangeProposals.claimedAt, staleIso))
      ))).returning({ id: sageContactChangeProposals.id })
      if (updated.length !== 1) continue
      writes.push({
        id: candidate.id, claimToken, organizationId: candidate.organizationId,
        kind: candidate.kind, entityId: candidate.entityId,
        sageRecordId: candidate.sageRecordId,
        parentSageRecordId: candidate.parentSageRecordId,
        baseRevision: candidate.baseRevision,
        changes: changes.data,
      })
    }
  }
  const creates: unknown[] = []
  if (contactCreatesEnabled(env, request)) {
    // Once an Add might have been sent, a timeout is never an automatic retry.
    const stale = await db.select().from(sageContactCreateProposals).where(and(
      eq(sageContactCreateProposals.status, "running"),
      lt(sageContactCreateProposals.claimedAt, staleIso)
    )).limit(MAX_BATCH)
    for (const row of stale) {
      if (!sageContactOrganizationMatches(env, row.organizationId)) continue
      const finished = await db.update(sageContactCreateProposals).set({
        status: "needs_reconciliation", completedAt: nowIso, updatedAt: nowIso,
        errorMessage: "Sage Add outcome is uncertain. Inspect Sage before any retry.",
      }).where(and(eq(sageContactCreateProposals.id, row.id),
        eq(sageContactCreateProposals.status, "running"),
        eq(sageContactCreateProposals.claimToken, row.claimToken ?? "")))
        .returning({ id: sageContactCreateProposals.id })
      if (finished.length === 1) {
        await db.insert(sageContactCreateEvents).values({
          id: crypto.randomUUID(), proposalId: row.id,
          organizationId: row.organizationId, actorUserId: null,
          eventType: "needs_reconciliation", detailJson: "{}", createdAt: nowIso,
        })
      }
    }

    const candidates = await db.select().from(sageContactCreateProposals).where(
      eq(sageContactCreateProposals.status, "approved")
    ).orderBy(asc(sageContactCreateProposals.requestedAt)).limit(MAX_BATCH)
    for (const candidate of candidates) {
      if (!sageContactOrganizationMatches(env, candidate.organizationId)) continue
      const kind = createKindSchema.safeParse(candidate.kind)
      let raw: unknown
      try { raw = JSON.parse(candidate.fieldsJson) } catch { raw = null }
      const fields = createFieldsSchema.safeParse(raw)
      const plan = kind.success && fields.success
        ? planSageContactCreate(kind.data, fields.data) : null
      const company = kind.success && kind.data === "client_person" && candidate.customerId
        ? await db.select({ sageRecordId: customers.sageClientId }).from(customers).where(and(
          eq(customers.id, candidate.customerId), eq(customers.organizationId, candidate.organizationId))).get()
        : kind.success && kind.data === "vendor_person" && candidate.vendorId
          ? await db.select({ sageRecordId: vendors.sageVendorId }).from(vendors).where(and(
            eq(vendors.id, candidate.vendorId), eq(vendors.organizationId, candidate.organizationId),
            eq(vendors.directoryStatus, "active"))).get()
          : null
      if (!plan?.success || !company || company.sageRecordId !== candidate.parentSageRecordId ||
        candidate.attemptCount !== 0) {
        const failed = await db.update(sageContactCreateProposals).set({
          status: "failed", completedAt: nowIso, updatedAt: nowIso,
          errorMessage: "Stored create proposal or parent Sage link is invalid.",
        }).where(and(eq(sageContactCreateProposals.id, candidate.id),
          eq(sageContactCreateProposals.status, "approved")))
          .returning({ id: sageContactCreateProposals.id })
        if (failed.length === 1) await db.insert(sageContactCreateEvents).values({
          id: crypto.randomUUID(), proposalId: candidate.id,
          organizationId: candidate.organizationId, actorUserId: null,
          eventType: "failed", detailJson: "{}", createdAt: nowIso,
        })
        continue
      }
      const claimToken = crypto.randomUUID()
      const parentTable = kind.data === "client_person" ? "customers" : "vendors"
      const parentIdColumn = kind.data === "client_person" ? "customer_id" : "vendor_id"
      const parentSageColumn = kind.data === "client_person" ? "sage_client_id" : "sage_vendor_id"
      const activeFilter = kind.data === "client_person" ? "" : "AND parent.directory_status = 'active'"
      const claimed = await env.DB.prepare(
        `UPDATE sage_contact_create_proposals
         SET status = 'running', claim_token = ?, claimed_at = ?, attempt_count = attempt_count + 1,
             updated_at = ?
         WHERE id = ? AND organization_id = ? AND status = 'approved' AND attempt_count = 0
           AND EXISTS (SELECT 1 FROM ${parentTable} parent
             WHERE parent.id = sage_contact_create_proposals.${parentIdColumn}
               AND parent.organization_id = sage_contact_create_proposals.organization_id
               AND parent.${parentSageColumn} = sage_contact_create_proposals.parent_sage_record_id
               ${activeFilter})
           AND NOT EXISTS (
             SELECT 1 FROM sage_contact_create_proposals other
             WHERE other.organization_id = ? AND other.parent_sage_record_id = ?
               AND other.status IN ('running', 'needs_reconciliation') AND other.id <> ?
           )`
      ).bind(claimToken, nowIso, nowIso, candidate.id, candidate.organizationId,
        candidate.organizationId, candidate.parentSageRecordId, candidate.id).run()
      if (claimed.meta.changes !== 1) continue
      await db.insert(sageContactCreateEvents).values({
        id: crypto.randomUUID(), proposalId: candidate.id,
        organizationId: candidate.organizationId, actorUserId: null,
        eventType: "claimed", detailJson: "{}", createdAt: nowIso,
      })
      creates.push({
        id: candidate.id, claimToken, organizationId: candidate.organizationId,
        kind: candidate.kind, companyId: candidate.customerId ?? candidate.vendorId,
        parentSageRecordId: candidate.parentSageRecordId,
        fields: plan.fields,
      })
      break // One Add per bridge poll; never mix two additions in one session.
    }
  }
  return Response.json({ reads, writes, creates })
}
