import { and, eq, or, sql } from "drizzle-orm"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { organizationMembers, users } from "@/db/schema"
import {
  feedbackDeskItems,
  jarvisBridgeEvents,
} from "@/db/schema-jarvis"
import { getCloudflareContext } from "@/lib/db"
import {
  getJarvisEnvValue,
  readBoundedBody,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"
import {
  FEEDBACK_DESK_STATUSES,
  feedbackStatusLabel,
  feedbackDraftPullRequestMessage,
  feedbackRequesterUpdateKind,
  feedbackStatusMessage,
  feedbackStatusUsesEmail,
} from "@/lib/jarvis/feedback-lifecycle"
import { createSystemNotificationEvent } from "@/lib/notifications/events"

const statusUpdateSchema = z.object({
  idempotencyKey: z.string().min(1).max(256),
  status: z.enum(FEEDBACK_DESK_STATUSES),
  message: z.string().min(1).max(2_000).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  githubIssueUrl: z.union([z.url().max(2_048), z.null()]).optional(),
  draftPullRequestUrl: z
    .union([z.url().max(2_048), z.null()])
    .optional(),
})

function metadataActorId(metadata: string | null): string | null {
  if (!metadata) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(metadata)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const actorId = Reflect.get(parsed, "externalActorId")
  return typeof actorId === "string" && actorId.length > 0
    ? actorId
    : null
}

export async function POST(
  request: Request,
  { params }: {
    readonly params: Promise<{ readonly id: string }>
  }
): Promise<Response> {
  const bodyResult = await readBoundedBody(request)
  if (!bodyResult.success) {
    return Response.json(
      { error: bodyResult.error },
      { status: 413 }
    )
  }

  const { env } = await getCloudflareContext()
  const secret = getJarvisEnvValue(env, "JARVIS_BRIDGE_SECRET")
  const organizationId = getJarvisEnvValue(
    env,
    "JARVIS_BRIDGE_ORGANIZATION_ID"
  )
  if (!secret || !organizationId) {
    return Response.json(
      { error: "Jarvis lifecycle bridge is not configured" },
      { status: 503 }
    )
  }

  const verification = await verifyJarvisRequest(
    request,
    secret,
    bodyResult.rawBody
  )
  if (!verification.success) {
    return Response.json(
      { error: verification.error },
      { status: 401 }
    )
  }

  let body: unknown
  try {
    body = JSON.parse(bodyResult.rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = statusUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid feedback status update",
        details: parsed.error.issues,
      },
      { status: 400 }
    )
  }

  const { id } = await params
  const db = getDb(env.DB)
  const eventKey =
    `feedback-status:${id}:${parsed.data.idempotencyKey}`
  const duplicate = await db
    .select({ id: jarvisBridgeEvents.id })
    .from(jarvisBridgeEvents)
    .where(eq(jarvisBridgeEvents.idempotencyKey, eventKey))
    .get()
  if (duplicate) {
    return Response.json({ success: true, duplicate: true })
  }

  const item = await db
    .select()
    .from(feedbackDeskItems)
    .where(
      and(
        eq(feedbackDeskItems.id, id),
        eq(feedbackDeskItems.organizationId, organizationId)
      )
    )
    .get()
  if (!item) {
    return Response.json(
      { error: "Feedback request not found" },
      { status: 404 }
    )
  }

  // Only Ask Jarvis carries an authenticated Compass user ID. External
  // adapter actor IDs (Telegram/email) must never be treated as user IDs.
  const actorId =
    item.source === "ask-jarvis"
      ? metadataActorId(item.metadata)
      : null
  const reporterEmail = item.reporterEmail?.trim().toLowerCase()
  const recipientFilter =
    actorId && reporterEmail
      ? or(
          eq(users.id, actorId),
          sql`lower(${users.email}) = ${reporterEmail}`,
          sql`lower(${users.googleEmail}) = ${reporterEmail}`
        )
      : actorId
        ? eq(users.id, actorId)
        : reporterEmail
          ? or(
              sql`lower(${users.email}) = ${reporterEmail}`,
              sql`lower(${users.googleEmail}) = ${reporterEmail}`
            )
          : null
  const recipients = recipientFilter
    ? await db
        .select({
          userId: users.id,
          email: users.email,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(
          and(
            eq(
              organizationMembers.organizationId,
              organizationId
            ),
            eq(users.isActive, true),
            recipientFilter
          )
        )
    : []

  const draftPullRequestUrl =
    parsed.data.draftPullRequestUrl === undefined
      ? item.githubDraftPullRequestUrl
      : parsed.data.draftPullRequestUrl
  const requesterUpdateKind = feedbackRequesterUpdateKind(
    item.status,
    parsed.data.status,
    item.githubDraftPullRequestUrl,
    draftPullRequestUrl,
  )
  const hasDraftPullRequestUpdate =
    draftPullRequestUrl !== null &&
    draftPullRequestUrl !== item.githubDraftPullRequestUrl
  const now = new Date().toISOString()
  const message =
    parsed.data.message ??
    (hasDraftPullRequestUpdate
      ? feedbackDraftPullRequestMessage(item.title, draftPullRequestUrl)
      : feedbackStatusMessage(parsed.data.status, item.title))
  await db
    .update(feedbackDeskItems)
    .set({
      status: parsed.data.status,
      priority: parsed.data.priority ?? item.priority,
      githubIssueUrl:
        parsed.data.githubIssueUrl === undefined
          ? item.githubIssueUrl
          : parsed.data.githubIssueUrl,
      githubDraftPullRequestUrl: draftPullRequestUrl,
      updatedAt: now,
    })
    .where(eq(feedbackDeskItems.id, id))

  if (requesterUpdateKind && recipients.length > 0) {
    try {
      await createSystemNotificationEvent({
        organizationId,
        projectId: null,
        eventType: `feedback.status.${parsed.data.status}`,
        sourceType: "feedback",
        sourceId: id,
        title: `Request update: ${feedbackStatusLabel(parsed.data.status)}`,
        body: message,
        href: `/dashboard/requests#request-${id}`,
        priority:
          parsed.data.status === "needs_info" ? "high" : "normal",
        audience: "requester",
        recipients,
        delivery: {
          inApp: true,
          email: feedbackStatusUsesEmail(parsed.data.status),
          push: feedbackStatusUsesEmail(parsed.data.status),
        },
      })
    } catch (error) {
      console.error("feedback_lifecycle_notification_failed", {
        feedbackDeskItemId: id,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      })
    }
  }

  const statusPayload = JSON.stringify({
    schemaVersion: 1,
    feedbackDeskItemId: id,
    source: item.source,
    sourceId: item.sourceId,
    status: parsed.data.status,
    title: item.title,
    message,
    reporter: {
      name: item.reporterName,
      email: item.reporterEmail,
      externalActorId: actorId,
    },
    compass: {
      organizationId,
      channelId: item.channelId,
      messageId: item.messageId,
      threadId: item.threadId,
    },
    metadata: item.metadata,
    githubIssueUrl:
      parsed.data.githubIssueUrl === undefined
        ? item.githubIssueUrl
        : parsed.data.githubIssueUrl,
    draftPullRequestUrl,
    notificationKind: requesterUpdateKind,
    updatedAt: now,
  })

  await db.insert(jarvisBridgeEvents).values({
    id: crypto.randomUUID(),
    organizationId,
    direction: "inbound",
    source: "signet",
    eventType: "feedback.status_updated",
    status: "completed",
    idempotencyKey: eventKey,
    feedbackDeskItemId: id,
    payload: bodyResult.rawBody,
    result: statusPayload,
    availableAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  if (requesterUpdateKind) {
    await db
      .insert(jarvisBridgeEvents)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        direction: "outbound",
        source: item.source,
        eventType: "feedback.status_changed",
        idempotencyKey: `notify:${eventKey}`,
        feedbackDeskItemId: id,
        payload: statusPayload,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
  }

  return Response.json({
    success: true,
    feedbackDeskItemId: id,
    status: parsed.data.status,
    notifiedUserCount: requesterUpdateKind ? recipients.length : 0,
    requesterUpdateQueued: requesterUpdateKind !== null,
  })
}
