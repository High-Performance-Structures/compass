"use server"

import { and, desc, eq, isNotNull, isNull, notInArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { organizationMembers, users } from "@/db/schema"
import {
  feedbackDeskItems,
  feedbackMaintenanceRuns,
  feedbackServiceHealth,
  jarvisBridgeEvents,
} from "@/db/schema-jarvis"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isFeatureImplementationStatus } from "@/lib/jarvis/feedback-feature-priority"
import {
  FEEDBACK_DESK_STATUSES,
  feedbackIsOverdue,
} from "@/lib/jarvis/feedback-lifecycle"
import { runFeedbackMaintenance } from "@/lib/jarvis/feedback-maintenance"
import { applyFeedbackLifecycleUpdate } from "@/lib/jarvis/feedback-status-update"
import { feedbackBugTransitionIsBlocked } from "@/lib/jarvis/feedback-lifecycle-evidence"
import { canManageUserAccess } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"

const updateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(FEEDBACK_DESK_STATUSES),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  assignedToUserId: z.string().min(1).nullable(),
  message: z.string().max(2_000).optional(),
  internalSummary: z.string().max(4_000).optional(),
  githubIssueUrl: z.union([
    z.url().refine(
      (value) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+(?:\/|$)/.test(value),
      "GitHub issue URL required",
    ),
    z.literal(""),
  ]).optional(),
  draftPullRequestUrl: z.union([
    z.url().refine(
      (value) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/.test(value),
      "GitHub pull request URL required",
    ),
    z.literal(""),
  ]).optional(),
})

async function requireFeedbackAdmin(): Promise<Readonly<{
  id: string
  organizationId: string
}>> {
  const user = await requireAuth()
  if (!user.organizationId) throw new Error("No active organization")
  if (!canManageUserAccess(user)) {
    throw new Error("Only Compass administrators can manage the Feedback Desk")
  }
  return { id: user.id, organizationId: user.organizationId }
}

export type FeedbackAdminOverview = Readonly<{
  items: readonly {
    id: string
    kind: string
    status: string
    priority: string
    title: string
    description: string
    internalSummary: string | null
    reporterName: string | null
    source: string
    assignedToUserId: string | null
    assignedToName: string | null
    slaTargetAt: string | null
    overdue: boolean
    githubIssueUrl: string | null
    githubIssueCreationApprovedAt: string | null
    githubIssueCreationApprovedBy: string | null
    featurePriorityApprovedAt: string | null
    featurePriorityApprovedBy: string | null
    githubDraftPullRequestUrl: string | null
    deliveryGraphId: string | null
    deliveryGraphStatus: string | null
    deliveryGraphLastError: string | null
    privacyScrubbedAt: string | null
    createdAt: string
    updatedAt: string
  }[]
  assignees: readonly { id: string; name: string }[]
  health: readonly {
    serviceName: string
    status: string
    lastHeartbeatAt: string
    lastSuccessAt: string | null
    consecutiveFailures: number
    lastError: string | null
    stale: boolean
  }[]
  bridge: Readonly<{
    pending: number
    processing: number
    failed: number
    oldestPendingAt: string | null
  }>
  lastMaintenance: Readonly<{
    status: string
    startedAt: string
    completedAt: string | null
    summary: string | null
  }> | null
}>

type FeedbackAdminOverviewResult =
  | { readonly success: true; readonly data: FeedbackAdminOverview }
  | { readonly success: false; readonly error: string }

