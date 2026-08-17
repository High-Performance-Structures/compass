"use server"

import { and, asc, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projectMembers, projects } from "@/db/schema"
import {
  projectWarrantyClaimAttachments,
  projectWarrantyClaimEvents,
  projectWarrantyClaims,
} from "@/db/schema-warranty"
import { requireAuth } from "@/lib/auth"
import type { AuthUser } from "@/lib/auth"
import { recordActivityEvent } from "@/lib/activity-log"
import { getCloudflareContext } from "@/lib/db"
import {
  canFeature,
  requireFeaturePermission,
} from "@/lib/permission-enforcement"
import { assertProjectAccess } from "@/lib/project-access"
import { canUseProjectAudience } from "@/lib/project-audience-access"
import { isInternalStaffRole } from "@/lib/user-roles"
import {
  notifyWarrantyClaimCreated,
  notifyWarrantyClaimUpdated,
} from "@/lib/notifications/events"
import {
  canOwnerDeleteWarrantyClaim,
  isOwnerVisibleWarrantyClaim,
  isWarrantyProjectStage,
  warrantyClaimPriority,
  warrantyClaimStatus,
} from "@/lib/warranty/status"

export type WarrantyClaimAttachmentItem = {
  readonly id: string
  readonly fileName: string
  readonly mimeType: string | null
  readonly fileSize: number
  readonly ownerVisible: boolean
  readonly downloadHref: string
}

export type WarrantyClaimEventItem = {
  readonly id: string
  readonly actorName: string
  readonly eventType: string
  readonly fromStatus: string | null
  readonly toStatus: string | null
  readonly note: string | null
  readonly createdAt: string
}

export type WarrantyClaimItem = {
  readonly id: string
  readonly claimNumber: string
  readonly title: string
  readonly location: string | null
  readonly category: string
  readonly description: string
  readonly priority: string
  readonly status: string
  readonly claimantUserId: string | null
  readonly claimantName: string
  readonly assignedUserId: string | null
  readonly assignedName: string | null
  readonly acknowledgedAt: string | null
  readonly scheduledFor: string | null
  readonly workStartedAt: string | null
  readonly resolvedAt: string | null
  readonly ownerConfirmedAt: string | null
  readonly resolutionSummary: string | null
  readonly internalNotes: string | null
  readonly submittedAt: string
  readonly updatedAt: string
  readonly attachments: readonly WarrantyClaimAttachmentItem[]
  readonly events: readonly WarrantyClaimEventItem[]
  readonly viewerCanDelete: boolean
}

export type WarrantyWorkspace = {
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly googleDriveFolderId: string | null
    readonly warrantyEnabled: boolean
  }
  readonly viewerIsInternal: boolean
  readonly claims: readonly WarrantyClaimItem[]
}

export type CreateWarrantyClaimInput = {
  readonly title: string
  readonly location: string | null
  readonly category: string
  readonly description: string
  readonly priority: string
  readonly claimantName: string | null
}

export type UpdateWarrantyClaimInput = {
  readonly status: string
  readonly priority: string
  readonly assignedUserId: string | null
  readonly assignedName: string | null
  readonly scheduledFor: string | null
  readonly resolutionSummary: string | null
  readonly internalNotes: string | null
}

type WarrantyActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

