import { and, eq } from "drizzle-orm"
import { z } from "zod/v4"

import { getDb } from "@/db"
import {
  sageBridgeRequestNonces,
  sageContactChangeEvents,
  sageContactChangeProposals,
  sageContactReadRequests,
  sageContactSnapshots,
} from "@/db/schema-sage"
import { getCloudflareContext } from "@/lib/db"
import {
  getSageContactBridgeSecret,
  readBoundedSageBridgeBody,
  SAGE_BRIDGE_REQUEST_ID_HEADER,
  verifySageBridgeRequest,
} from "@/lib/sage/bridge-auth"
import {
  hasOnlySageContactFields,
  readbackConfirmsChanges,
  sageContactKindSchema,
  sageContactOrganizationMatches,
  sageContactReadResultSchema,
  sageContactWriteResultSchema,
} from "@/lib/sage/contact-bridge"
import { applySageContactSnapshotToCanonical } from "@/lib/sage/contact-canonical"
import { sageContactProposalFields, type SageContactFieldChange } from "@/lib/sage/contact-change-proposal"
import { getSageContactEntityIdentity } from "@/lib/sage/contact-entity"
import { sageContactLinkCandidateError, sageContactReadClaimError } from "@/lib/sage/contact-link-review"

const messageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("read"), result: sageContactReadResultSchema }),
  z.object({ type: z.literal("write"), result: sageContactWriteResultSchema }),
])
const changesSchema = z.array(z.object({
  field: z.string(), before: z.string().nullable(), after: z.string().nullable(),
})).min(1)

function validSnapshotFields(kind: z.infer<typeof sageContactKindSchema>, fields: Readonly<Record<string, string | null>>): boolean {
  return hasOnlySageContactFields(kind, fields) &&
    sageContactProposalFields(kind).every((field) => Object.prototype.hasOwnProperty.call(fields, field)) &&
    ((kind !== "client_person" && kind !== "vendor_person") || Boolean(fields.name?.trim()))
}

function accepted(status: string): Response {
  return Response.json({ success: true, status }, { status: 202 })
}

async function rejectCandidateRead(
  database: D1Database,
  read: { readonly id: string; readonly organizationId: string; readonly claimToken: string },
  reason: string,
  now: string
): Promise<Response> {
  const results = await database.batch([
    database.prepare(
      `UPDATE sage_contact_read_requests SET status = 'conflict', error_message = ?, completed_at = ?
       WHERE id = ? AND organization_id = ? AND claim_token = ?
         AND status = 'running' AND purpose = 'link_candidate'`
    ).bind(reason, now, read.id, read.organizationId, read.claimToken),
    database.prepare(
      `INSERT INTO sage_contact_link_events
       (id, request_id, organization_id, actor_user_id, event_type, detail_json, created_at)
       SELECT ?, id, organization_id, NULL, 'conflict', ?, ?
       FROM sage_contact_read_requests WHERE id = ? AND organization_id = ?
         AND claim_token = ? AND status = 'conflict' AND completed_at = ?`
    ).bind(crypto.randomUUID(), JSON.stringify({ reason }), now,
      read.id, read.organizationId, read.claimToken, now),
  ])
  if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
    return Response.json({ error: "Candidate claim changed concurrently" }, { status: 409 })
  }
  return accepted("conflict")
}

