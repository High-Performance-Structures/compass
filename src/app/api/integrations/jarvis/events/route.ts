import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm"
import { z } from "zod/v4"
import { getDb } from "@/db"
import {
  feedbackDeskItems,
  jarvisBridgeEvents,
} from "@/db/schema-jarvis"
import { getCloudflareContext } from "@/lib/db"
import {
  getJarvisBridgeSecrets,
  getJarvisEnvValue,
  readBoundedBody,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"
import { RECLAIMABLE_RESERVATION_RESULTS } from "@/lib/jarvis/bridge-reservation"
import { linkFeedbackDeskItemToGithub } from "@/lib/jarvis/feedback-github"
import { enqueueFeedbackReceipt } from "@/lib/jarvis/feedback-desk"
import { jarvisPayloadForDelivery } from "@/lib/jarvis/visual-context"

const CLAIM_RETRY_MILLISECONDS = 5 * 60 * 1000
const MAX_EVENT_BATCH = 50

type EventTypeFilter =
  | "agent.prompt"
  | "feedback.status_changed"
  | "feedback.delivery_requested"
  | "feedback.lifecycle_requested"

function isEventTypeFilter(value: string): value is EventTypeFilter {
  return (
    value === "agent.prompt" ||
    value === "feedback.status_changed" ||
    value === "feedback.delivery_requested" ||
    value === "feedback.lifecycle_requested"
  )
}

const inboundEventSchema = z.object({
  source: z.enum(["telegram", "jarvis-email", "ask-jarvis"]),
  sourceEventId: z.string().min(1).max(256),
  eventType: z.enum([
    "feedback.reported",
    "assistance.requested",
  ]),
  kind: z
    .enum(["assistance", "bug", "feature", "question", "general"])
    .default("general"),
  title: z.string().min(1).max(160),
  content: z.string().min(1).max(10_000),
  actor: z
    .object({
      name: z.string().max(160).optional(),
      email: z.email().optional(),
      externalId: z.string().max(256).optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

function jsonValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function unauthorized(error: string): Response {
  return Response.json({ error }, { status: 401 })
}

export async function GET(request: Request): Promise<Response> {
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
    "",
  )
  if (!verification.success) {
    return unauthorized(verification.error)
  }

  const url = new URL(request.url)
  const requestedLimit = Number(url.searchParams.get("limit") ?? "20")
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(MAX_EVENT_BATCH, Math.max(1, requestedLimit))
    : 20
  const requestedEventType = url.searchParams.get("eventType")
  if (
    requestedEventType !== null &&
    !isEventTypeFilter(requestedEventType)
  ) {
    return Response.json(
      { error: "Unsupported event type filter" },
      { status: 400 },
    )
  }
  const eventTypeFilter =
    requestedEventType !== null
      ? eq(jarvisBridgeEvents.eventType, requestedEventType)
      : undefined
  const now = new Date()
  const nowIso = now.toISOString()
  const staleClaimIso = new Date(
    now.getTime() - CLAIM_RETRY_MILLISECONDS,
  ).toISOString()
  const db = getDb(env.DB)

  const candidates = await db
    .select({ id: jarvisBridgeEvents.id })
    .from(jarvisBridgeEvents)
    .where(
      and(
        eq(jarvisBridgeEvents.direction, "outbound"),
        eventTypeFilter,
        lte(jarvisBridgeEvents.availableAt, nowIso),
        or(
          eq(jarvisBridgeEvents.status, "pending"),
          and(
            eq(jarvisBridgeEvents.status, "processing"),
            or(
              isNull(jarvisBridgeEvents.result),
              inArray(
                jarvisBridgeEvents.result,
                RECLAIMABLE_RESERVATION_RESULTS,
              ),
            ),
            lt(jarvisBridgeEvents.claimedAt, staleClaimIso),
          ),
        ),
      ),
    )
    .orderBy(asc(jarvisBridgeEvents.createdAt))
    .limit(limit)

  const claimTokens: string[] = []
  for (const candidate of candidates) {
    const claimToken = crypto.randomUUID()
    claimTokens.push(claimToken)
    await db
      .update(jarvisBridgeEvents)
      .set({
        status: "processing",
        claimToken,
        claimedAt: nowIso,
        attemptCount: sql`${jarvisBridgeEvents.attemptCount} + 1`,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(jarvisBridgeEvents.id, candidate.id),
          eq(jarvisBridgeEvents.direction, "outbound"),
          eventTypeFilter,
          lte(jarvisBridgeEvents.availableAt, nowIso),
          or(
            eq(jarvisBridgeEvents.status, "pending"),
            and(
              eq(jarvisBridgeEvents.status, "processing"),
              or(
                isNull(jarvisBridgeEvents.result),
                inArray(
                  jarvisBridgeEvents.result,
                  RECLAIMABLE_RESERVATION_RESULTS,
                ),
              ),
              lt(jarvisBridgeEvents.claimedAt, staleClaimIso),
            ),
          ),
        ),
      )
  }

  if (claimTokens.length === 0) {
    return Response.json({ events: [] })
  }

  const claimed = await db
    .select()
    .from(jarvisBridgeEvents)
    .where(
      and(
        eq(jarvisBridgeEvents.direction, "outbound"),
        eventTypeFilter,
        eq(jarvisBridgeEvents.status, "processing"),
        inArray(jarvisBridgeEvents.claimToken, claimTokens),
      ),
    )
    .orderBy(asc(jarvisBridgeEvents.createdAt))

  return Response.json({
    events: claimed.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      source: event.source,
      attempt: event.attemptCount,
      claimToken: event.claimToken,
      payload:
        event.eventType === "agent.prompt"
          ? jarvisPayloadForDelivery(event.id, event.payload)
          : jsonValue(event.payload),
      createdAt: event.createdAt,
    })),
  })
}

export async function POST(request: Request): Promise<Response> {
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
    return unauthorized(verification.error)
  }

  let body: unknown
  try {
    body = JSON.parse(bodyResult.rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = inboundEventSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid Jarvis event", details: parsed.error.issues },
      { status: 400 },
    )
  }

  const event = parsed.data
  const db = getDb(env.DB)
  const now = new Date().toISOString()
  const itemId = crypto.randomUUID()
  const bridgeEventId = crypto.randomUUID()
  const organizationId = getJarvisEnvValue(
    env,
    "JARVIS_BRIDGE_ORGANIZATION_ID",
  )
  const idempotencyKey =
    `inbound:${event.source}:${event.sourceEventId}`

  await db
    .insert(feedbackDeskItems)
    .values({
      id: itemId,
      organizationId,
      source: event.source,
      sourceId: event.sourceEventId,
      kind: event.kind,
      title: event.title,
      description: event.content,
      reporterName: event.actor?.name ?? null,
      reporterEmail: event.actor?.email ?? null,
      metadata: JSON.stringify({
        externalActorId: event.actor?.externalId ?? null,
        externalMetadata: event.metadata ?? {},
        untrustedUserContent: true,
      }),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()

  const item = await db
    .select()
    .from(feedbackDeskItems)
    .where(
      and(
        eq(feedbackDeskItems.source, event.source),
        eq(feedbackDeskItems.sourceId, event.sourceEventId),
      ),
    )
    .get()

  if (!item) {
    return Response.json(
      { error: "Unable to record feedback desk item" },
      { status: 500 },
    )
  }

  await db
    .insert(jarvisBridgeEvents)
    .values({
      id: bridgeEventId,
      organizationId,
      direction: "inbound",
      source: event.source,
      eventType: event.eventType,
      status: "completed",
      idempotencyKey,
      feedbackDeskItemId: item.id,
      payload: bodyResult.rawBody,
      availableAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()

  await enqueueFeedbackReceipt(db, item)
  await linkFeedbackDeskItemToGithub(db, env, item)

  return Response.json(
    { success: true, feedbackDeskItemId: item.id },
    { status: 202 },
  )
}
