import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { feedbackDeskItems, jarvisBridgeEvents } from "@/db/schema-jarvis"
import { getCloudflareContext } from "@/lib/db"
import {
  getJarvisBridgeSecrets,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"
import {
  feedbackStatusMessage,
  knownFeedbackStatus,
} from "@/lib/jarvis/feedback-lifecycle"

function metadataActorId(metadata: string | null): string | null {
  if (!metadata) return null
  try {
    const parsed: unknown = JSON.parse(metadata)
    if (typeof parsed !== "object" || parsed === null) return null
    const value = Reflect.get(parsed, "externalActorId")
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null
  } catch {
    return null
  }
}

function eventMessage(
  payload: string,
  item: Readonly<{ title: string; kind: string }>,
): string {
  try {
    const parsed: unknown = JSON.parse(payload)
    if (typeof parsed !== "object" || parsed === null) {
      return feedbackStatusMessage("new", item.title, item.kind)
    }
    const rawStatus = Reflect.get(parsed, "status")
    const rawKind = Reflect.get(parsed, "notificationKind")
    const status = knownFeedbackStatus(
      typeof rawStatus === "string" ? rawStatus : "new",
    )
    if (rawKind === "delivery_graph_created") {
      return "Your Compass request now has accountable engineering work."
    }
    if (rawKind === "delivery_graph_failed") {
      return "Your Compass request could not enter engineering work yet and will be retried."
    }
    return feedbackStatusMessage(status, item.title, item.kind)
  } catch {
    return feedbackStatusMessage("new", item.title, item.kind)
  }
}

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  const { env } = await getCloudflareContext()
  const secrets = getJarvisBridgeSecrets(env)
  if (!secrets) {
    return Response.json({ error: "Jarvis bridge is not configured" }, { status: 503 })
  }
  const verification = await verifyJarvisRequest(
    request,
    secrets,
    "",
  )
  if (!verification.success) {
    return Response.json({ error: verification.error }, { status: 401 })
  }

  const { id } = await params
  const requestUrl = new URL(request.url)
  const claimToken = request.headers.get("X-Compass-Claim-Token")
  if (
    requestUrl.search.length > 0 ||
    !claimToken ||
    claimToken.length > 128
  ) {
    return Response.json({ error: "Invalid event claim" }, { status: 400 })
  }

  const nowIso = new Date().toISOString()
  const replacementClaimToken = crypto.randomUUID()
  const db = getDb(env.DB)
  const event = await db
    .update(jarvisBridgeEvents)
    .set({
      claimToken: replacementClaimToken,
      claimedAt: nowIso,
      result: null,
      updatedAt: nowIso,
    })
    .where(and(
      eq(jarvisBridgeEvents.id, id),
      eq(jarvisBridgeEvents.direction, "outbound"),
      eq(jarvisBridgeEvents.eventType, "feedback.status_changed"),
      eq(jarvisBridgeEvents.status, "processing"),
      eq(jarvisBridgeEvents.claimToken, claimToken),
    ))
    .returning({
      source: jarvisBridgeEvents.source,
      eventType: jarvisBridgeEvents.eventType,
      payload: jarvisBridgeEvents.payload,
      feedbackDeskItemId: jarvisBridgeEvents.feedbackDeskItemId,
      claimToken: jarvisBridgeEvents.claimToken,
    })
    .get()
  if (!event) {
    return Response.json(
      { error: "Event claim is no longer active" },
      { status: 409 },
    )
  }
  if (!event.feedbackDeskItemId) {
    return Response.json({ error: "Feedback delivery event is incomplete" }, { status: 409 })
  }

  const item = await db
    .select({
      reporterEmail: feedbackDeskItems.reporterEmail,
      metadata: feedbackDeskItems.metadata,
      title: feedbackDeskItems.title,
      kind: feedbackDeskItems.kind,
    })
    .from(feedbackDeskItems)
    .where(eq(feedbackDeskItems.id, event.feedbackDeskItemId))
    .get()
  if (!item) {
    return Response.json({ error: "Feedback request not found" }, { status: 404 })
  }

  return Response.json({
    claimToken: event.claimToken,
    eventType: event.eventType,
    source: event.source,
    message: eventMessage(event.payload, item),
    deliveryTarget: {
      externalActorId: metadataActorId(item.metadata),
      email: item.reporterEmail?.trim().toLowerCase() ?? null,
    },
  })
}
