import { and, asc, eq, lt, or, sql } from "drizzle-orm"

import { getDb } from "@/db"
import {
  sageBridgeRequestNonces,
  sageSquarePaymentOperations,
} from "@/db/schema-sage"
import { getCloudflareContext } from "@/lib/db"
import {
  getSageBridgeSecret,
  SAGE_BRIDGE_REQUEST_ID_HEADER,
  verifySageBridgeRequest,
} from "@/lib/sage/bridge-auth"
import {
  sageSquarePaymentPayloadSchema,
  sageSquareWritesEnabled,
} from "@/lib/sage/square-payment"

const MAX_BATCH = 10
const CLAIM_RETRY_MILLISECONDS = 10 * 60 * 1000
const NONCE_RETENTION_MILLISECONDS = 15 * 60 * 1000

function unauthorized(error: string): Response {
  return Response.json({ error }, { status: 401 })
}

export async function GET(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const secret = getSageBridgeSecret(env)
  if (!secret) {
    return Response.json({ error: "Sage bridge is not configured" }, { status: 503 })
  }
  if (!sageSquareWritesEnabled(env)) {
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
  const requestedLimit = Number(url.searchParams.get("limit") ?? "5")
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(MAX_BATCH, Math.max(1, requestedLimit))
    : 5
  const now = new Date()
  const nowIso = now.toISOString()
  const staleClaimIso = new Date(
    now.getTime() - CLAIM_RETRY_MILLISECONDS
  ).toISOString()
  const db = getDb(env.DB)

  await db
    .delete(sageBridgeRequestNonces)
    .where(
      lt(
        sageBridgeRequestNonces.createdAt,
        new Date(now.getTime() - NONCE_RETENTION_MILLISECONDS).toISOString()
      )
    )
  try {
    await db.insert(sageBridgeRequestNonces).values({
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

  await env.DB.prepare(
    `INSERT INTO sage_bridge_status (id, last_seen_at, updated_at)
     VALUES ('square-payment-writer', ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       updated_at = excluded.updated_at`
  )
    .bind(nowIso, nowIso)
    .run()

  const candidates = await db
    .select({ id: sageSquarePaymentOperations.id })
    .from(sageSquarePaymentOperations)
    .where(
      or(
        eq(sageSquarePaymentOperations.status, "queued"),
        and(
          eq(sageSquarePaymentOperations.status, "running"),
          lt(sageSquarePaymentOperations.claimedAt, staleClaimIso)
        )
      )
    )
    .orderBy(asc(sageSquarePaymentOperations.requestedAt))
    .limit(limit)

  const requests: unknown[] = []
  for (const candidate of candidates) {
    const claimToken = crypto.randomUUID()
    await db
      .update(sageSquarePaymentOperations)
      .set({
        status: "running",
        claimToken,
        claimedAt: nowIso,
        attemptCount: sql`${sageSquarePaymentOperations.attemptCount} + 1`,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(sageSquarePaymentOperations.id, candidate.id),
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
      await db
        .update(sageSquarePaymentOperations)
        .set({
          status: "failed",
          errorMessage: "Stored Sage Square payment payload failed validation",
          completedAt: nowIso,
          updatedAt: nowIso,
        })
        .where(eq(sageSquarePaymentOperations.id, claimed.id))
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
