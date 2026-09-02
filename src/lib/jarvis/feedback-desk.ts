import { and, eq } from "drizzle-orm"
import type { getDb } from "@/db"
import {
  feedbackDeskItems,
  jarvisBridgeEvents,
  type FeedbackDeskItem,
} from "@/db/schema-jarvis"
import { feedbackSlaTarget } from "@/lib/jarvis/feedback-lifecycle"
import { feedbackDeskOutboundPayload } from "@/lib/jarvis/feedback-delivery"
import {
  assertBridgeReservationOwnership,
  type BridgeReservationOwnership,
} from "@/lib/jarvis/bridge-reservation"

type CompassDb = ReturnType<typeof getDb>

export type FeedbackDeskSource =
  | "compass-conversation"
  | "feedback-widget"
  | "jarvis-email"
  | "telegram"
  | "ask-jarvis"

export type FeedbackDeskKind =
  | "assistance"
  | "bug"
  | "feature"
  | "question"
  | "general"

type CreateFeedbackDeskItemInput = {
  readonly organizationId: string | null
  readonly source: FeedbackDeskSource
  readonly sourceId: string
  readonly kind: FeedbackDeskKind
  readonly title: string
  readonly description: string
  readonly reporterName?: string | null
  readonly reporterEmail?: string | null
  readonly channelId?: string | null
  readonly messageId?: string | null
  readonly threadId?: string | null
  readonly githubIssueUrl?: string | null
  readonly historicalImport?: boolean
  readonly metadata?: Readonly<Record<string, unknown>>
}

export async function enqueueFeedbackReceipt(
  db: CompassDb,
  item: FeedbackDeskItem,
  ownership?: BridgeReservationOwnership,
): Promise<void> {
  const now = new Date().toISOString()
  const receiptPayload = feedbackDeskOutboundPayload({
    id: item.id,
    kind: item.kind,
    status: "new",
    notificationKind: null,
  })

  const receiptInsert = db
    .insert(jarvisBridgeEvents)
    .values({
      id: crypto.randomUUID(),
      organizationId: item.organizationId,
      direction: "outbound",
      source: item.source,
      eventType: "feedback.status_changed",
      idempotencyKey: `receipt:${item.id}`,
      feedbackDeskItemId: item.id,
      payload: JSON.stringify(receiptPayload),
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()

  if (ownership) {
    await db.batch([
      assertBridgeReservationOwnership(db, ownership),
      receiptInsert,
    ])
    return
  }
  await receiptInsert
}

export async function enqueueFeedbackDeskItem(
  db: CompassDb,
  input: CreateFeedbackDeskItemInput,
): Promise<FeedbackDeskItem> {
  const now = new Date().toISOString()
  const itemId = crypto.randomUUID()
  const eventId = crypto.randomUUID()
  const eventType =
    input.kind === "assistance"
      ? "assistance.requested"
      : "feedback.reported"
  const idempotencyKey =
    `${input.source}:${input.sourceId}:${eventType}`

  await db
    .insert(feedbackDeskItems)
    .values({
      id: itemId,
      organizationId: input.organizationId,
      source: input.source,
      sourceId: input.sourceId,
      kind: input.kind,
      title: input.title.slice(0, 160),
      description: input.description,
      reporterName: input.reporterName ?? null,
      reporterEmail: input.reporterEmail ?? null,
      channelId: input.channelId ?? null,
      messageId: input.messageId ?? null,
      threadId: input.threadId ?? null,
      githubIssueUrl: input.githubIssueUrl ?? null,
      metadata: input.metadata
        ? JSON.stringify(input.metadata)
        : null,
      slaTargetAt: feedbackSlaTarget("normal"),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()

  const item = await db
    .select()
    .from(feedbackDeskItems)
    .where(
      and(
        eq(feedbackDeskItems.source, input.source),
        eq(feedbackDeskItems.sourceId, input.sourceId),
      ),
    )
    .get()

  if (!item) {
    throw new Error("Failed to create feedback desk item")
  }

  // Backfills should restore the durable record without replaying old intake
  // or receipt notifications as if the request had just been submitted.
  if (input.historicalImport) return item

  const payload = feedbackDeskOutboundPayload({
    id: item.id,
    kind: item.kind,
    status: "new",
    notificationKind: null,
  })

  await db
    .insert(jarvisBridgeEvents)
    .values({
      id: eventId,
      organizationId: input.organizationId,
      direction: "outbound",
      source: input.source,
      eventType,
      idempotencyKey,
      feedbackDeskItemId: item.id,
      payload: JSON.stringify(payload),
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()

  await enqueueFeedbackReceipt(db, item)

  return item
}
