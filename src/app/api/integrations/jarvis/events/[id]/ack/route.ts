import { and, eq } from "drizzle-orm"
import { z } from "zod/v4"
import { getDb } from "@/db"
import { feedbackDeskItems, jarvisBridgeEvents } from "@/db/schema-jarvis"
import { getCloudflareContext } from "@/lib/db"
import {
  getJarvisBridgeSecrets,
  readBoundedBody,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"
import { knownFeedbackStatus } from "@/lib/jarvis/feedback-lifecycle"
import { feedbackDeliveryGraphIsComplete } from "@/lib/jarvis/feedback-lifecycle-evidence"
import {
  applyFeedbackLifecycleUpdate,
  processFeedbackRequesterNotification,
} from "@/lib/jarvis/feedback-status-update"
import { feedbackDeliveryGraphUpdate } from "@/lib/jarvis/feedback-delivery"
import { jarvisPayloadAfterCompletion } from "@/lib/jarvis/visual-context"

const acknowledgementSchema = z.object({
  status: z.enum(["completed", "failed"]),
  result: z.unknown().optional(),
  error: z.string().max(2000).optional(),
  retryAfterSeconds: z.number().int().min(1).max(86_400).optional(),
})

export async function POST(
  request: Request,
  { params }: {
    readonly params: Promise<{ readonly id: string }>
  },
): Promise<Response> {
  const bodyResult = await readBoundedBody(request)
  if (!bodyResult.success) {
    return Response.json(
      { error: bodyResult.error },
      { status: 413 },
    )
  }

  const { env } = await getCloudflareContext()
  const secrets = getJarvisBridgeSecrets(env)
  if (!secrets) {
    return Response.json(
      { error: "Jarvis bridge is not configured" },
      { status: 503 },
    )
  }

  const verification = await verifyJarvisRequest(
    request,
    secrets,
    bodyResult.rawBody,
  )
  if (!verification.success) {
    return Response.json(
      { error: verification.error },
      { status: 401 },
    )
  }

  let body: unknown
  try {
    body = JSON.parse(bodyResult.rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = acknowledgementSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid acknowledgement" },
      { status: 400 },
    )
  }

  const { id } = await params
  const now = new Date()
  const nowIso = now.toISOString()
  const shouldRetry =
    parsed.data.status === "failed" &&
    parsed.data.retryAfterSeconds !== undefined
  const retryAfterSeconds =
    parsed.data.retryAfterSeconds ?? 0
  const retryAt = shouldRetry
    ? new Date(
        now.getTime() + retryAfterSeconds * 1000,
      ).toISOString()
    : nowIso
  const db = getDb(env.DB)

  const existing = await db
    .select({
      id: jarvisBridgeEvents.id,
      eventType: jarvisBridgeEvents.eventType,
      idempotencyKey: jarvisBridgeEvents.idempotencyKey,
      payload: jarvisBridgeEvents.payload,
      feedbackDeskItemId: jarvisBridgeEvents.feedbackDeskItemId,
    })
    .from(jarvisBridgeEvents)
    .where(
      and(
        eq(jarvisBridgeEvents.id, id),
        eq(jarvisBridgeEvents.direction, "outbound"),
      ),
    )
    .get()

  if (!existing) {
    return Response.json({ error: "Event not found" }, { status: 404 })
  }

  const feedbackItem = existing.feedbackDeskItemId
    ? await db.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, existing.feedbackDeskItemId))
      .get()
    : null

  if (
    existing.eventType === "feedback.status_changed" &&
    existing.feedbackDeskItemId
  ) {
    try {
      await processFeedbackRequesterNotification(db, {
        id: existing.id,
        idempotencyKey: existing.idempotencyKey,
        feedbackDeskItemId: existing.feedbackDeskItemId,
      })
    } catch (error) {
      return Response.json({
        success: false,
        retryable: true,
        error: error instanceof Error
          ? error.message
          : "Requester notification persistence failed",
      }, { status: 503 })
    }
  }

  if (
    existing.eventType === "feedback.delivery_requested" &&
    parsed.data.status === "completed"
  ) {
    if (!feedbackItem || !feedbackDeliveryGraphIsComplete(feedbackItem)) {
      const retrySeconds = parsed.data.retryAfterSeconds ?? 60
      const retryAt = new Date(
        now.getTime() + retrySeconds * 1000,
      ).toISOString()
      await db.update(jarvisBridgeEvents).set({
        status: "pending",
        result: null,
        lastError: "Delivery graph attachment is incomplete",
        availableAt: retryAt,
        claimToken: null,
        claimedAt: null,
        completedAt: null,
        updatedAt: nowIso,
      }).where(eq(jarvisBridgeEvents.id, id))
      return Response.json({
        success: false,
        retryable: true,
        error: "Complete the durable delivery graph before acknowledging this event",
        retryAfterSeconds: retrySeconds,
      }, { status: 409 })
    }
  }

  await db
    .update(jarvisBridgeEvents)
    .set({
      status: shouldRetry ? "pending" : parsed.data.status,
      result:
        parsed.data.result === undefined
          ? null
          : JSON.stringify(parsed.data.result),
      lastError: parsed.data.error ?? null,
      availableAt: retryAt,
      claimToken: null,
      claimedAt: null,
      completedAt:
        parsed.data.status === "completed" ? nowIso : null,
      payload:
        !shouldRetry && existing.eventType === "agent.prompt"
          ? jarvisPayloadAfterCompletion(existing.payload)
          : existing.payload,
      updatedAt: nowIso,
    })
    .where(eq(jarvisBridgeEvents.id, id))

  if (
    existing.eventType === "feedback.delivery_requested" &&
    parsed.data.status === "failed" &&
    feedbackItem
  ) {
    const failureIdempotencyKey = `feedback-delivery-failed:${id}`
    const failureAlreadyReported = await db
      .select({ id: jarvisBridgeEvents.id })
      .from(jarvisBridgeEvents)
      .where(eq(jarvisBridgeEvents.idempotencyKey, failureIdempotencyKey))
      .get()
    if (!failureAlreadyReported) {
      const deliveryGraph = feedbackDeliveryGraphUpdate({
          status: "failed",
          error: parsed.data.error ?? "Delivery worker failed",
      })
      if (deliveryGraph) {
        await applyFeedbackLifecycleUpdate(db, feedbackItem, {
          status: knownFeedbackStatus(feedbackItem.status),
          deliveryGraph,
          deliveryRoute: "engineering",
          actorSource: "jarvis",
          idempotencyKey: failureIdempotencyKey,
        })
      }
    }
  }

  return Response.json({ success: true })
}
