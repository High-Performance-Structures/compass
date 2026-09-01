import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm"

import type { getDb } from "@/db"
import { organizationMembers, users } from "@/db/schema"
import {
  feedbackDeskItems,
  jarvisBridgeEvents,
  type FeedbackDeskItem,
} from "@/db/schema-jarvis"
import {
  feedbackDraftPullRequestMessage,
  feedbackIsResolved,
  feedbackRequesterUpdateKind,
  feedbackSlaTarget,
  feedbackStatusLabel,
  feedbackStatusMessage,
  feedbackStatusUsesEmail,
  type FeedbackDeskStatus,
} from "@/lib/jarvis/feedback-lifecycle"
import {
  feedbackFeatureTransitionIsBlocked,
  isFeatureImplementationStatus,
} from "@/lib/jarvis/feedback-feature-priority"
import {
  feedbackDeliveryGraphEvent,
  shouldRequestFeedbackDeliveryGraph,
  type FeedbackDeliveryGraphUpdate,
} from "@/lib/jarvis/feedback-delivery"
import { feedbackBugTransitionIsBlocked } from "@/lib/jarvis/feedback-lifecycle-evidence"
import { createSystemNotificationEvent } from "@/lib/notifications/events"

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

async function requesterRecipients(
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
  assignedToUserId?: string | null
  assignedToName?: string | null
  actorSource: string
  idempotencyKey: string
}>

export async function applyFeedbackLifecycleUpdate(
  db: CompassDb,
  itemSnapshot: FeedbackDeskItem,
  update: FeedbackLifecycleUpdate,
): Promise<Readonly<{
  changed: boolean
  notifiedUserCount: number
  requesterUpdateQueued: boolean
}>> {
  const item = await db.select().from(feedbackDeskItems).where(and(
    eq(feedbackDeskItems.id, itemSnapshot.id),
    itemSnapshot.organizationId === null
      ? isNull(feedbackDeskItems.organizationId)
      : eq(feedbackDeskItems.organizationId, itemSnapshot.organizationId),
  )).get()
  if (!item) throw new Error("Feedback request not found")

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
  const evidenceError = feedbackBugTransitionIsBlocked({
    kind: item.kind,
    status: item.status,
    nextStatus: update.status,
    deliveryGraphId,
    deliveryGraphStatus,
    deliveryGraphImplementationTaskId,
    deliveryGraphReviewTaskId,
    deliveryGraphReleaseTaskId,
    githubDraftPullRequestUrl: draftUrl,
  })
  if (evidenceError) throw new Error(evidenceError)
  const lifecycleUpdateKind = feedbackRequesterUpdateKind(
    item.status,
    update.status,
    item.githubDraftPullRequestUrl,
    draftUrl,
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
  const hasDraftUpdate = draftUrl !== null && draftUrl !== item.githubDraftPullRequestUrl
  const message = update.message ?? (
    hasDraftUpdate
      ? feedbackDraftPullRequestMessage(item.title, draftUrl)
      : feedbackStatusMessage(update.status, item.title)
  )

  const recipients = requesterUpdateKind
    ? await requesterRecipients(db, item)
    : []
  const payload = JSON.stringify({
    schemaVersion: 1,
    feedbackDeskItemId: item.id,
    source: item.source,
    sourceId: item.sourceId,
    status: update.status,
    title: item.title,
    message,
    reporter: {
      name: item.reporterName,
      email: item.reporterEmail,
      externalActorId: metadataActorId(item.metadata),
    },
    compass: {
      organizationId: item.organizationId,
      channelId: item.channelId,
      messageId: item.messageId,
      threadId: item.threadId,
    },
    metadata: item.metadata,
    githubIssueUrl: issueUrl,
    draftPullRequestUrl: draftUrl,
    notificationKind: requesterUpdateKind,
    updatedAt: now,
  })
  const deliveryEvent = shouldRequestFeedbackDeliveryGraph(item, update.status)
    ? feedbackDeliveryGraphEvent(item)
    : null
  const rowIdentity = item.organizationId === null
    ? isNull(feedbackDeskItems.organizationId)
    : eq(feedbackDeskItems.organizationId, item.organizationId)
  const finalFence = item.kind === "feature" && isFeatureImplementationStatus(update.status)
    ? isNotNull(feedbackDeskItems.featurePriorityApprovedAt)
    : undefined
  // D1 batches commit or roll back together without emitting the unsupported
  // transaction-control statements that Drizzle's transaction wrapper uses.
  // One D1 batch statement writes all outbox rows. Its SELECT is fenced on the
  // checked update's affected-row count, so a lost optimistic update cannot
  // create only a subset of the events.
  const persistedWrite = db.update(feedbackDeskItems).set({
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
    }).where(and(
      eq(feedbackDeskItems.id, item.id),
      rowIdentity,
      eq(feedbackDeskItems.updatedAt, item.updatedAt),
      ...(finalFence ? [finalFence] : []),
    )).returning({ id: feedbackDeskItems.id })
  const deliveryEventSelect = deliveryEvent
    ? sql`
      union all select
        ${crypto.randomUUID()}, ${item.organizationId}, 'outbound', 'feedback-desk',
        ${deliveryEvent.eventType}, 'pending', ${deliveryEvent.idempotencyKey}, ${item.id},
        ${JSON.stringify(deliveryEvent.payload)}, null, 0, ${now}, null, null, null, null, ${now}, ${now}
      where changes() = 1
    `
    : sql``
  const requesterEventSelect = requesterUpdateKind
    ? sql`
      union all select
        ${crypto.randomUUID()}, ${item.organizationId}, 'outbound', ${item.source},
        'feedback.status_changed', 'pending', ${`notify:${update.idempotencyKey}`}, ${item.id},
        ${payload}, null, 0, ${now}, null, null, null, null, ${now}, ${now}
      where changes() = 1
    `
    : sql``
  const outboxWrite = db.insert(jarvisBridgeEvents).select(sql`
    select
      ${crypto.randomUUID()}, ${item.organizationId}, 'inbound', ${update.actorSource},
      'feedback.status_updated', 'completed', ${update.idempotencyKey}, ${item.id},
      ${payload}, ${payload}, 0, ${now}, null, null, ${now}, null, ${now}, ${now}
    where changes() = 1
    ${deliveryEventSelect}
    ${requesterEventSelect}
  `).onConflictDoNothing()
  const [persistedRows] = await db.batch([persistedWrite, outboxWrite])
  if (!persistedRows?.[0]) {
    throw new Error("Feedback request changed before the lifecycle update could be saved")
  }

  if (requesterUpdateKind && item.organizationId && recipients.length > 0) {
    try {
      await createSystemNotificationEvent({
        organizationId: item.organizationId,
        projectId: null,
        eventType: `feedback.status.${update.status}`,
        sourceType: "feedback",
        sourceId: item.id,
        title: `Request update: ${feedbackStatusLabel(update.status)}`,
        body: message,
        href: `/dashboard/requests/${encodeURIComponent(item.id)}`,
        priority: update.status === "needs_info" ? "high" : "normal",
        audience: "requester",
        recipients,
        delivery: {
          inApp: true,
          email: feedbackStatusUsesEmail(update.status),
          push: feedbackStatusUsesEmail(update.status),
        },
      })
    } catch (error) {
      console.error("feedback_lifecycle_notification_failed", {
        feedbackDeskItemId: item.id,
        error: error instanceof Error ? error.message : "Unknown error",
      })
    }
  }

  return {
    changed: true,
    notifiedUserCount: requesterUpdateKind ? recipients.length : 0,
    requesterUpdateQueued: requesterUpdateKind !== null,
  }
}
