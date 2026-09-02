import { and, eq, isNull } from "drizzle-orm"

import { getDb } from "@/db"
import { jarvisBridgeEvents } from "@/db/schema-jarvis"
import { getCloudflareContext } from "@/lib/db"
import {
  getJarvisBridgeSecrets,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"
import {
  isProviderAttemptResult,
  providerAttemptResult,
} from "@/lib/jarvis/bridge-reservation"

function invalidClaim(): Response {
  return Response.json(
    { error: "Event claim is no longer active" },
    { status: 409 },
  )
}

export async function POST(
  request: Request,
  { params }: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  const { env } = await getCloudflareContext()
  const secrets = getJarvisBridgeSecrets(env)
  if (!secrets) {
    return Response.json(
      { error: "Jarvis bridge is not configured" },
      { status: 503 },
    )
  }
  const verification = await verifyJarvisRequest(request, secrets, "")
  if (!verification.success) {
    return Response.json({ error: verification.error }, { status: 401 })
  }

  const url = new URL(request.url)
  const claimToken = request.headers.get("X-Compass-Claim-Token")
  if (url.search.length > 0 || !claimToken || claimToken.length > 128) {
    return Response.json({ error: "Invalid event claim" }, { status: 400 })
  }

  const { id } = await params
  const db = getDb(env.DB)
  const event = await db
    .select({
      result: jarvisBridgeEvents.result,
      source: jarvisBridgeEvents.source,
    })
    .from(jarvisBridgeEvents)
    .where(and(
      eq(jarvisBridgeEvents.id, id),
      eq(jarvisBridgeEvents.direction, "outbound"),
      eq(jarvisBridgeEvents.eventType, "feedback.status_changed"),
      eq(jarvisBridgeEvents.status, "processing"),
      eq(jarvisBridgeEvents.claimToken, claimToken),
    ))
    .get()
  if (!event || !["telegram", "jarvis-email"].includes(event.source)) {
    return invalidClaim()
  }

  if (isProviderAttemptResult(event.result)) {
    return Response.json({
      outcome: "unknown",
      claimToken,
      providerAttempt: event.result,
    })
  }
  if (event.result !== null) return invalidClaim()

  const now = new Date().toISOString()
  const replacementClaimToken = crypto.randomUUID()
  const attempt = providerAttemptResult()
  const reserved = await db
    .update(jarvisBridgeEvents)
    .set({
      claimToken: replacementClaimToken,
      claimedAt: now,
      result: attempt,
      updatedAt: now,
    })
    .where(and(
      eq(jarvisBridgeEvents.id, id),
      eq(jarvisBridgeEvents.direction, "outbound"),
      eq(jarvisBridgeEvents.eventType, "feedback.status_changed"),
      eq(jarvisBridgeEvents.status, "processing"),
      eq(jarvisBridgeEvents.claimToken, claimToken),
      isNull(jarvisBridgeEvents.result),
    ))
    .returning({ id: jarvisBridgeEvents.id })
    .get()
  if (!reserved) return invalidClaim()

  return Response.json({
    outcome: "reserved",
    claimToken: replacementClaimToken,
    providerAttempt: attempt,
  })
}
