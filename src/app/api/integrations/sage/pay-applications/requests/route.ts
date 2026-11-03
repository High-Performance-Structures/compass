import { and, asc, eq, lt, or, sql } from "drizzle-orm"

import { getDb } from "@/db"
import {
  sageBridgeRequestNonces,
  sagePayApplicationSyncRuns,
} from "@/db/schema-sage"
import { getCloudflareContext } from "@/lib/db"
import {
  SAGE_BRIDGE_NONCE_RETENTION_MS,
  sageBridgeBatchLimit,
  sageBridgeCutoff,
} from "@/lib/domain/sage-bridge/rules"
import {
  deleteSageBridgeRequestNonces,
  insertSageBridgeRequestNonce,
  sageBridgeHeartbeatStatement,
  updateSagePayApplicationSyncRuns,
} from "@/lib/domain/sage-bridge/store"
import {
  getSagePayApplicationBridgeSecret,
  SAGE_BRIDGE_REQUEST_ID_HEADER,
  verifySageBridgeRequest,
} from "@/lib/sage/bridge-auth"

const MAX_BATCH = 20
const CLAIM_RETRY_MILLISECONDS = 5 * 60 * 1000
const INGEST_RETRY_MILLISECONDS = 15 * 60 * 1000

function unauthorized(error: string): Response {
  return Response.json({ error }, { status: 401 })
}

export async function GET(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const secret = getSagePayApplicationBridgeSecret(env)
  if (!secret) {
    return Response.json(
      { error: "Sage bridge is not configured" },
      { status: 503 }
    )
  }
  const verification = await verifySageBridgeRequest(request, secret, "")
  if (!verification.success) return unauthorized(verification.error)

  const url = new URL(request.url)
  const requestId = request.headers.get(SAGE_BRIDGE_REQUEST_ID_HEADER)
  if (!requestId) return unauthorized("Missing bridge signature")
  const limit = sageBridgeBatchLimit(url.searchParams.get("limit"), 10, MAX_BATCH)
  const now = new Date()
  const nowIso = now.toISOString()
  const staleClaimIso = sageBridgeCutoff(now, CLAIM_RETRY_MILLISECONDS)
  const staleIngestIso = sageBridgeCutoff(now, INGEST_RETRY_MILLISECONDS)
  const db = getDb(env.DB)
  await deleteSageBridgeRequestNonces(
    db,
    lt(sageBridgeRequestNonces.createdAt, sageBridgeCutoff(now, SAGE_BRIDGE_NONCE_RETENTION_MS))
  )
  try {
    await insertSageBridgeRequestNonce(db, {
      requestId,
      route: url.pathname,
      createdAt: nowIso,
    })
  } catch {
    return Response.json(
      { error: "Bridge request has already been consumed" },
      { status: 409 }
    )
  }

  await sageBridgeHeartbeatStatement(env.DB, "pay-application-poller", nowIso).run()

  const candidates = await db
    .select({ id: sagePayApplicationSyncRuns.id })
    .from(sagePayApplicationSyncRuns)
    .where(
      or(
        eq(sagePayApplicationSyncRuns.status, "queued"),
        and(
          eq(sagePayApplicationSyncRuns.status, "running"),
          lt(sagePayApplicationSyncRuns.claimedAt, staleClaimIso)
        ),
        and(
          eq(sagePayApplicationSyncRuns.status, "processing"),
          lt(sagePayApplicationSyncRuns.claimedAt, staleIngestIso)
        )
      )
    )
    .orderBy(asc(sagePayApplicationSyncRuns.requestedAt))
    .limit(limit)

  const requests: {
    id: string
    projectId: string
    sageJobId: string | null
    sageJobNumber: string | null
    claimToken: string
    attempt: number
    requestedAt: string
  }[] = []
  for (const candidate of candidates) {
    const claimToken = crypto.randomUUID()
    await updateSagePayApplicationSyncRuns(
      db,
      {
        status: "running",
        claimToken,
        claimedAt: nowIso,
        attemptCount: sql`${sagePayApplicationSyncRuns.attemptCount} + 1`,
        updatedAt: nowIso,
      },
      and(
        eq(sagePayApplicationSyncRuns.id, candidate.id),
        or(
          eq(sagePayApplicationSyncRuns.status, "queued"),
          and(
            eq(sagePayApplicationSyncRuns.status, "running"),
            lt(sagePayApplicationSyncRuns.claimedAt, staleClaimIso)
          ),
          and(
            eq(sagePayApplicationSyncRuns.status, "processing"),
            lt(sagePayApplicationSyncRuns.claimedAt, staleIngestIso)
          )
        )
      )
    )
    const claimed = await db
      .select()
      .from(sagePayApplicationSyncRuns)
      .where(
        and(
          eq(sagePayApplicationSyncRuns.id, candidate.id),
          eq(sagePayApplicationSyncRuns.claimToken, claimToken),
          eq(sagePayApplicationSyncRuns.status, "running")
        )
      )
      .limit(1)
      .get()
    if (!claimed) continue
    requests.push({
      id: claimed.id,
      projectId: claimed.projectId,
      sageJobId: claimed.sageJobId,
      sageJobNumber: claimed.sageJobNumber,
      claimToken,
      attempt: claimed.attemptCount,
      requestedAt: claimed.requestedAt,
    })
  }

  return Response.json({ requests })
}
