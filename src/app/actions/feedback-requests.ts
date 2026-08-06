"use server"

import { and, asc, desc, eq, or, sql } from "drizzle-orm"

import { getDb } from "@/db"
import {
  feedbackDeskItems,
  jarvisBridgeEvents,
} from "@/db/schema-jarvis"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import {
  confirmedFeedbackReportFromPayload,
  feedbackCandidateFromReport,
} from "@/lib/jarvis/feedback-confirmation"
import {
  enqueueFeedbackDeskItem,
} from "@/lib/jarvis/feedback-desk"
import {
  feedbackTimeline,
  type FeedbackTimelineEntry,
} from "@/lib/jarvis/feedback-timeline"
import { syncFeedbackDeskItemsFromGithub } from "@/lib/jarvis/feedback-github-sync"
import { linkFeedbackDeskItemToGithub } from "@/lib/jarvis/feedback-github"
import { requireOrg } from "@/lib/org-scope"
import { canManageUserAccessRole } from "@/lib/user-roles"

export type FeedbackRequestScope = "mine" | "all"

export type MyFeedbackRequest = {
  readonly id: string
  readonly kind: string
  readonly status: string
  readonly priority: string
  readonly title: string
  readonly description: string
  readonly reporterName: string | null
  readonly githubIssueUrl: string | null
  readonly githubDraftPullRequestUrl: string | null
  readonly assignedToName: string | null
  readonly slaTargetAt: string | null
  readonly lastRequesterUpdateAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export type MyFeedbackRequestDetail = MyFeedbackRequest & {
  readonly timeline: readonly FeedbackTimelineEntry[]
}

type MyFeedbackRequestsResult =
  | {
      readonly success: true
      readonly data: readonly MyFeedbackRequest[]
      readonly scope: FeedbackRequestScope
      readonly canViewAll: boolean
    }
  | { readonly success: false; readonly error: string }

type MyFeedbackRequestResult =
  | {
      readonly success: true
      readonly data: MyFeedbackRequestDetail
    }
  | { readonly success: false; readonly error: string }

type FeedbackRefreshResult =
  | {
      readonly success: true
      readonly updatedCount: number
      readonly recoveredCount: number
      readonly checkedAt: string
    }
  | { readonly success: false; readonly error: string }

function reporterFilter(
  userId: string,
  email: string,
  googleEmail: string | null,
) {
  const emailMatches = googleEmail && googleEmail !== email
    ? or(
        sql`lower(${feedbackDeskItems.reporterEmail}) = ${email}`,
        sql`lower(${feedbackDeskItems.reporterEmail}) = ${googleEmail}`
      )
    : sql`lower(${feedbackDeskItems.reporterEmail}) = ${email}`
  return or(
    emailMatches,
    sql`json_extract(${feedbackDeskItems.metadata}, '$.externalActorId') = ${userId}`,
  )
}

function normalizedUserEmails(user: Awaited<ReturnType<typeof requireAuth>>): {
  readonly email: string
  readonly googleEmail: string | null
} {
  const email = user.email.trim().toLowerCase()
  const googleEmail = user.googleEmail?.trim().toLowerCase() ?? null
  return { email, googleEmail }
}

const requestSelection = {
  id: feedbackDeskItems.id,
  kind: feedbackDeskItems.kind,
  status: feedbackDeskItems.status,
  priority: feedbackDeskItems.priority,
  title: feedbackDeskItems.title,
  description: feedbackDeskItems.description,
  reporterName: feedbackDeskItems.reporterName,
  githubIssueUrl: feedbackDeskItems.githubIssueUrl,
  githubDraftPullRequestUrl:
    feedbackDeskItems.githubDraftPullRequestUrl,
  assignedToName: feedbackDeskItems.assignedToName,
  slaTargetAt: feedbackDeskItems.slaTargetAt,
  lastRequesterUpdateAt: feedbackDeskItems.lastRequesterUpdateAt,
  createdAt: feedbackDeskItems.createdAt,
  updatedAt: feedbackDeskItems.updatedAt,
}

async function recoverConfirmedFeedbackRequests(
  db: ReturnType<typeof getDb>,
  env: CloudflareEnv,
  input: Readonly<{
    userId: string
    organizationId: string
    reporterName: string | null
    reporterEmail: string
  }>,
): Promise<number> {
  const events = await db
    .select({
      id: jarvisBridgeEvents.id,
      payload: jarvisBridgeEvents.payload,
      createdAt: jarvisBridgeEvents.createdAt,
    })
    .from(jarvisBridgeEvents)
    .where(
      and(
        eq(jarvisBridgeEvents.organizationId, input.organizationId),
        eq(jarvisBridgeEvents.direction, "outbound"),
        eq(jarvisBridgeEvents.source, "ask-jarvis"),
        eq(jarvisBridgeEvents.eventType, "agent.prompt"),
        sql`json_extract(${jarvisBridgeEvents.payload}, '$.user.id') = ${input.userId}`,
      ),
    )
    .orderBy(desc(jarvisBridgeEvents.createdAt))
    .limit(250)
  const existing = await db
    .select({ sourceId: feedbackDeskItems.sourceId })
    .from(feedbackDeskItems)
    .where(
      and(
        eq(feedbackDeskItems.organizationId, input.organizationId),
        eq(feedbackDeskItems.source, "ask-jarvis"),
      ),
    )
  const existingSourceIds = new Set(existing.map((item) => item.sourceId))
  let recoveredCount = 0

  for (const event of events) {
    if (existingSourceIds.has(event.id)) continue
    const report = confirmedFeedbackReportFromPayload(event.payload)
    if (!report) continue
    const candidate = feedbackCandidateFromReport(report)
    const item = await enqueueFeedbackDeskItem(db, {
      organizationId: input.organizationId,
      source: "ask-jarvis",
      sourceId: event.id,
      kind: candidate.kind,
      title: candidate.title,
      description: candidate.description,
      reporterName: input.reporterName,
      reporterEmail: input.reporterEmail,
      metadata: {
        externalActorId: input.userId,
        confirmationEventId: event.id,
        recoveredFromConfirmedPrompt: true,
        confirmedAt: event.createdAt,
      },
    })
    await linkFeedbackDeskItemToGithub(db, env, item)
    existingSourceIds.add(event.id)
    recoveredCount += 1
  }
  return recoveredCount
}

function canViewAllRequests(role: string): boolean {
  return role === "developer" || canManageUserAccessRole(role)
}

export async function getMyFeedbackRequests(
  scope: FeedbackRequestScope = "mine",
): Promise<MyFeedbackRequestsResult> {
  try {
    const user = await requireAuth()
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const { email, googleEmail } = normalizedUserEmails(user)

    const canViewAll = canViewAllRequests(user.role)
    const viewAll = scope === "all" && canViewAll
    const rows = await db
      .select(requestSelection)
      .from(feedbackDeskItems)
      .where(
        and(
          eq(feedbackDeskItems.organizationId, organizationId),
          viewAll
            ? sql`1 = 1`
            : reporterFilter(user.id, email, googleEmail)
        )
      )
      .orderBy(desc(feedbackDeskItems.updatedAt))
      .limit(100)

    return {
      success: true,
      data: rows,
      scope: viewAll ? "all" : "mine",
      canViewAll,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load your requests",
    }
  }
}

export async function getMyFeedbackRequest(
  requestId: string,
): Promise<MyFeedbackRequestResult> {
  try {
    const user = await requireAuth()
    const organizationId = requireOrg(user)
    const { email, googleEmail } = normalizedUserEmails(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const row = await db
      .select(requestSelection)
      .from(feedbackDeskItems)
      .where(
        and(
          eq(feedbackDeskItems.id, requestId),
          eq(feedbackDeskItems.organizationId, organizationId),
          canViewAllRequests(user.role)
            ? sql`1 = 1`
            : reporterFilter(user.id, email, googleEmail),
        ),
      )
      .get()

    if (!row) {
      return { success: false, error: "Request not found" }
    }

    const events = await db
      .select({
        eventType: jarvisBridgeEvents.eventType,
        payload: jarvisBridgeEvents.payload,
        result: jarvisBridgeEvents.result,
        createdAt: jarvisBridgeEvents.createdAt,
        completedAt: jarvisBridgeEvents.completedAt,
      })
      .from(jarvisBridgeEvents)
      .where(eq(jarvisBridgeEvents.feedbackDeskItemId, row.id))
      .orderBy(asc(jarvisBridgeEvents.createdAt))

    return {
      success: true,
      data: {
        ...row,
        timeline: feedbackTimeline(row, events),
      },
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load your request",
    }
  }
}

export async function refreshMyFeedbackRequests(
  scope: FeedbackRequestScope = "mine",
): Promise<FeedbackRefreshResult> {
  try {
    const user = await requireAuth()
    const organizationId = requireOrg(user)
    const { email, googleEmail } = normalizedUserEmails(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const recoveredCount = await recoverConfirmedFeedbackRequests(db, env, {
      userId: user.id,
      organizationId,
      reporterName: user.displayName,
      reporterEmail: email,
    })
    const viewAll = scope === "all" && canViewAllRequests(user.role)
    const rows = await db
      .select()
      .from(feedbackDeskItems)
      .where(
        and(
          eq(feedbackDeskItems.organizationId, organizationId),
          viewAll
            ? sql`1 = 1`
            : reporterFilter(user.id, email, googleEmail),
        ),
      )
      .orderBy(desc(feedbackDeskItems.updatedAt))
      .limit(100)
    const updatedCount = await syncFeedbackDeskItemsFromGithub(
      db,
      env,
      rows,
    )

    return {
      success: true,
      updatedCount,
      recoveredCount,
      checkedAt: new Date().toISOString(),
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to refresh request status",
    }
  }
}