type WarrantyContext = {
  readonly db: ReturnType<typeof getDb>
  readonly user: AuthUser
  readonly organizationId: string
  readonly viewerIsInternal: boolean
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly status: string
    readonly jobStatusId: string
    readonly googleDriveFolderId: string | null
  }
}

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label} is required.`)
  return trimmed
}

function viewerName(user: AuthUser): string {
  return user.displayName?.trim() || user.email
}

async function warrantyContext(projectId: string): Promise<WarrantyContext> {
  const user = await requireAuth()
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const access = await assertProjectAccess(db, user, projectId)
  if (!access.organizationId) throw new Error("Project organization is missing.")

  const project = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      status: projects.status,
      jobStatusId: projects.jobStatusId,
      googleDriveFolderId: projects.googleDriveFolderId,
    })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, access.organizationId)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!project) throw new Error("Project not found.")

  const viewerIsInternal = isInternalStaffRole(user.role)
  if (viewerIsInternal) {
    await requireFeaturePermission(user, "warranty-claims", "read")
  } else {
    const membership = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, user.id)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!canUseProjectAudience(membership?.role ?? null, "owner")) {
      throw new Error("Project not found.")
    }
  }

  return {
    db,
    user,
    organizationId: access.organizationId,
    viewerIsInternal,
    project,
  }
}

function claimNumberFor(
  projectNumber: string | null,
  existingCount: number
): string {
  const sequence = String(existingCount + 1).padStart(3, "0")
  return projectNumber
    ? `${projectNumber}-W-${sequence}`
    : `WARRANTY-${sequence}`
}

function claimRevalidationPaths(projectId: string): readonly string[] {
  return [
    `/dashboard/projects/${projectId}`,
    `/dashboard/projects/${projectId}/warranty`,
    `/preview/projects/${projectId}/owner`,
    `/preview/projects/${projectId}/owner/warranty`,
  ]
}

function revalidateClaimPaths(projectId: string): void {
  for (const path of claimRevalidationPaths(projectId)) revalidatePath(path)
}

async function appendClaimEvent(input: {
  readonly context: WarrantyContext
  readonly claimId: string
  readonly eventType: string
  readonly fromStatus: string | null
  readonly toStatus: string | null
  readonly note: string | null
  readonly ownerVisible: boolean
  readonly createdAt: string
}): Promise<void> {
  await input.context.db.insert(projectWarrantyClaimEvents).values({
    id: crypto.randomUUID(),
    organizationId: input.context.organizationId,
    projectId: input.context.project.id,
    claimId: input.claimId,
    actorUserId: input.context.user.id,
    actorName: viewerName(input.context.user),
    actorRole: input.context.user.role,
    eventType: input.eventType,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    note: input.note,
    ownerVisible: input.ownerVisible,
    createdAt: input.createdAt,
  })
}

export async function getProjectWarrantyWorkspace(
  projectId: string
): Promise<WarrantyWorkspace> {
  const context = await warrantyContext(projectId)
  const warrantyEnabled = isWarrantyProjectStage(context.project)
  if (!context.viewerIsInternal && !warrantyEnabled) {
    throw new Error("Warranty is not open for this project.")
  }

  const rows = await context.db
    .select()
    .from(projectWarrantyClaims)
    .where(
      and(
        eq(projectWarrantyClaims.projectId, projectId),
        eq(projectWarrantyClaims.organizationId, context.organizationId)
      )
    )
    .orderBy(desc(projectWarrantyClaims.updatedAt), asc(projectWarrantyClaims.claimNumber))
  const visibleRows = context.viewerIsInternal
    ? rows
    : rows.filter(isOwnerVisibleWarrantyClaim)
  const internalCanDelete = context.viewerIsInternal
    ? await canFeature(context.user, "warranty-claims", "delete")
    : false
  const claimIds = new Set(visibleRows.map((claim) => claim.id))

  const attachmentRows = await context.db
    .select()
    .from(projectWarrantyClaimAttachments)
    .where(eq(projectWarrantyClaimAttachments.projectId, projectId))
    .orderBy(asc(projectWarrantyClaimAttachments.createdAt))
  const eventRows = await context.db
    .select()
    .from(projectWarrantyClaimEvents)
    .where(eq(projectWarrantyClaimEvents.projectId, projectId))
    .orderBy(asc(projectWarrantyClaimEvents.createdAt))

  return {
    project: {
      id: context.project.id,
      name: context.project.name,
      projectNumber: context.project.projectNumber,
      googleDriveFolderId: context.project.googleDriveFolderId,
      warrantyEnabled,
    },
    viewerIsInternal: context.viewerIsInternal,
    claims: visibleRows.map((claim) => ({
      id: claim.id,
      claimNumber: claim.claimNumber,
      title: claim.title,
      location: claim.location,
      category: claim.category,
      description: claim.description,
      priority: claim.priority,
      status: claim.status,
      claimantUserId: claim.claimantUserId,
      claimantName: claim.claimantName,
      assignedUserId: claim.assignedUserId,
      assignedName: claim.assignedName,
      acknowledgedAt: claim.acknowledgedAt,
      scheduledFor: claim.scheduledFor,
      workStartedAt: claim.workStartedAt,
      resolvedAt: claim.resolvedAt,
      ownerConfirmedAt: claim.ownerConfirmedAt,
      resolutionSummary: claim.resolutionSummary,
      internalNotes: context.viewerIsInternal ? claim.internalNotes : null,
      submittedAt: claim.submittedAt,
      updatedAt: claim.updatedAt,
      attachments: attachmentRows
        .filter(
          (attachment) =>
            attachment.claimId === claim.id &&
            (context.viewerIsInternal || attachment.ownerVisible)
        )
        .map((attachment) => ({
          id: attachment.id,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          fileSize: attachment.fileSize,
          ownerVisible: attachment.ownerVisible,
          downloadHref:
            `/api/projects/${encodeURIComponent(projectId)}` +
            `/warranty/${encodeURIComponent(claim.id)}` +
            `/attachments/${encodeURIComponent(attachment.id)}/download`,
        })),
      events: eventRows
        .filter(
          (event) =>
            claimIds.has(event.claimId) &&
            event.claimId === claim.id &&
            (context.viewerIsInternal || event.ownerVisible)
        )
        .map((event) => ({
          id: event.id,
          actorName: event.actorName,
          eventType: event.eventType,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          note: event.note,
          createdAt: event.createdAt,
        })),
      viewerCanDelete:
        internalCanDelete ||
        canOwnerDeleteWarrantyClaim({
          status: claim.status,
          claimantUserId: claim.claimantUserId,
          viewerUserId: context.user.id,
        }),
    })),
  }
}

export async function createProjectWarrantyClaim(
  projectId: string,
  input: CreateWarrantyClaimInput
): Promise<WarrantyActionResult> {
  try {
    const context = await warrantyContext(projectId)
    if (!context.viewerIsInternal && !isWarrantyProjectStage(context.project)) {
      return {
        success: false,
        error: "Warranty claims are not open for this project yet.",
      }
    }
    if (context.viewerIsInternal) {
      await requireFeaturePermission(context.user, "warranty-claims", "create")
    }
    const priority = warrantyClaimPriority(input.priority)
    if (!priority) {
      return { success: false, error: "Choose a valid warranty priority." }
    }

    const count = await context.db
      .select({ id: projectWarrantyClaims.id })
      .from(projectWarrantyClaims)
      .where(eq(projectWarrantyClaims.projectId, projectId))
      .then((rows) => rows.length)
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const title = requireText(input.title, "Title")
    const claimantName = context.viewerIsInternal
      ? cleanText(input.claimantName) ?? viewerName(context.user)
      : viewerName(context.user)

    await context.db.insert(projectWarrantyClaims).values({
      id,
      organizationId: context.organizationId,
      projectId,
      claimNumber: claimNumberFor(context.project.projectNumber, count),
      title,
      location: cleanText(input.location),
      category: requireText(input.category, "Category"),
      description: requireText(input.description, "Description"),
      priority,
      status: "submitted",
      audience: "owner",
      promotionState: "actionable",
      claimantUserId: context.viewerIsInternal ? null : context.user.id,
      claimantName,
      createdBy: context.user.id,
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    await appendClaimEvent({
      context,
      claimId: id,
      eventType: "claim_submitted",
      fromStatus: null,
      toStatus: "submitted",
      note: null,
      ownerVisible: true,
      createdAt: now,
    })
    await recordActivityEvent({
      db: context.db,
      organizationId: context.organizationId,
      projectId,
      actor: context.user,
      category: "warranty",
      action: "warranty.claim_submitted",
      entityType: "warranty_claim",
      entityId: id,
      summary: `Submitted warranty claim: ${title}.`,
      metadata: { priority, externalSubmission: !context.viewerIsInternal },
    })
    try {
      await notifyWarrantyClaimCreated({
        organizationId: context.organizationId,
        projectId,
        claimId: id,
        claimNumber: claimNumberFor(context.project.projectNumber, count),
        title,
        priority,
        createdBy: context.user,
      })
    } catch (notificationError) {
      console.error("Warranty creation notification failed", notificationError)
    }
    revalidateClaimPaths(projectId)
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to create warranty claim.",
    }
  }
}

export async function updateProjectWarrantyClaim(
  projectId: string,
  claimId: string,
  input: UpdateWarrantyClaimInput
): Promise<WarrantyActionResult> {
  try {
    const context = await warrantyContext(projectId)
    if (!context.viewerIsInternal) {
      return { success: false, error: "Staff access is required." }
    }
    await requireFeaturePermission(context.user, "warranty-claims", "update")
    const status = warrantyClaimStatus(input.status)
    const priority = warrantyClaimPriority(input.priority)
    if (!status || !priority) {
      return { success: false, error: "Choose a valid status and priority." }
    }
    const existing = await context.db
      .select()
      .from(projectWarrantyClaims)
      .where(
        and(
          eq(projectWarrantyClaims.id, claimId),
          eq(projectWarrantyClaims.projectId, projectId),
          eq(projectWarrantyClaims.organizationId, context.organizationId)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!existing) return { success: false, error: "Warranty claim not found." }

    const now = new Date().toISOString()
    await context.db
      .update(projectWarrantyClaims)
      .set({
        status,
        priority,
        assignedUserId: cleanText(input.assignedUserId),
        assignedName: cleanText(input.assignedName),
        scheduledFor: cleanText(input.scheduledFor),
        resolutionSummary: cleanText(input.resolutionSummary),
        internalNotes: cleanText(input.internalNotes),
        acknowledgedAt:
          status !== "submitted" ? existing.acknowledgedAt ?? now : null,
        workStartedAt:
          status === "in_progress" ? existing.workStartedAt ?? now : existing.workStartedAt,
        resolvedAt:
          status === "resolved" || status === "closed"
            ? existing.resolvedAt ?? now
            : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(projectWarrantyClaims.id, claimId),
          eq(projectWarrantyClaims.projectId, projectId)
        )
      )

    const statusChanged = existing.status !== status
    await appendClaimEvent({
      context,
      claimId,
      eventType: statusChanged ? "status_changed" : "claim_updated",
      fromStatus: existing.status,
      toStatus: status,
      note: cleanText(input.resolutionSummary),
      ownerVisible: true,
      createdAt: now,
    })
    await recordActivityEvent({
      db: context.db,
      organizationId: context.organizationId,
      projectId,
      actor: context.user,
      category: "warranty",
      action: statusChanged ? "warranty.status_changed" : "warranty.claim_updated",
      entityType: "warranty_claim",
      entityId: claimId,
      summary: statusChanged
        ? `Changed ${existing.claimNumber} from ${existing.status} to ${status}.`
        : `Updated ${existing.claimNumber}.`,
      metadata: { status, priority },
    })
    if (statusChanged) {
      try {
        await notifyWarrantyClaimUpdated({
          organizationId: context.organizationId,
          projectId,
          claimId,
          claimNumber: existing.claimNumber,
          title: existing.title,
          status,
          claimantUserId: existing.claimantUserId,
          updatedBy: context.user,
        })
      } catch (notificationError) {
        console.error("Warranty update notification failed", notificationError)
      }
    }
    revalidateClaimPaths(projectId)
    return { success: true, id: claimId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to update warranty claim.",
    }
  }
}

export async function confirmProjectWarrantyResolution(
  projectId: string,
  claimId: string
): Promise<WarrantyActionResult> {
  try {
    const context = await warrantyContext(projectId)
    if (context.viewerIsInternal) {
      return { success: false, error: "Open the internal claim workspace to close this claim." }
    }
    const existing = await context.db
      .select()
      .from(projectWarrantyClaims)
      .where(
        and(
          eq(projectWarrantyClaims.id, claimId),
          eq(projectWarrantyClaims.projectId, projectId),
          eq(projectWarrantyClaims.organizationId, context.organizationId),
          eq(projectWarrantyClaims.audience, "owner"),
          eq(projectWarrantyClaims.promotionState, "actionable")
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!existing || existing.status !== "resolved") {
      return { success: false, error: "This claim is not ready for confirmation." }
    }
    const now = new Date().toISOString()
    await context.db
      .update(projectWarrantyClaims)
      .set({ status: "closed", ownerConfirmedAt: now, updatedAt: now })
      .where(
        and(
          eq(projectWarrantyClaims.id, claimId),
          eq(projectWarrantyClaims.projectId, projectId)
        )
      )
    await appendClaimEvent({
      context,
      claimId,
      eventType: "owner_confirmed",
      fromStatus: "resolved",
      toStatus: "closed",
      note: "Owner confirmed the warranty resolution.",
      ownerVisible: true,
      createdAt: now,
    })
    await recordActivityEvent({
      db: context.db,
      organizationId: context.organizationId,
      projectId,
      actor: context.user,
      category: "warranty",
      action: "warranty.owner_confirmed",
      entityType: "warranty_claim",
      entityId: claimId,
      summary: `Confirmed resolution of ${existing.claimNumber}.`,
    })
    revalidateClaimPaths(projectId)
    return { success: true, id: claimId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to confirm resolution.",
    }
  }
}

export async function deleteProjectWarrantyClaim(
  projectId: string,
  claimId: string
): Promise<WarrantyActionResult> {
  try {
    const context = await warrantyContext(projectId)
    const existing = await context.db
      .select()
      .from(projectWarrantyClaims)
      .where(
        and(
          eq(projectWarrantyClaims.id, claimId),
          eq(projectWarrantyClaims.projectId, projectId),
          eq(projectWarrantyClaims.organizationId, context.organizationId)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!existing) return { success: false, error: "Warranty claim not found." }
    if (
      !context.viewerIsInternal &&
      !canOwnerDeleteWarrantyClaim({
        status: existing.status,
        claimantUserId: existing.claimantUserId,
        viewerUserId: context.user.id,
      })
    ) {
      return {
        success: false,
        error: "Only an unacknowledged claim you submitted can be deleted.",
      }
    }
    if (context.viewerIsInternal) {
      await requireFeaturePermission(context.user, "warranty-claims", "delete")
    }

    await context.db
      .delete(projectWarrantyClaims)
      .where(
        and(
          eq(projectWarrantyClaims.id, claimId),
          eq(projectWarrantyClaims.projectId, projectId)
        )
      )
    await recordActivityEvent({
      db: context.db,
      organizationId: context.organizationId,
      projectId,
      actor: context.user,
      category: "warranty",
      action: "warranty.claim_deleted",
      entityType: "warranty_claim",
      entityId: claimId,
      summary: `Deleted ${existing.claimNumber}: ${existing.title}.`,
      metadata: { previousStatus: existing.status },
    })
    revalidateClaimPaths(projectId)
    return { success: true, id: claimId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to delete warranty claim.",
    }
  }
}
