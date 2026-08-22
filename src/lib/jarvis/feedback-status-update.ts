import { and, eq, lt, or, sql } from "drizzle-orm"

import type { getDb } from "@/db"
import { organizationMembers, users } from "@/db/schema"
import {
  feedbackDeskItems,
  jarvisBridgeEvents,
  type FeedbackDeskItem,
} from "@/db/schema-jarvis"
import {
  feedbackIsResolved,
  feedbackRequesterUpdateKind,
  feedbackSlaTarget,
  feedbackStatusLabel,
  feedbackStatusMessage,
  feedbackStatusUsesEmail,
  feedbackNonEngineeringTransitionIsBlocked,
  knownFeedbackStatus,
  type FeedbackDeskStatus,
} from "@/lib/jarvis/feedback-lifecycle"
import { feedbackFeatureTransitionIsBlocked } from "@/lib/jarvis/feedback-feature-priority"
import {
  feedbackDeliveryGraphEvent,
  feedbackDeskOutboundPayload,
  feedbackRequesterNotificationEvent,
  feedbackDeliveryRoute,
  shouldRequestFeedbackDeliveryGraph,
  type FeedbackDeliveryGraphUpdate,
  type FeedbackDeliveryRoute,
} from "@/lib/jarvis/feedback-delivery"
import {
  feedbackEngineeringTransitionIsBlocked,
} from "@/lib/jarvis/feedback-lifecycle-evidence"
import { createStrictSystemNotificationEvent } from "@/lib/notifications/events"

type CompassDb = ReturnType<typeof getDb>

function metadataActorId(metadata: string | null): string | null {
  if (!metadata) return null
  try {
    const parsed: unknown = JSON.parse(metadata)
    if (typeof parsed !== "object" || parsed === null) return null
    const actorId = Reflect.get(parsed, "externalActorId")
    return typeof actorId === "string" && actorId.length > 0
      ? actorId
      : null
  } catch {
    return null
  }
}

export async function requesterRecipients(
  db: CompassDb,
  item: FeedbackDeskItem,
): Promise<readonly { readonly userId: string; readonly email: string }[]> {
  if (!item.organizationId) return []
  const actorId = item.source === "ask-jarvis"
    ? metadataActorId(item.metadata)
    : null
  const reporterEmail = item.reporterEmail?.trim().toLowerCase() ?? null
  const filter = actorId && reporterEmail
    ? or(
        eq(users.id, actorId),
        sql`lower(${users.email}) = ${reporterEmail}`,
        sql`lower(${users.googleEmail}) = ${reporterEmail}`,
      )
    : actorId
      ? eq(users.id, actorId)
      : reporterEmail
        ? or(
            sql`lower(${users.email}) = ${reporterEmail}`,
            sql`lower(${users.googleEmail}) = ${reporterEmail}`,
          )
        : null
  if (!filter) return []
  return db
    .select({ userId: users.id, email: users.email })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(
      eq(organizationMembers.organizationId, item.organizationId),
      eq(users.isActive, true),
      filter,
    ))
    .all()
}

type FeedbackRequesterNotificationSource = Readonly<{
  id: string
  idempotencyKey: string
  feedbackDeskItemId: string | null
}>

type FeedbackRequesterNotificationResult = Readonly<{
  queued: boolean
  claimed: boolean
  notifiedUserCount: number
}>

const NOTIFICATION_CLAIM_RETRY_MILLISECONDS = 5 * 60 * 1000

function notificationPayload(value: string): Readonly<{
  status: FeedbackDeskStatus
  notificationKind: string | null
}> | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== "object" || parsed === null) return null
    const rawStatus = Reflect.get(parsed, "status")
    const rawKind = Reflect.get(parsed, "notificationKind")
    return {
      status: knownFeedbackStatus(
        typeof rawStatus === "string" ? rawStatus : "new",
      ),
      notificationKind: typeof rawKind === "string" ? rawKind : null,
    }
  } catch {
    return null
  }
}