export async function getFeedbackAdminOverview(): Promise<FeedbackAdminOverviewResult> {
  try {
    const admin = await requireFeedbackAdmin()
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const [itemRows, memberRows, healthRows, bridgeRows, lastMaintenance] =
      await Promise.all([
        db.select().from(feedbackDeskItems).where(
          eq(feedbackDeskItems.organizationId, admin.organizationId),
        ).orderBy(desc(feedbackDeskItems.updatedAt)).limit(500),
        db.select({
          id: users.id,
          displayName: users.displayName,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          role: organizationMembers.role,
        }).from(organizationMembers)
          .innerJoin(users, eq(users.id, organizationMembers.userId))
          .where(and(
            eq(organizationMembers.organizationId, admin.organizationId),
            eq(users.isActive, true),
          )),
        db.select().from(feedbackServiceHealth).where(
          eq(feedbackServiceHealth.organizationId, admin.organizationId),
        ).orderBy(desc(feedbackServiceHealth.updatedAt)),
        db.select({
          status: jarvisBridgeEvents.status,
          createdAt: jarvisBridgeEvents.createdAt,
        }).from(jarvisBridgeEvents).where(
          eq(jarvisBridgeEvents.organizationId, admin.organizationId),
        ).orderBy(desc(jarvisBridgeEvents.createdAt)).limit(2_000),
        db.select().from(feedbackMaintenanceRuns).where(
          eq(feedbackMaintenanceRuns.organizationId, admin.organizationId),
        ).orderBy(desc(feedbackMaintenanceRuns.startedAt)).limit(1).get(),
      ])
    const pendingRows = bridgeRows.filter((row) => row.status === "pending")
    return {
      success: true,
      data: {
        items: itemRows.map((item) => ({
          id: item.id,
          kind: item.kind,
          status: item.status,
          priority: item.priority,
          title: item.title,
          description: item.description,
          internalSummary: item.internalSummary,
          reporterName: item.reporterName,
          source: item.source,
          assignedToUserId: item.assignedToUserId,
          assignedToName: item.assignedToName,
          slaTargetAt: item.slaTargetAt,
          overdue: feedbackIsOverdue(item.status, item.slaTargetAt),
          githubIssueUrl: item.githubIssueUrl,
          githubIssueCreationApprovedAt: item.githubIssueCreationApprovedAt,
          githubIssueCreationApprovedBy: item.githubIssueCreationApprovedBy,
          featurePriorityApprovedAt: item.featurePriorityApprovedAt,
          featurePriorityApprovedBy: item.featurePriorityApprovedBy,
          githubDraftPullRequestUrl: item.githubDraftPullRequestUrl,
          deliveryGraphId: item.deliveryGraphId,
          deliveryGraphStatus: item.deliveryGraphStatus,
          deliveryGraphLastError: item.deliveryGraphLastError,
          privacyScrubbedAt: item.privacyScrubbedAt,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
        assignees: memberRows
          .filter((member) => isInternalStaffRole(member.role))
          .map((member) => ({
            id: member.id,
            name: member.displayName ?? (
              [member.firstName, member.lastName].filter(Boolean).join(" ") ||
              member.email
            ),
          })),
        health: healthRows.map((row) => {
          const staleAfterMinutes = row.serviceName === "feedback-reconciler" ? 15 : 2
          return {
            serviceName: row.serviceName,
            status: row.status,
            lastHeartbeatAt: row.lastHeartbeatAt,
            lastSuccessAt: row.lastSuccessAt,
            consecutiveFailures: row.consecutiveFailures,
            lastError: row.lastError,
            stale:
              Date.now() - new Date(row.lastHeartbeatAt).getTime() >
              staleAfterMinutes * 60 * 1_000,
          }
        }),
        bridge: {
          pending: pendingRows.length,
          processing: bridgeRows.filter((row) => row.status === "processing").length,
          failed: bridgeRows.filter((row) => row.status === "failed").length,
          oldestPendingAt: pendingRows.at(-1)?.createdAt ?? null,
        },
        lastMaintenance: lastMaintenance
          ? {
              status: lastMaintenance.status,
              startedAt: lastMaintenance.startedAt,
              completedAt: lastMaintenance.completedAt,
              summary: lastMaintenance.summary,
            }
          : null,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load Feedback Desk",
    }
  }
}

export async function setFeedbackGithubIssueCreationApproval(
  input: Readonly<{ id: string; approved: boolean }>,
): Promise<Readonly<{ success: boolean; error?: string }>> {
  try {
    const parsed = z.object({
      id: z.string().min(1),
      approved: z.boolean(),
    }).parse(input)
    const admin = await requireFeedbackAdmin()
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const item = await db.select({
      id: feedbackDeskItems.id,
      kind: feedbackDeskItems.kind,
      githubIssueUrl: feedbackDeskItems.githubIssueUrl,
      featurePriorityApprovedAt: feedbackDeskItems.featurePriorityApprovedAt,
      githubIssueCreationClaimToken: feedbackDeskItems.githubIssueCreationClaimToken,
      updatedAt: feedbackDeskItems.updatedAt,
    }).from(feedbackDeskItems).where(and(
      eq(feedbackDeskItems.id, parsed.id),
      eq(feedbackDeskItems.organizationId, admin.organizationId),
    )).get()
    if (!item) return { success: false, error: "Feedback request not found" }
    if (item.githubIssueUrl) {
      return { success: false, error: "This request already has a GitHub issue" }
    }
    if (
      parsed.approved &&
      item.kind === "feature" &&
      item.featurePriorityApprovedAt === null
    ) {
      return {
        success: false,
        error: "Approve this feature's priority before approving a new GitHub issue",
      }
    }
    const now = new Date().toISOString()
    const priorityFence = item.featurePriorityApprovedAt === null
      ? isNull(feedbackDeskItems.featurePriorityApprovedAt)
      : eq(feedbackDeskItems.featurePriorityApprovedAt, item.featurePriorityApprovedAt)
    const updatedRows = await db.update(feedbackDeskItems).set({
      githubIssueCreationApprovedAt: parsed.approved ? now : null,
      githubIssueCreationApprovedBy: parsed.approved ? admin.id : null,
      updatedAt: now,
    }).where(and(
      eq(feedbackDeskItems.id, item.id),
      eq(feedbackDeskItems.organizationId, admin.organizationId),
      eq(feedbackDeskItems.updatedAt, item.updatedAt),
      priorityFence,
      ...(parsed.approved && item.kind === "feature"
        ? [isNotNull(feedbackDeskItems.featurePriorityApprovedAt)]
        : []),
    )).returning({ id: feedbackDeskItems.id })
    if (updatedRows.length === 0) {
      return {
        success: false,
        error: "This request changed while its GitHub approval was being updated",
      }
    }
    revalidatePath("/dashboard/requests")
    revalidatePath("/dashboard/requests/manage")
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Approval update failed",
    }
  }
}

export async function setFeedbackFeaturePriorityApproval(
  input: Readonly<{ id: string; approved: boolean }>,
): Promise<Readonly<{ success: boolean; error?: string }>> {
  try {
    const parsed = z.object({
      id: z.string().min(1),
      approved: z.boolean(),
    }).parse(input)
    const admin = await requireFeedbackAdmin()
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const item = await db.select({
      id: feedbackDeskItems.id,
      kind: feedbackDeskItems.kind,
      status: feedbackDeskItems.status,
      featurePriorityApprovedAt: feedbackDeskItems.featurePriorityApprovedAt,
      githubIssueCreationClaimToken: feedbackDeskItems.githubIssueCreationClaimToken,
      updatedAt: feedbackDeskItems.updatedAt,
    }).from(feedbackDeskItems).where(and(
      eq(feedbackDeskItems.id, parsed.id),
      eq(feedbackDeskItems.organizationId, admin.organizationId),
    )).get()
    if (!item) return { success: false, error: "Feedback request not found" }
    if (item.kind !== "feature") {
      return { success: false, error: "Only feature requests need a leadership priority decision" }
    }
    if (!parsed.approved && isFeatureImplementationStatus(item.status)) {
      return {
        success: false,
        error: "A feature already in implementation cannot have its priority approval removed",
      }
    }
    const now = new Date().toISOString()
    const approvalFence = item.featurePriorityApprovedAt === null
      ? isNull(feedbackDeskItems.featurePriorityApprovedAt)
      : eq(feedbackDeskItems.featurePriorityApprovedAt, item.featurePriorityApprovedAt)
    const updatedRows = await db.update(feedbackDeskItems).set({
      featurePriorityApprovedAt: parsed.approved ? now : null,
      featurePriorityApprovedBy: parsed.approved ? admin.id : null,
      ...(parsed.approved ? {} : {
        githubIssueCreationApprovedAt: null,
        githubIssueCreationApprovedBy: null,
      }),
      updatedAt: now,
    }).where(and(
      eq(feedbackDeskItems.id, item.id),
      eq(feedbackDeskItems.organizationId, admin.organizationId),
      eq(feedbackDeskItems.updatedAt, item.updatedAt),
      approvalFence,
      ...(parsed.approved
        ? []
        : [notInArray(feedbackDeskItems.status, ["planned", "in_progress", "testing", "deployed"])]),
    )).returning({ id: feedbackDeskItems.id })
    if (updatedRows.length === 0) {
      return {
        success: false,
        error: parsed.approved
          ? "This request changed while its priority decision was being saved"
          : "A feature already in implementation cannot have its priority approval removed",
      }
    }
    revalidatePath("/dashboard/requests")
    revalidatePath("/dashboard/requests/manage")
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Priority decision update failed",
    }
  }
}

export async function updateFeedbackAdminItem(
  input: z.infer<typeof updateSchema>,
): Promise<Readonly<{
  success: boolean
  error?: string
  changed?: boolean
  requesterUpdateQueued?: boolean
}>> {
  try {
    const parsed = updateSchema.parse(input)
    const admin = await requireFeedbackAdmin()
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const item = await db.select().from(feedbackDeskItems).where(and(
      eq(feedbackDeskItems.id, parsed.id),
      eq(feedbackDeskItems.organizationId, admin.organizationId),
    )).get()
    if (!item) return { success: false, error: "Feedback request not found" }
    const evidenceError = feedbackBugTransitionIsBlocked({
      ...item,
      nextStatus: parsed.status,
      githubDraftPullRequestUrl:
        parsed.draftPullRequestUrl === undefined
          ? item.githubDraftPullRequestUrl
          : parsed.draftPullRequestUrl || null,
    })
    if (evidenceError) return { success: false, error: evidenceError }
    const assignee = parsed.assignedToUserId
      ? await db.select({
          id: users.id,
          displayName: users.displayName,
          email: users.email,
          role: organizationMembers.role,
        }).from(organizationMembers)
          .innerJoin(users, eq(users.id, organizationMembers.userId))
          .where(and(
            eq(organizationMembers.organizationId, admin.organizationId),
            eq(users.id, parsed.assignedToUserId),
            eq(users.isActive, true),
          )).get()
      : null
    if (
      parsed.assignedToUserId &&
      (!assignee || !isInternalStaffRole(assignee.role))
    ) {
      return { success: false, error: "Assignee must be active internal staff" }
    }
    const result = await applyFeedbackLifecycleUpdate(db, item, {
      status: parsed.status,
      priority: parsed.priority,
      assignedToUserId: assignee?.id ?? null,
      assignedToName: assignee?.displayName ?? assignee?.email ?? null,
      message: parsed.message?.trim() || undefined,
      internalSummary: parsed.internalSummary === undefined
        ? undefined
        : parsed.internalSummary.trim() || null,
      githubIssueUrl: parsed.githubIssueUrl === undefined
        ? undefined
        : parsed.githubIssueUrl || null,
      draftPullRequestUrl: parsed.draftPullRequestUrl === undefined
        ? undefined
        : parsed.draftPullRequestUrl || null,
      actorSource: "compass-admin",
      idempotencyKey: `admin-status:${item.id}:${crypto.randomUUID()}`,
    })
    revalidatePath("/dashboard/requests")
    revalidatePath("/dashboard/requests/manage")
    return {
      success: true,
      changed: result.changed,
      requesterUpdateQueued: result.requesterUpdateQueued,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Update failed",
    }
  }
}

export async function runFeedbackAdminMaintenance(): Promise<Readonly<{
  success: boolean
  error?: string
}>> {
  try {
    const admin = await requireFeedbackAdmin()
    const { env } = await getCloudflareContext()
    const configuredOrganizationId = Reflect.get(
      env,
      "JARVIS_BRIDGE_ORGANIZATION_ID",
    )
    if (configuredOrganizationId !== admin.organizationId) {
      return {
        success: false,
        error: "Feedback reconciliation is not configured for this organization",
      }
    }
    await runFeedbackMaintenance(env, "admin")
    revalidatePath("/dashboard/requests")
    revalidatePath("/dashboard/requests/manage")
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Reconciliation failed",
    }
  }
}
