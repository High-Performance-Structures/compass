import { and, desc, eq, isNull, or } from "drizzle-orm"

import { getDb } from "@/db"
import { feedback } from "@/db/schema"
import {
  feedbackDeskItems,
  feedbackMaintenanceRuns,
  feedbackServiceHealth,
  jarvisBridgeEvents,
  type FeedbackDeskItem,
} from "@/db/schema-jarvis"
import { getJarvisEnvValue } from "@/lib/jarvis/auth"
import {
  confirmedFeedbackReportFromPayload,
  feedbackCandidateFromReport,
} from "@/lib/jarvis/feedback-confirmation"
import {
  enqueueFeedbackDeskItem,
  type FeedbackDeskKind,
} from "@/lib/jarvis/feedback-desk"
import { linkFeedbackDeskItemToGithub } from "@/lib/jarvis/feedback-github"
import { githubFeedbackIssueContent } from "@/lib/jarvis/feedback-github-content"
import { syncFeedbackDeskItemsFromGithub } from "@/lib/jarvis/feedback-github-sync"
import {
  feedbackIsResolved,
  feedbackSlaTarget,
} from "@/lib/jarvis/feedback-lifecycle"

type CompassDb = ReturnType<typeof getDb>

export type FeedbackMaintenanceResult = Readonly<{
  processedCount: number
  recoveredCount: number
  linkedCount: number
  missingLinkReviewCount: number
  syncedCount: number
  scrubbedCount: number
  slaBackfilledCount: number
  failedCount: number
}>

export function feedbackGithubLinkAction(
  item: Pick<
    FeedbackDeskItem,
    "githubIssueUrl" | "githubIssueCreationApprovedAt" | "status"
  >,
): "repair" | "create" | "review" | "skip" {
  if (item.githubIssueUrl) return "repair"
  if (item.githubIssueCreationApprovedAt) return "create"
  if (feedbackIsResolved(item.status)) return "skip"
  return "review"
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : null
}

