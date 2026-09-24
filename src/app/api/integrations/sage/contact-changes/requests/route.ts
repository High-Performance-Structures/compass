import { and, asc, eq, lt, or, sql } from "drizzle-orm"
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
  SAGE_BRIDGE_REQUEST_ID_HEADER,
  verifySageBridgeRequest,
} from "@/lib/sage/bridge-auth"
import {
  hasOnlySageContactFields,
  sageContactKindSchema,
  sageContactOrganizationMatches,
} from "@/lib/sage/contact-bridge"
import { sageContactReadClaimError } from "@/lib/sage/contact-link-review"

const CLAIM_RETRY_MS = 10 * 60 * 1000
const NONCE_RETENTION_MS = 15 * 60 * 1000
const MAX_BATCH = 5
const changesSchema = z.array(z.object({
  field: z.string(), before: z.string().nullable(), after: z.string().nullable(),
})).min(1)

function contactWritesEnabled(env: object): boolean {
  const value: unknown = Reflect.get(env, "SAGE_CONTACT_WRITES_ENABLED")
  return value === "true"
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
  return Response.json({ reads, writes })
}