export async function POST(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const secret = getSageContactBridgeSecret(env)
  if (!secret) return Response.json({ error: "Sage contact bridge is not configured" }, { status: 503 })
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 })
  }
  const body = await readBoundedSageBridgeBody(request)
  if (!body.success) return Response.json({ error: body.error }, { status: 413 })
  const verified = await verifySageBridgeRequest(request, secret, body.rawBody)
  if (!verified.success) return Response.json({ error: verified.error }, { status: 401 })
  const requestId = request.headers.get(SAGE_BRIDGE_REQUEST_ID_HEADER)
  if (!requestId) return Response.json({ error: "Missing bridge request ID" }, { status: 401 })
  const now = new Date().toISOString()
  const db = getDb(env.DB)
  try {
    await db.insert(sageBridgeRequestNonces).values({
      requestId, route: new URL(request.url).pathname, createdAt: now,
    })
  } catch {
    return Response.json({ error: "Bridge request has already been consumed" }, { status: 409 })
  }
  let raw: unknown
  try { raw = JSON.parse(body.rawBody) } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = messageSchema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: "Invalid Sage contact result" }, { status: 400 })
  const message = parsed.data

  if (message.type === "read") {
    const result = message.result
    const read = await db.select().from(sageContactReadRequests).where(and(
      eq(sageContactReadRequests.id, result.id),
      eq(sageContactReadRequests.claimToken, result.claimToken),
      eq(sageContactReadRequests.status, "running")
    )).get()
    if (!read || !sageContactOrganizationMatches(env, read.organizationId)) {
      return Response.json({ error: "Read claim is missing or outside the bridge organization" }, { status: 409 })
    }
    if (result.outcome === "failed") {
      await db.update(sageContactReadRequests).set({
        status: "failed", errorMessage: result.error, completedAt: now,
      }).where(and(eq(sageContactReadRequests.id, read.id),
        eq(sageContactReadRequests.claimToken, result.claimToken)))
      return accepted("failed")
    }
    if (sageContactReadClaimError(read)) {
      await db.update(sageContactReadRequests).set({
        status: "failed",
        errorMessage: "Review and link the stable Sage record ID before synchronizing this contact.",
        completedAt: now,
      }).where(and(eq(sageContactReadRequests.id, read.id),
        eq(sageContactReadRequests.claimToken, result.claimToken)))
      return accepted("failed")
    }
    const snapshot = result.snapshot
    const kind = sageContactKindSchema.safeParse(read.kind)
    if (!kind.success || snapshot.kind !== kind.data || snapshot.entityId !== read.entityId ||
      !validSnapshotFields(snapshot.kind, snapshot.fields) ||
      (read.sageRecordId !== null && read.sageRecordId !== snapshot.sageRecordId) ||
      (read.sageRecordId === null && read.sageRecordNumber !== snapshot.sageRecordNumber) ||
      read.parentSageRecordId !== snapshot.parentSageRecordId) {
      if (read.purpose === "link_candidate") {
        return rejectCandidateRead(env.DB, {
          id: read.id, organizationId: read.organizationId, claimToken: result.claimToken,
        }, "Sage read-back does not match the exact candidate identity or field map.", now)
      }
      return Response.json({ error: "Sage read-back does not match the claimed identity or field map" }, { status: 409 })
    }
    const identity = await getSageContactEntityIdentity(db, read.organizationId, kind.data, read.entityId)
    if (!identity) {
      if (read.purpose === "link_candidate") {
        return rejectCandidateRead(env.DB, {
          id: read.id, organizationId: read.organizationId, claimToken: result.claimToken,
        }, "Directory record no longer exists.", now)
      }
      return Response.json({ error: "Directory record is missing" }, { status: 409 })
    }
    if (read.purpose === "link_candidate") {
      if (!read.sageRecordNumber) {
        return rejectCandidateRead(env.DB, {
          id: read.id, organizationId: read.organizationId, claimToken: result.claimToken,
        }, "Sage candidate number is missing.", now)
      }
      const identityError = sageContactLinkCandidateError(identity, {
        kind: kind.data, entityId: read.entityId,
        sageRecordNumber: read.sageRecordNumber,
        parentSageRecordId: read.parentSageRecordId,
      }, {
        kind: snapshot.kind, entityId: snapshot.entityId,
        sageRecordNumber: snapshot.sageRecordNumber ?? "",
        parentSageRecordId: snapshot.parentSageRecordId,
        sageRecordId: snapshot.sageRecordId,
      })
      if (identityError) {
        return rejectCandidateRead(env.DB, {
          id: read.id, organizationId: read.organizationId, claimToken: result.claimToken,
        }, identityError, now)
      }
      const results = await env.DB.batch([
        env.DB.prepare(
          `UPDATE sage_contact_read_requests
           SET status = 'awaiting_review', candidate_snapshot_json = ?, completed_at = ?
           WHERE id = ? AND claim_token = ? AND status = 'running' AND purpose = 'link_candidate'`
        ).bind(JSON.stringify(snapshot), now, read.id, result.claimToken),
        env.DB.prepare(
          `INSERT INTO sage_contact_link_events
           (id, request_id, organization_id, actor_user_id, event_type, detail_json, created_at)
           SELECT ?, id, organization_id, NULL, 'candidate_read', '{}', ?
           FROM sage_contact_read_requests WHERE id = ? AND status = 'awaiting_review'
             AND claim_token = ?`
        ).bind(crypto.randomUUID(), now, read.id, result.claimToken),
      ])
      if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
        return Response.json({ error: "Sage link candidate changed concurrently" }, { status: 409 })
      }
      return accepted("awaiting_review")
    }
    if (!identity.sageRecordId) {
      await db.update(sageContactReadRequests).set({
        status: "failed",
        errorMessage: "Review and link the stable Sage record ID before synchronizing this contact.",
        completedAt: now,
      }).where(and(eq(sageContactReadRequests.id, read.id),
        eq(sageContactReadRequests.claimToken, result.claimToken)))
      return accepted("failed")
    }
    const applied = await applySageContactSnapshotToCanonical(env.DB, read.organizationId, identity, snapshot)
    if (!applied.success) return Response.json({ error: applied.error }, { status: 409 })
    await db.insert(sageContactSnapshots).values({
      id: crypto.randomUUID(), organizationId: read.organizationId,
      kind: snapshot.kind, entityId: snapshot.entityId,
      sageRecordId: snapshot.sageRecordId,
      parentSageRecordId: snapshot.parentSageRecordId,
      revision: snapshot.revision, fieldsJson: JSON.stringify(snapshot.fields),
      capturedAt: now,
    }).onConflictDoUpdate({
      target: [sageContactSnapshots.organizationId, sageContactSnapshots.kind, sageContactSnapshots.entityId],
      set: {
        sageRecordId: snapshot.sageRecordId,
        parentSageRecordId: snapshot.parentSageRecordId,
        revision: snapshot.revision, fieldsJson: JSON.stringify(snapshot.fields),
        capturedAt: now,
      },
    })
    await db.update(sageContactReadRequests).set({ status: "succeeded", completedAt: now, errorMessage: null })
      .where(and(eq(sageContactReadRequests.id, read.id), eq(sageContactReadRequests.claimToken, result.claimToken)))
    return accepted("succeeded")
  }

  const result = message.result
  const proposal = await db.select().from(sageContactChangeProposals).where(and(
    eq(sageContactChangeProposals.id, result.id),
    eq(sageContactChangeProposals.claimToken, result.claimToken),
    eq(sageContactChangeProposals.status, "running")
  )).get()
  if (!proposal || !sageContactOrganizationMatches(env, proposal.organizationId)) {
    return Response.json({ error: "Write claim is missing or outside the bridge organization" }, { status: 409 })
  }
  if (result.outcome === "failed") {
    await db.batch([
      db.update(sageContactChangeProposals).set({
        status: "failed", errorMessage: result.error,
        completedAt: now, updatedAt: now,
      }).where(and(eq(sageContactChangeProposals.id, proposal.id),
        eq(sageContactChangeProposals.claimToken, result.claimToken))),
      db.insert(sageContactChangeEvents).values({
        id: crypto.randomUUID(), proposalId: proposal.id,
        organizationId: proposal.organizationId, actorUserId: null,
        eventType: "failed", detailJson: JSON.stringify({ error: result.error }), createdAt: now,
      }),
    ])
    return accepted("failed")
  }
  const snapshot = result.snapshot
  const kind = sageContactKindSchema.safeParse(proposal.kind)
  let storedChanges: unknown
  try { storedChanges = JSON.parse(proposal.changesJson) } catch { storedChanges = null }
  const changes = changesSchema.safeParse(storedChanges)
  if (!kind.success || !changes.success ||
    snapshot.kind !== kind.data || snapshot.entityId !== proposal.entityId ||
    snapshot.sageRecordId !== proposal.sageRecordId ||
    snapshot.parentSageRecordId !== proposal.parentSageRecordId ||
    !validSnapshotFields(snapshot.kind, snapshot.fields) ||
    changes.data.some((change) => !sageContactProposalFields(kind.data).some((field) => field === change.field))) {
    return Response.json({ error: "Sage write read-back identity or fields are invalid" }, { status: 409 })
  }
  const identity = await getSageContactEntityIdentity(db, proposal.organizationId, kind.data, proposal.entityId)
  if (!identity) return Response.json({ error: "Directory record is missing" }, { status: 409 })
  const applied = await applySageContactSnapshotToCanonical(env.DB, proposal.organizationId, identity, snapshot)
  if (!applied.success) return Response.json({ error: applied.error }, { status: 409 })
  const confirmed = readbackConfirmsChanges(changes.data.filter(
    (change): change is SageContactFieldChange => sageContactProposalFields(kind.data).some((field) => field === change.field)
  ), snapshot.fields)
  const status = confirmed ? "succeeded" : "conflict"
  await db.batch([
    db.insert(sageContactSnapshots).values({
      id: crypto.randomUUID(), organizationId: proposal.organizationId,
      kind: snapshot.kind, entityId: snapshot.entityId,
      sageRecordId: snapshot.sageRecordId,
      parentSageRecordId: snapshot.parentSageRecordId,
      revision: snapshot.revision, fieldsJson: JSON.stringify(snapshot.fields),
      capturedAt: now,
    }).onConflictDoUpdate({
      target: [sageContactSnapshots.organizationId, sageContactSnapshots.kind, sageContactSnapshots.entityId],
      set: { revision: snapshot.revision, fieldsJson: JSON.stringify(snapshot.fields), capturedAt: now },
    }),
    db.update(sageContactChangeProposals).set({
      status, resultRevision: snapshot.revision,
      errorMessage: confirmed ? null : "Sage read-back differs from approved changes",
      completedAt: now, updatedAt: now,
    }).where(and(eq(sageContactChangeProposals.id, proposal.id),
      eq(sageContactChangeProposals.claimToken, result.claimToken))),
    db.insert(sageContactChangeEvents).values({
      id: crypto.randomUUID(), proposalId: proposal.id,
      organizationId: proposal.organizationId, actorUserId: null,
      eventType: status, detailJson: JSON.stringify({ revision: snapshot.revision }), createdAt: now,
    }),
  ])
  return accepted(status)
}