function stringValue(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function payloadReporter(payload: string): Readonly<{
  userId: string | null
  name: string | null
  email: string | null
}> {
  try {
    const parsed: unknown = JSON.parse(payload)
    const user = objectValue(objectValue(parsed)?.user)
    return {
      userId: stringValue(user, "id"),
      name: stringValue(user, "displayName") ?? stringValue(user, "name"),
      email: stringValue(user, "email")?.toLowerCase() ?? null,
    }
  } catch {
    return { userId: null, name: null, email: null }
  }
}

function legacyKind(type: string): FeedbackDeskKind {
  return type === "bug" || type === "feature" || type === "question"
    ? type
    : "general"
}

async function recoverLegacyFeedback(
  db: CompassDb,
  organizationId: string,
): Promise<number> {
  const rows = await db.select().from(feedback)
    .orderBy(desc(feedback.createdAt))
    .limit(500)
  const existing = await db.select({ sourceId: feedbackDeskItems.sourceId })
    .from(feedbackDeskItems)
    .where(and(
      eq(feedbackDeskItems.organizationId, organizationId),
      eq(feedbackDeskItems.source, "feedback-widget"),
    ))
  const sourceIds = new Set(existing.map((row) => row.sourceId))
  let count = 0
  for (const row of rows) {
    if (sourceIds.has(row.id)) continue
    await enqueueFeedbackDeskItem(db, {
      organizationId,
      source: "feedback-widget",
      sourceId: row.id,
      kind: legacyKind(row.type),
      title: row.message.trim().slice(0, 160),
      description: row.message.trim(),
      reporterName: row.name,
      reporterEmail: row.email?.trim().toLowerCase() ?? null,
      githubIssueUrl: row.githubIssueUrl,
      historicalImport: true,
      metadata: {
        legacyFeedback: true,
        recoveredAt: new Date().toISOString(),
      },
    })
    sourceIds.add(row.id)
    count += 1
  }
  return count
}

async function recoverConfirmedPrompts(
  db: CompassDb,
  organizationId: string,
): Promise<number> {
  const events = await db.select({
    id: jarvisBridgeEvents.id,
    payload: jarvisBridgeEvents.payload,
    createdAt: jarvisBridgeEvents.createdAt,
  }).from(jarvisBridgeEvents).where(and(
    eq(jarvisBridgeEvents.organizationId, organizationId),
    eq(jarvisBridgeEvents.direction, "outbound"),
    eq(jarvisBridgeEvents.source, "ask-jarvis"),
    eq(jarvisBridgeEvents.eventType, "agent.prompt"),
  )).orderBy(desc(jarvisBridgeEvents.createdAt)).limit(1_000)
  const existing = await db.select({ sourceId: feedbackDeskItems.sourceId })
    .from(feedbackDeskItems)
    .where(and(
      eq(feedbackDeskItems.organizationId, organizationId),
      eq(feedbackDeskItems.source, "ask-jarvis"),
    ))
  const sourceIds = new Set(existing.map((row) => row.sourceId))
  let count = 0
  for (const event of events) {
    if (sourceIds.has(event.id)) continue
    const report = confirmedFeedbackReportFromPayload(event.payload)
    if (!report) continue
    const reporter = payloadReporter(event.payload)
    const candidate = feedbackCandidateFromReport(report)
    await enqueueFeedbackDeskItem(db, {
      organizationId,
      source: "ask-jarvis",
      sourceId: event.id,
      kind: candidate.kind,
      title: candidate.title,
      description: candidate.description,
      reporterName: reporter.name,
      reporterEmail: reporter.email,
      historicalImport: true,
      metadata: {
        externalActorId: reporter.userId,
        confirmationEventId: event.id,
        recoveredFromConfirmedPrompt: true,
        confirmedAt: event.createdAt,
      },
    })
    sourceIds.add(event.id)
    count += 1
  }
  return count
}

function githubIssueNumber(url: string, repo: string): string | null {
  const escapedRepo = repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = url.match(new RegExp(
    `^https://github\\.com/${escapedRepo}/issues/(\\d+)(?:/|$)`,
  ))
  return match?.[1] ?? null
}

async function scrubLegacyGithubIssues(
  db: CompassDb,
  env: CloudflareEnv,
  items: readonly FeedbackDeskItem[],
): Promise<Readonly<{ scrubbed: number; failed: number }>> {
  const token = getJarvisEnvValue(env, "GITHUB_TOKEN")
  const repo = getJarvisEnvValue(env, "GITHUB_REPO")
  if (!token || !repo) return { scrubbed: 0, failed: 0 }
  let scrubbed = 0
  let failed = 0
  for (const item of items) {
    if (item.privacyScrubbedAt || !item.githubIssueUrl) continue
    const issueNumber = githubIssueNumber(item.githubIssueUrl, repo)
    if (!issueNumber) continue
    const content = githubFeedbackIssueContent(item)
    try {
      const response = await fetch(
        `https://api.github.com/repos/${repo}/issues/${issueNumber}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "compass-feedback-desk",
          },
          body: JSON.stringify({ title: content.title, body: content.body }),
        },
      )
      if (!response.ok) {
        failed += 1
        continue
      }
      const now = new Date().toISOString()
      await db.update(feedbackDeskItems).set({
        privacyScrubbedAt: now,
        updatedAt: now,
      }).where(eq(feedbackDeskItems.id, item.id))
      scrubbed += 1
    } catch {
      failed += 1
    }
  }
  return { scrubbed, failed }
}

export async function recordFeedbackServiceHealth(
  db: CompassDb,
  input: Readonly<{
    serviceName: string
    organizationId: string | null
    status: "healthy" | "degraded" | "failed"
    error?: string | null
    metadata?: Readonly<Record<string, unknown>>
  }>,
): Promise<void> {
  const now = new Date().toISOString()
  const existing = await db.select().from(feedbackServiceHealth)
    .where(eq(feedbackServiceHealth.serviceName, input.serviceName)).get()
  const failed = input.status === "failed"
  await db.insert(feedbackServiceHealth).values({
    serviceName: input.serviceName,
    organizationId: input.organizationId,
    status: input.status,
    lastHeartbeatAt: now,
    lastSuccessAt: failed ? existing?.lastSuccessAt ?? null : now,
    lastFailureAt: failed ? now : existing?.lastFailureAt ?? null,
    consecutiveFailures: failed ? (existing?.consecutiveFailures ?? 0) + 1 : 0,
    lastError: input.error ?? null,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: feedbackServiceHealth.serviceName,
    set: {
      organizationId: input.organizationId,
      status: input.status,
      lastHeartbeatAt: now,
      lastSuccessAt: failed ? existing?.lastSuccessAt ?? null : now,
      lastFailureAt: failed ? now : existing?.lastFailureAt ?? null,
      consecutiveFailures: failed ? (existing?.consecutiveFailures ?? 0) + 1 : 0,
      lastError: input.error ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      updatedAt: now,
    },
  })
}

export async function runFeedbackMaintenance(
  env: CloudflareEnv,
  source: "cron" | "admin",
): Promise<FeedbackMaintenanceResult> {
  const db = getDb(env.DB)
  const organizationId = getJarvisEnvValue(env, "JARVIS_BRIDGE_ORGANIZATION_ID")
  if (!organizationId) throw new Error("JARVIS_BRIDGE_ORGANIZATION_ID is required")
  const runId = crypto.randomUUID()
  const startedAt = new Date().toISOString()
  await db.insert(feedbackMaintenanceRuns).values({
    id: runId,
    organizationId,
    operation: "reconcile",
    source,
    status: "running",
    startedAt,
  })
  let failedCount = 0
  try {
    const recoveredCount =
      await recoverLegacyFeedback(db, organizationId) +
      await recoverConfirmedPrompts(db, organizationId)
    const items = await db.select().from(feedbackDeskItems).where(and(
      eq(feedbackDeskItems.organizationId, organizationId),
      or(
        isNull(feedbackDeskItems.githubIssueUrl),
        isNull(feedbackDeskItems.githubIssueNodeId),
      ),
    )).orderBy(feedbackDeskItems.createdAt).limit(250)
    let linkedCount = 0
    let missingLinkReviewCount = 0
    for (const item of items) {
      const action = feedbackGithubLinkAction(item)
      if (action === "review") {
        missingLinkReviewCount += 1
        continue
      }
      if (action === "skip") continue
      const link = await linkFeedbackDeskItemToGithub(db, env, item)
      if (link) linkedCount += 1
      else failedCount += 1
    }
    const allItems = await db.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.organizationId, organizationId))
      .orderBy(desc(feedbackDeskItems.updatedAt)).limit(500)
    let slaBackfilledCount = 0
    for (const item of allItems) {
      if (item.slaTargetAt !== null) continue
      await db.update(feedbackDeskItems).set({
        slaTargetAt: feedbackSlaTarget(item.priority, new Date(item.createdAt)),
      }).where(eq(feedbackDeskItems.id, item.id))
      slaBackfilledCount += 1
    }
    const itemsWithSla = allItems.map((item) => item.slaTargetAt !== null
      ? item
      : {
          ...item,
          slaTargetAt: feedbackSlaTarget(item.priority, new Date(item.createdAt)),
        })
    const syncedCount = await syncFeedbackDeskItemsFromGithub(db, env, itemsWithSla)
    const privacy = await scrubLegacyGithubIssues(
      db,
      env,
      itemsWithSla.filter((item) => item.source === "feedback-widget"),
    )
    failedCount += privacy.failed
    const result = {
      processedCount: allItems.length,
      recoveredCount,
      linkedCount,
      missingLinkReviewCount,
      syncedCount,
      scrubbedCount: privacy.scrubbed,
      slaBackfilledCount,
      failedCount,
    }
    const completedAt = new Date().toISOString()
    await db.update(feedbackMaintenanceRuns).set({
      status: failedCount > 0 ? "partial" : "success",
      processedCount: result.processedCount,
      updatedCount:
        recoveredCount + linkedCount + syncedCount + privacy.scrubbed +
        slaBackfilledCount,
      failedCount,
      summary: JSON.stringify(result),
      completedAt,
    }).where(eq(feedbackMaintenanceRuns.id, runId))
    await recordFeedbackServiceHealth(db, {
      serviceName: "feedback-reconciler",
      organizationId,
      status: failedCount > 0 ? "degraded" : "healthy",
      metadata: result,
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    await db.update(feedbackMaintenanceRuns).set({
      status: "failed",
      failedCount: failedCount + 1,
      summary: message,
      completedAt: new Date().toISOString(),
    }).where(eq(feedbackMaintenanceRuns.id, runId))
    await recordFeedbackServiceHealth(db, {
      serviceName: "feedback-reconciler",
      organizationId,
      status: "failed",
      error: message,
    })
    throw error
  }
}