function requesterNotificationMessage(
  item: FeedbackDeskItem,
  notificationKind: string | null,
  status: FeedbackDeskStatus,
): string {
  if (notificationKind === "delivery_graph_created") {
    return "Your Compass request now has accountable engineering work."
  }
  if (notificationKind === "delivery_graph_failed") {
    return "Your Compass request could not enter engineering work yet and will be retried."
  }
  return feedbackStatusMessage(status, item.title, item.kind)
}

async function markNotificationRetryable(
  db: CompassDb,
  eventId: string,
  now: string,
  error: string,
): Promise<void> {
  await db
    .update(jarvisBridgeEvents)
    .set({
      status: "pending",
      lastError: error.slice(0, 2_000),
      availableAt: new Date(
        Date.parse(now) + 30_000,
      ).toISOString(),
      claimToken: null,
      claimedAt: null,
      completedAt: null,
      updatedAt: now,
    })
    .where(eq(jarvisBridgeEvents.id, eventId))
}

export async function processFeedbackRequesterNotification(
  db: CompassDb,
  sourceEvent: FeedbackRequesterNotificationSource,
  persistNotification: typeof createStrictSystemNotificationEvent =
    createStrictSystemNotificationEvent,
): Promise<FeedbackRequesterNotificationResult> {
  if (!sourceEvent.feedbackDeskItemId) {
    return { queued: false, claimed: false, notifiedUserCount: 0 }
  }

  const notificationEvent = await db
    .select({
      id: jarvisBridgeEvents.id,
      status: jarvisBridgeEvents.status,
      payload: jarvisBridgeEvents.payload,
    })
    .from(jarvisBridgeEvents)
    .where(eq(
      jarvisBridgeEvents.idempotencyKey,
      `feedback-requester-notification:${sourceEvent.idempotencyKey}`,
    ))
    .get()
  if (!notificationEvent) {
    return { queued: false, claimed: false, notifiedUserCount: 0 }
  }
  if (notificationEvent.status === "completed") {
    return { queued: true, claimed: false, notifiedUserCount: 0 }
  }

  const now = new Date()
  const nowIso = now.toISOString()
  const staleClaimIso = new Date(
    now.getTime() - NOTIFICATION_CLAIM_RETRY_MILLISECONDS,
  ).toISOString()
  const claimToken = crypto.randomUUID()
  const claimed = await db
    .update(jarvisBridgeEvents)
    .set({
      status: "processing",
      claimToken,
      claimedAt: nowIso,
      attemptCount: sql`${jarvisBridgeEvents.attemptCount} + 1`,
      updatedAt: nowIso,
    })
    .where(and(
      eq(jarvisBridgeEvents.id, notificationEvent.id),
      or(
        eq(jarvisBridgeEvents.status, "pending"),
        and(
          eq(jarvisBridgeEvents.status, "processing"),
          lt(jarvisBridgeEvents.claimedAt, staleClaimIso),
        ),
      ),
    ))
    .returning({ id: jarvisBridgeEvents.id })
    .get()
  if (!claimed) {
    throw new Error("Feedback requester notification is already processing")
  }

  try {
    const item = await db
      .select()
      .from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, sourceEvent.feedbackDeskItemId))
      .get()
    if (!item) throw new Error("Feedback request for notification was not found")
    const payload = notificationPayload(notificationEvent.payload)
    if (!payload) throw new Error("Feedback requester notification is invalid")
    const recipients = await requesterRecipients(db, item)
    if (recipients.length > 0 && item.organizationId) {
      await persistNotification({
        organizationId: item.organizationId,
        projectId: null,
        eventType: `feedback.status.${payload.status}`,
        sourceType: "feedback",
        sourceId: item.id,
        title: `Request update: ${feedbackStatusLabel(payload.status)}`,
        body: requesterNotificationMessage(
          item,
          payload.notificationKind,
          payload.status,
        ),
        href: `/dashboard/requests/${encodeURIComponent(item.id)}`,
        priority: payload.status === "needs_info" ? "high" : "normal",
        audience: "requester",
        recipients,
        delivery: {
          inApp: true,
          email: feedbackStatusUsesEmail(payload.status),
          push: feedbackStatusUsesEmail(payload.status),
        },
      })
    }
    await db
      .update(jarvisBridgeEvents)
      .set({
        status: "completed",
        result: JSON.stringify({ notifiedUserCount: recipients.length }),
        lastError: null,
        claimToken: null,
        claimedAt: null,
        completedAt: nowIso,
        updatedAt: nowIso,
      })
      .where(eq(jarvisBridgeEvents.id, notificationEvent.id))
    return {
      queued: true,
      claimed: true,
      notifiedUserCount: recipients.length,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    await markNotificationRetryable(db, notificationEvent.id, nowIso, message)
    throw error
  }
}

