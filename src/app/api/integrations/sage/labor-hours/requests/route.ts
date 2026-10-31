import { and, asc, eq, lt, or, sql } from "drizzle-orm"

import { getDb } from "@/db"
import { sageLaborRequests } from "@/db/schema-shop-tickets"
import { getCloudflareContext } from "@/lib/db"
import { sageBridgeCutoff } from "@/lib/domain/sage-bridge/rules"
import {
  insertSageBridgeRequestNonce,
  sageBridgeHeartbeatStatement,
  updateSageLaborRequests,
} from "@/lib/domain/sage-bridge/store"
import {
  getSagePayApplicationBridgeSecret,
  SAGE_BRIDGE_REQUEST_ID_HEADER,
  verifySageBridgeRequest,
} from "@/lib/sage/bridge-auth"

const MAX_BATCH = 10
const CLAIM_RETRY_MILLISECONDS = 5 * 60 * 1000
const MAX_ATTEMPTS = 3

function unauthorized(error: string): Response {
  return Response.json({ error }, { status: 401 })
}

/**
 * The read-only Sage bridge claims queued timecard-hour requests here. A claim
 * that isn't answered within five minutes is offered again, up to three tries.
 */
export async function GET(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const secret = getSagePayApplicationBridgeSecret(env)
  if (!secret) return Response.json({ error: "Sage bridge is not configured" }, { status: 503 })
  const verification = await verifySageBridgeRequest(request, secret, "")
  if (!verification.success) return unauthorized(verification.error)
  const requestId = request.headers.get(SAGE_BRIDGE_REQUEST_ID_HEADER)
  if (!requestId) return unauthorized("Missing bridge signature")

  const url = new URL(request.url)
  const now = new Date()
  const nowIso = now.toISOString()
  const staleClaimIso = sageBridgeCutoff(now, CLAIM_RETRY_MILLISECONDS)
  const db = getDb(env.DB)
  try {
    await insertSageBridgeRequestNonce(db, { requestId, route: url.pathname, createdAt: nowIso })
  } catch {
    return Response.json({ error: "Bridge request has already been consumed" }, { status: 409 })
  }
  await sageBridgeHeartbeatStatement(env.DB, "labor-hours-poller", nowIso).run()

  // Requests whose claims went stale too often fail instead of looping.
  await updateSageLaborRequests(
    db,
    { status: "failed", error: "The Sage bridge did not answer.", updatedAt: nowIso },
    and(
      eq(sageLaborRequests.status, "running"),
      lt(sageLaborRequests.claimedAt, staleClaimIso),
      sql`${sageLaborRequests.attemptCount} >= ${MAX_ATTEMPTS}`,
    ),
  )
  const claimable = or(
    eq(sageLaborRequests.status, "queued"),
    and(eq(sageLaborRequests.status, "running"), lt(sageLaborRequests.claimedAt, staleClaimIso)),
  )
  const candidates = await db
    .select({ id: sageLaborRequests.id })
    .from(sageLaborRequests)
    .where(claimable)
    .orderBy(asc(sageLaborRequests.requestedAt))
    .limit(MAX_BATCH)

  const requests: {
    readonly id: string
    readonly claimToken: string
    readonly projectNumber: string | null
    readonly sageJobNumber: string | null
    readonly dateFrom: string
    readonly dateTo: string
  }[] = []
  for (const candidate of candidates) {
    const claimToken = crypto.randomUUID()
    await updateSageLaborRequests(
      db,
      {
        status: "running",
        claimToken,
        claimedAt: nowIso,
        attemptCount: sql`${sageLaborRequests.attemptCount} + 1`,
        updatedAt: nowIso,
      },
      and(eq(sageLaborRequests.id, candidate.id), claimable),
    )
    const claimed = await db
      .select()
      .from(sageLaborRequests)
      .where(and(eq(sageLaborRequests.id, candidate.id), eq(sageLaborRequests.claimToken, claimToken)))
      .limit(1)
      .get()
    if (!claimed) continue
    requests.push({
      id: claimed.id,
      claimToken,
      projectNumber: claimed.projectNumber,
      sageJobNumber: claimed.sageJobNumber,
      dateFrom: claimed.dateFrom,
      dateTo: claimed.dateTo,
    })
  }
  return Response.json({ requests })
}
