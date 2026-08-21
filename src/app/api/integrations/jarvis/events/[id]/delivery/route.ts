import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { feedbackDeskItems, jarvisBridgeEvents } from "@/db/schema-jarvis"
import { getCloudflareContext } from "@/lib/db"
import {
  getJarvisBridgeSecrets,
  readBoundedBody,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"

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

function eventMessage(payload: string): string {
  try {
    const parsed: unknown = JSON.parse(payload)
    if (typeof parsed !== "object" || parsed === null) {
      return "Your Compass request has a new update."
    }
    const value = Reflect.get(parsed, "message")
    return typeof value === "string" && value.trim().length > 0
      ? value.trim().slice(0, 2_000)
      : "Your Compass request has a new update."
  } catch {
    return "Your Compass request has a new update."
  }
}

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  const bodyResult = await readBoundedBody(request)
  if (!bodyResult.success) {
    return Response.json({ error: bodyResult.error }, { status: 413 })
  }
  const { env } = await getCloudflareContext()
  const secrets = getJarvisBridgeSecrets(env)
  if (!secrets) {
    return Response.json({ error: "Jarvis bridge is not configured" }, { status: 503 })
  }
  const verification = await verifyJarvisRequest(
    request,
    secrets,
    bodyResult.rawBody,
  )
  if (!verification.success) {
    return Response.json({ error: verification.error }, { status: 401 })
  }

  const { id } = await params
  const db = getDb(env.DB)
  const event = await db
    .select({
      source: jarvisBridgeEvents.source,
      eventType: jarvisBridgeEvents.eventType,
      payload: jarvisBridgeEvents.payload,
      feedbackDeskItemId: jarvisBridgeEvents.feedbackDeskItemId,
    })
    .from(jarvisBridgeEvents)
    .where(and(
      eq(jarvisBridgeEvents.id, id),
      eq(jarvisBridgeEvents.direction, "outbound"),
      eq(jarvisBridgeEvents.eventType, "feedback.status_changed"),
    ))
    .get()
  if (!event?.feedbackDeskItemId) {
    return Response.json({ error: "Feedback delivery event not found" }, { status: 404 })
  }

  const item = await db
    .select({ reporterEmail: feedbackDeskItems.reporterEmail, metadata: feedbackDeskItems.metadata })
    .from(feedbackDeskItems)
    .where(eq(feedbackDeskItems.id, event.feedbackDeskItemId))
    .get()
  if (!item) {
    return Response.json({ error: "Feedback request not found" }, { status: 404 })
  }

  return Response.json({
    eventType: event.eventType,
    source: event.source,
    message: eventMessage(event.payload),
    deliveryTarget: {
      externalActorId: metadataActorId(item.metadata),
      email: item.reporterEmail?.trim().toLowerCase() ?? null,
    },
  })
}