export type FeedbackLifecycleUpdate = Readonly<{
  status: FeedbackDeskStatus
  priority?: "low" | "normal" | "high" | "urgent"
  message?: string
  internalSummary?: string | null
  githubIssueUrl?: string | null
  githubIssueNodeId?: string | null
  draftPullRequestUrl?: string | null
  deliveryGraph?: FeedbackDeliveryGraphUpdate
  deliveryRoute?: FeedbackDeliveryRoute
  assignedToUserId?: string | null
  assignedToName?: string | null
  actorSource: string
  idempotencyKey: string
}>

export async function applyFeedbackLifecycleUpdate(
  db: CompassDb,
  item: FeedbackDeskItem,
  update: FeedbackLifecycleUpdate,
): Promise<Readonly<{
  changed: boolean
  notifiedUserCount: number
  requesterUpdateQueued: boolean
}>> {
  const duplicate = await db
    .select({ id: jarvisBridgeEvents.id })
    .from(jarvisBridgeEvents)
    .where(eq(jarvisBridgeEvents.idempotencyKey, update.idempotencyKey))
    .get()
  if (duplicate) {
    return { changed: false, notifiedUserCount: 0, requesterUpdateQueued: false }
  }
  if (feedbackFeatureTransitionIsBlocked({
    currentStatus: item.status,
    featurePriorityApprovedAt: item.featurePriorityApprovedAt,
    kind: item.kind,
    nextStatus: update.status,
  })) {
    throw new Error("Feature requests require a leadership priority decision before implementation")
  }
  const priority = update.priority ?? item.priority
  const issueUrl = update.githubIssueUrl === undefined
    ? item.githubIssueUrl
    : update.githubIssueUrl
  const issueNodeId = update.githubIssueNodeId === undefined
    ? item.githubIssueNodeId
    : update.githubIssueNodeId
  const draftUrl = update.draftPullRequestUrl === undefined
    ? item.githubDraftPullRequestUrl
    : update.draftPullRequestUrl
  const assignedToUserId = update.assignedToUserId === undefined
    ? item.assignedToUserId
    : update.assignedToUserId
  const assignedToName = update.assignedToName === undefined
    ? item.assignedToName
    : update.assignedToName
  const internalSummary = update.internalSummary === undefined
    ? item.internalSummary
    : update.internalSummary
  const deliveryGraphId = update.deliveryGraph === undefined
    ? item.deliveryGraphId
    : update.deliveryGraph.graphId
  const deliveryGraphStatus = update.deliveryGraph === undefined
    ? item.deliveryGraphStatus
    : update.deliveryGraph.status
  const deliveryGraphImplementationTaskId =
    update.deliveryGraph === undefined
      ? item.deliveryGraphImplementationTaskId
      : update.deliveryGraph.implementationTaskId
  const deliveryGraphReviewTaskId =
    update.deliveryGraph === undefined
      ? item.deliveryGraphReviewTaskId
      : update.deliveryGraph.reviewTaskId
  const deliveryGraphReleaseTaskId =
    update.deliveryGraph === undefined
      ? item.deliveryGraphReleaseTaskId
      : update.deliveryGraph.releaseTaskId
  const deliveryGraphLastError = update.deliveryGraph === undefined
    ? item.deliveryGraphLastError
    : update.deliveryGraph.error
  const deliveryGraphUpdatedAt = update.deliveryGraph
    ? new Date().toISOString()
    : item.deliveryGraphUpdatedAt
  const deliveryRoute = update.deliveryRoute ?? (
    item.deliveryGraphId !== null
      ? "engineering"
      : feedbackDeliveryRoute(item)
  )
  const nonEngineeringError = feedbackNonEngineeringTransitionIsBlocked({
    kind: item.kind,
    status: item.status,
    nextStatus: update.status,
    deliveryRoute,
  })
  if (nonEngineeringError) throw new Error(nonEngineeringError)
  const evidenceError = feedbackEngineeringTransitionIsBlocked({
    kind: item.kind,
    status: item.status,
    nextStatus: update.status,
    deliveryGraphId,
    deliveryGraphStatus,
    deliveryGraphImplementationTaskId,
    deliveryGraphReviewTaskId,
    deliveryGraphReleaseTaskId,
    githubDraftPullRequestUrl: draftUrl,
    deliveryRoute,
  })
  if (evidenceError) throw new Error(evidenceError)
  const lifecycleUpdateKind = feedbackRequesterUpdateKind(
    item.status,
    update.status,
    item.githubDraftPullRequestUrl,
    draftUrl,
    update.deliveryGraph?.status ?? null,
  )
  const requesterUpdateKind = lifecycleUpdateKind ?? (
    update.message?.trim() ? "status_changed" : null
  )
  const changed =
    item.status !== update.status ||
    item.priority !== priority ||
    item.githubIssueUrl !== issueUrl ||
    item.githubIssueNodeId !== issueNodeId ||
    item.githubDraftPullRequestUrl !== draftUrl ||
    item.assignedToUserId !== assignedToUserId ||
    item.assignedToName !== assignedToName ||
    item.internalSummary !== internalSummary ||
    item.deliveryGraphId !== deliveryGraphId ||
    item.deliveryGraphStatus !== deliveryGraphStatus ||
    item.deliveryGraphImplementationTaskId !== deliveryGraphImplementationTaskId ||
    item.deliveryGraphReviewTaskId !== deliveryGraphReviewTaskId ||
    item.deliveryGraphReleaseTaskId !== deliveryGraphReleaseTaskId ||
    item.deliveryGraphLastError !== deliveryGraphLastError ||
    item.deliveryGraphUpdatedAt !== deliveryGraphUpdatedAt ||
    update.message?.trim() !== undefined
  if (!changed) {
    return { changed: false, notifiedUserCount: 0, requesterUpdateQueued: false }
  }

  const now = new Date().toISOString()
  const firstTriage = item.triagedAt === null && update.status !== "new"
  const firstResolution = item.resolvedAt === null && feedbackIsResolved(update.status)
  const priorityChanged = item.priority !== priority
  const eventMessage = requesterUpdateKind === "delivery_graph_created"
    ? "Your Compass request now has accountable engineering work."
    : requesterUpdateKind === "delivery_graph_failed"
      ? "Your Compass request could not enter engineering work yet and will be retried."
      : `Your Compass request was updated: ${feedbackStatusLabel(update.status)}.`

  const updateStatement = db.update(feedbackDeskItems).set({
    status: update.status,
    priority,
    githubIssueUrl: issueUrl,
    githubIssueNodeId: issueNodeId,
    githubDraftPullRequestUrl: draftUrl,
    assignedToUserId,
    assignedToName,
    internalSummary,
    deliveryGraphId,
    deliveryGraphStatus,
    deliveryGraphImplementationTaskId,
    deliveryGraphReviewTaskId,
    deliveryGraphReleaseTaskId,
    deliveryGraphLastError,
    deliveryGraphUpdatedAt,
    slaTargetAt:
      item.slaTargetAt === null || priorityChanged
        ? feedbackSlaTarget(priority)
        : item.slaTargetAt,
    triagedAt: firstTriage ? now : item.triagedAt,
    resolvedAt: firstResolution ? now : item.resolvedAt,
    lastRequesterUpdateAt: requesterUpdateKind ? now : item.lastRequesterUpdateAt,
    lastGithubSyncAt: update.actorSource === "github" ? now : item.lastGithubSyncAt,
    updatedAt: now,
  }).where(eq(feedbackDeskItems.id, item.id))

  const recipients = requesterUpdateKind
    ? await requesterRecipients(db, item)
    : []
  const deliveryPayload = feedbackDeskOutboundPayload({
    id: item.id,
    kind: item.kind,
    status: update.status,
    notificationKind: requesterUpdateKind,
  })
  const payload = JSON.stringify(deliveryPayload)
  const timelineResult = JSON.stringify({
    ...deliveryPayload,
    message: eventMessage,
    updatedAt: now,
  })
  const inboundStatement = db.insert(jarvisBridgeEvents).values({
    id: crypto.randomUUID(),
    organizationId: item.organizationId,
    direction: "inbound",
    source: update.actorSource,
    eventType: "feedback.status_updated",
    status: "completed",
    idempotencyKey: update.idempotencyKey,
    feedbackDeskItemId: item.id,
    payload,
    result: timelineResult,
    availableAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing()
  const deliveryEvent = shouldRequestFeedbackDeliveryGraph(
    item,
    update.status,
    deliveryRoute,
  )
    ? feedbackDeliveryGraphEvent(item)
    : null
  const deliveryStatement = deliveryEvent
    ? db.insert(jarvisBridgeEvents).values({
        id: crypto.randomUUID(),
        organizationId: item.organizationId,
        direction: "outbound",
        source: "feedback-desk",
        eventType: deliveryEvent.eventType,
        idempotencyKey: deliveryEvent.idempotencyKey,
        feedbackDeskItemId: item.id,
        payload: JSON.stringify(deliveryEvent.payload),
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing()
    : null
  const notificationEvent = requesterUpdateKind &&
    item.organizationId &&
    recipients.length > 0
    ? feedbackRequesterNotificationEvent({
        id: item.id,
        kind: item.kind,
        status: update.status,
        notificationKind: requesterUpdateKind,
        idempotencyKey: `notify:${update.idempotencyKey}`,
      })
    : null
  const notificationStatement = notificationEvent
    ? db.insert(jarvisBridgeEvents).values({
        id: crypto.randomUUID(),
        organizationId: item.organizationId,
        direction: "outbound",
        source: "feedback-desk",
        eventType: notificationEvent.eventType,
        idempotencyKey: notificationEvent.idempotencyKey,
        feedbackDeskItemId: item.id,
        payload: JSON.stringify(notificationEvent.payload),
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing()
    : null
  if (requesterUpdateKind) {
    const outboundStatement = db.insert(jarvisBridgeEvents).values({
      id: crypto.randomUUID(),
      organizationId: item.organizationId,
      direction: "outbound",
      source: item.source,
      eventType: "feedback.status_changed",
      idempotencyKey: `notify:${update.idempotencyKey}`,
      feedbackDeskItemId: item.id,
      payload,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing()
    if (notificationStatement) {
      if (deliveryStatement) {
        await db.batch([
          updateStatement,
          inboundStatement,
          outboundStatement,
          deliveryStatement,
          notificationStatement,
        ])
      } else {
        await db.batch([
          updateStatement,
          inboundStatement,
          outboundStatement,
          notificationStatement,
        ])
      }
    } else if (deliveryStatement) {
      await db.batch([
        updateStatement,
        inboundStatement,
        outboundStatement,
        deliveryStatement,
      ])
    } else {
      await db.batch([updateStatement, inboundStatement, outboundStatement])
    }
  } else if (deliveryStatement) {
    await db.batch([updateStatement, inboundStatement, deliveryStatement])
  } else {
    await db.batch([updateStatement, inboundStatement])
  }

  return {
    changed: true,
    notifiedUserCount: requesterUpdateKind ? recipients.length : 0,
    requesterUpdateQueued: requesterUpdateKind !== null,
  }
}
