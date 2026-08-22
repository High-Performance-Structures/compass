import { and, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"
import { getDb } from "@/db"
import { organizationMembers, users } from "@/db/schema"
import {
  channelMembers,
  channels,
  messages,
} from "@/db/schema-conversations"
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
import { processFeedbackRequesterNotification } from "@/lib/jarvis/feedback-status-update"

const replySchema = z.object({
  eventId: z.string().min(1).max(128),
  idempotencyKey: z.string().min(1).max(256),
  content: z.string().min(1).max(10_000),
})

type ReplyTarget = {
  readonly organizationId: string
  readonly channelId: string
  readonly messageId: string
}

function replyTarget(payload: string): ReplyTarget | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null

  const compass: unknown = Reflect.get(parsed, "compass")
  if (typeof compass !== "object" || compass === null) return null

  const organizationId: unknown = Reflect.get(
    compass,
    "organizationId",
  )
  const channelId: unknown = Reflect.get(compass, "channelId")
  const messageId: unknown = Reflect.get(compass, "messageId")

  if (
    typeof organizationId !== "string" ||
    typeof channelId !== "string" ||
    typeof messageId !== "string"
  ) {
    return null
  }

  return { organizationId, channelId, messageId }
}

async function deterministicReplyId(key: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  )
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
  return `jarvis-${hex.slice(0, 32)}`
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
  const serviceUserId = getJarvisEnvValue(
    env,
    "JARVIS_SERVICE_USER_ID",
  )
  if (!secrets || !serviceUserId) {
    return Response.json(
      { error: "Jarvis reply bridge is not configured" },
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
  const parsed = replySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid Jarvis reply" },
      { status: 400 },
    )
  }

  const db = getDb(env.DB)
  const sourceEvent = await db
    .select({
      id: jarvisBridgeEvents.id,
      eventType: jarvisBridgeEvents.eventType,
      source: jarvisBridgeEvents.source,
      idempotencyKey: jarvisBridgeEvents.idempotencyKey,
      payload: jarvisBridgeEvents.payload,
      feedbackDeskItemId: jarvisBridgeEvents.feedbackDeskItemId,
    })
    .from(jarvisBridgeEvents)
    .where(
      and(
        eq(jarvisBridgeEvents.id, parsed.data.eventId),
        eq(jarvisBridgeEvents.direction, "outbound"),
      ),
    )
    .get()

  if (
    !sourceEvent ||
    (sourceEvent.eventType !== "assistance.requested" &&
      sourceEvent.eventType !== "feedback.status_changed")
  ) {
    return Response.json(
      { error: "Replyable request not found" },
      { status: 404 },
    )
  }

  if (
    sourceEvent.eventType === "feedback.status_changed" &&
    sourceEvent.source !== "compass-conversation"
  ) {
    return Response.json(
      { error: "Feedback update belongs to a non-Compass source" },
      { status: 409 },
    )
  }

  const feedbackItem = sourceEvent.feedbackDeskItemId
    ? await db
      .select({
        organizationId: feedbackDeskItems.organizationId,
        channelId: feedbackDeskItems.channelId,
        messageId: feedbackDeskItems.messageId,
      })
      .from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, sourceEvent.feedbackDeskItemId))
      .get()
    : null
  const target = sourceEvent.eventType === "feedback.status_changed"
    ? feedbackItem?.organizationId && feedbackItem.channelId && feedbackItem.messageId
      ? {
          organizationId: feedbackItem.organizationId,
          channelId: feedbackItem.channelId,
          messageId: feedbackItem.messageId,
        }
      : null
    : replyTarget(sourceEvent.payload)
  if (!target) {
    return Response.json(
      { error: "Request has no Compass reply target" },
      { status: 409 },
    )
  }

  const [channel, serviceUser, orgMembership, channelMembership] =
    await Promise.all([
      db
        .select({ organizationId: channels.organizationId })
        .from(channels)
        .where(eq(channels.id, target.channelId))
        .get(),
      db
        .select({ id: users.id, isActive: users.isActive })
        .from(users)
        .where(eq(users.id, serviceUserId))
        .get(),
      db
        .select({ id: organizationMembers.id })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.userId, serviceUserId),
            eq(
              organizationMembers.organizationId,
              target.organizationId,
            ),
          ),
        )
        .get(),
      db
        .select({ id: channelMembers.id })
        .from(channelMembers)
        .where(
          and(
            eq(channelMembers.userId, serviceUserId),
            eq(channelMembers.channelId, target.channelId),
          ),
        )
        .get(),
    ])

  if (
    !channel ||
    channel.organizationId !== target.organizationId ||
    !serviceUser?.isActive ||
    !orgMembership ||
    !channelMembership
  ) {
    return Response.json(
      {
        error:
          "Jarvis service identity is not authorized for this channel",
      },
      { status: 403 },
    )
  }

  const messageId = await deterministicReplyId(
    parsed.data.idempotencyKey,
  )
  const duplicate = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.id, messageId))
    .get()
  if (
    sourceEvent.eventType === "feedback.status_changed" &&
    sourceEvent.feedbackDeskItemId
  ) {
    try {
      await processFeedbackRequesterNotification(db, {
        id: sourceEvent.id,
        idempotencyKey: sourceEvent.idempotencyKey,
        feedbackDeskItemId: sourceEvent.feedbackDeskItemId,
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

  const now = new Date().toISOString()
  if (!duplicate) {
    await db.insert(messages).values({
      id: messageId,
      channelId: target.channelId,
      threadId: target.messageId,
      userId: serviceUserId,
      content: parsed.data.content,
      contentHtml: null,
      editedAt: null,
      deletedAt: null,
      deletedBy: null,
      isPinned: false,
      replyCount: 0,
      lastReplyAt: null,
      createdAt: now,
    })
    await db
      .update(messages)
      .set({
        replyCount: sql`${messages.replyCount} + 1`,
        lastReplyAt: now,
      })
      .where(eq(messages.id, target.messageId))
  }

  await db
    .insert(jarvisBridgeEvents)
    .values({
      id: crypto.randomUUID(),
      organizationId: target.organizationId,
      direction: "inbound",
      source: "signet",
      eventType: "assistance.responded",
      status: "completed",
      idempotencyKey: `reply:${parsed.data.idempotencyKey}`,
      payload: bodyResult.rawBody,
      availableAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()

  await db
    .update(jarvisBridgeEvents)
    .set({
      status: "completed",
      result: JSON.stringify({ messageId }),
      claimToken: null,
      claimedAt: null,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(jarvisBridgeEvents.id, sourceEvent.id))

  revalidatePath("/dashboard/conversations")
  return Response.json({ success: true, messageId, ...(duplicate ? { duplicate: true } : {}) })
}
