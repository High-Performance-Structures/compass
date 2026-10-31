import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm"

import { getDb } from "@/db"
import {
  sageBridgeRequestNonces,
  sageSquarePaymentOperations,
} from "@/db/schema-sage"
import { getCloudflareContext } from "@/lib/db"
import {
  SAGE_BRIDGE_NONCE_RETENTION_MS,
  sageBridgeBatchLimit,
  sageBridgeCutoff,
} from "@/lib/domain/sage-bridge/rules"
import { updateSageSquarePaymentOperations } from "@/lib/domain/sage-bridge/square-store"
import {
  deleteSageBridgeRequestNonces,
  insertSageBridgeRequestNonce,
  sageBridgeHeartbeatStatement,
} from "@/lib/domain/sage-bridge/store"
import {
  getSageBridgeSecret,
  SAGE_BRIDGE_REQUEST_ID_HEADER,
  verifySageBridgeRequest,
} from "@/lib/sage/bridge-auth"
import {
  sageSquarePaymentPayloadSchema,
  sageSquareTestOperationIds,
  sageSquareWritesEnabled,
} from "@/lib/sage/square-payment"

const MAX_BATCH = 10
const CLAIM_RETRY_MILLISECONDS = 10 * 60 * 1000

function unauthorized(error: string): Response {
  return Response.json({ error }, { status: 401 })
}

export async function GET(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const secret = getSageBridgeSecret(env)
  if (!secret) {
    return Response.json({ error: "Sage bridge is not configured" }, { status: 503 })
  }
  // With writes off, only fees named for a controlled test can be claimed.
  const writesEnabled = sageSquareWritesEnabled(env)
  const testOperationIds = writesEnabled ? [] : sageSquareTestOperationIds(env)
  if (!writesEnabled && testOperationIds.length === 0) {
    return Response.json(
      { error: "Sage Square payment writes are disabled" },
      { status: 503 }
    )
  }
  const verification = await verifySageBridgeRequest(request, secret, "")
  if (!verification.success) return unauthorized(verification.error)
  const url = new URL(request.url)
  const requestId = request.headers.get(SAGE_BRIDGE_REQUEST_ID_HEADER)
  if (!requestId) return unauthorized("Missing bridge signature")
  const limit = sageBridgeBatchLimit(url.searchParams.get("limit"), 5, MAX_BATCH)
  const now = new Date()
  const nowIso = now.toISOString()
  const staleClaimIso = sageBridgeCutoff(now, CLAIM_RETRY_MILLISECONDS)
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

  await sageBridgeHeartbeatStatement(env.DB, "square-payment-writer", nowIso).run()

  const candidates = await db
    .select({ id: sageSquarePaymentOperations.id })
    .from(sageSquarePaymentOperations)
    .where(
      and(
        eq(
          sageSquarePaymentOperations.operationType,
          "post_square_processing_fee"
        ),
        ...(writesEnabled ? [] : [inArray(sageSquarePaymentOperations.id, [...testOperationIds])]),
        or(
          eq(sageSquarePaymentOperations.status, "queued"),
          and(
            eq(sageSquarePaymentOperations.status, "running"),
            lt(sageSquarePaymentOperations.claimedAt, staleClaimIso)
          )
        )
      )
    )
    .orderBy(asc(sageSquarePaymentOperations.requestedAt))
    .limit(limit)

  const requests: unknown[] = []
  for (const candidate of candidates) {
    const claimToken = crypto.randomUUID()
    await updateSageSquarePaymentOperations(
      db,
      {
        status: "running",
        claimToken,
        claimedAt: nowIso,
        attemptCount: sql`${sageSquarePaymentOperations.attemptCount} + 1`,
        updatedAt: nowIso,
      },
      and(
        eq(sageSquarePaymentOperations.id, candidate.id),
        eq(
          sageSquarePaymentOperations.operationType,
          "post_square_processing_fee"
        ),
        or(
          eq(sageSquarePaymentOperations.status, "queued"),
          and(
            eq(sageSquarePaymentOperations.status, "running"),
            lt(sageSquarePaymentOperations.claimedAt, staleClaimIso)
          )
        )
      )
    )
    const claimed = await db
      .select()
      .from(sageSquarePaymentOperations)
      .where(
        and(
          eq(sageSquarePaymentOperations.id, candidate.id),
          eq(sageSquarePaymentOperations.claimToken, claimToken),
          eq(sageSquarePaymentOperations.status, "running")
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!claimed) continue
    let payload: unknown
    try {
      payload = JSON.parse(claimed.payloadJson)
    } catch {
      payload = null
    }
    const validated = sageSquarePaymentPayloadSchema.safeParse(payload)
    if (!validated.success) {
      await updateSageSquarePaymentOperations(
        db,
        {
          status: "failed",
          errorMessage: "Stored Sage Square payment payload failed validation",
          completedAt: nowIso,
          updatedAt: nowIso,
        },
        eq(sageSquarePaymentOperations.id, claimed.id)
      )
      continue
    }
    requests.push({
      id: claimed.id,
      claimToken,
      attempt: claimed.attemptCount,
      requestedAt: claimed.requestedAt,
      payload: validated.data,
    })
  }
  return Response.json({ requests })
}
