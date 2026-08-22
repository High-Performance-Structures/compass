import { and, eq, or, sql } from "drizzle-orm"
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

const replySchema = z.object({
  eventId: z.string().min(1).max(128),
  claimToken: z.string().min(1).max(128),
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
  const now = new Date().toISOString()
  const replyClaimToken = crypto.randomUUID()
  const sourceEvent = await db
    .update(jarvisBridgeEvents)
    .set({
      claimToken: replyClaimToken,
      claimedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(jarvisBridgeEvents.id, parsed.data.eventId),
        eq(jarvisBridgeEvents.direction, "outbound"),
        eq(jarvisBridgeEvents.status, "processing"),
        eq(jarvisBridgeEvents.claimToken, parsed.data.claimToken),
        or(
          eq(jarvisBridgeEvents.eventType, "assistance.requested"),
          eq(jarvisBridgeEvents.eventType, "feedback.status_changed"),
        ),
      ),
    )
    .returning({
      id: jarvisBridgeEvents.id,
      eventType: jarvisBridgeEvents.eventType,
      source: jarvisBridgeEvents.source,
      idempotencyKey: jarvisBridgeEvents.idempotencyKey,
      payload: jarvisBridgeEvents.payload,
      feedbackDeskItemId: jarvisBridgeEvents.feedbackDeskItemId,
    })
    .get()

  if (!sourceEvent) {
    return Response.json(
      { error: "Event claim is no longer active" },
      { status: 409 },
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

  const sideEffectClaimToken = crypto.randomUUID()
  const reserved = await db
    .update(jarvisBridgeEvents)
    .set({
      claimToken: sideEffectClaimToken,
      claimedAt: now,
      result: JSON.stringify({ reply: "reserved" }),
      updatedAt: now,
    })
    .where(and(
      eq(jarvisBridgeEvents.id, parsed.data.eventId),
      eq(jarvisBridgeEvents.direction, "outbound"),
      eq(jarvisBridgeEvents.status, "processing"),
      eq(jarvisBridgeEvents.claimToken, replyClaimToken),
    ))
    .returning({ id: jarvisBridgeEvents.id })
    .get()
  if (!reserved) {
    return Response.json(
      { error: "Event claim is no longer active" },
      { status: 409 },
    )
  }

  const replyIdempotencyKey = `jarvis-reply:${sourceEvent.id}`
  const messageId = await deterministicReplyId(replyIdempotencyKey)
  const duplicate = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.id, messageId))
    .get()
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
    }).onConflictDoNothing()
  }
  await db
    .update(messages)
    .set({
      replyCount: sql<number>`(
        SELECT count(*) FROM ${messages}
        WHERE ${messages.threadId} = ${target.messageId}
      )`,
      lastReplyAt: now,
    })
    .where(eq(messages.id, target.messageId))

  await db
    .insert(jarvisBridgeEvents)
    .values({
      id: crypto.randomUUID(),
      organizationId: target.organizationId,
      direction: "inbound",
      source: "signet",
      eventType: "assistance.responded",
      status: "completed",
      idempotencyKey: `reply:${sourceEvent.id}`,
      payload: bodyResult.rawBody,
      availableAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()

  const released = await db
    .update(jarvisBridgeEvents)
    .set({
      result: null,
      claimedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(jarvisBridgeEvents.id, parsed.data.eventId),
      eq(jarvisBridgeEvents.direction, "outbound"),
      eq(jarvisBridgeEvents.status, "processing"),
      eq(jarvisBridgeEvents.claimToken, sideEffectClaimToken),
    ))
    .returning({ id: jarvisBridgeEvents.id })
    .get()
  if (!released) {
    return Response.json(
      { error: "Event claim is no longer active" },
      { status: 409 },
    )
  }

  revalidatePath("/dashboard/conversations")
  return Response.json({
    success: true,
    messageId,
    claimToken: sideEffectClaimToken,
    ...(duplicate ? { duplicate: true } : {}),
  })
}
