"use server"

import { and, asc, desc, eq, inArray, isNotNull, or, type SQL } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import { projectMembers, projects } from "@/db/schema"
import { projectWarrantyClaimEvents, projectWarrantyClaims } from "@/db/schema-warranty"
import { recordActivityEvent } from "@/lib/activity-log"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { notifyWarrantyClaimUpdated } from "@/lib/notifications/events"
import { assertProjectAccess } from "@/lib/project-access"
import { canUseProjectAudience } from "@/lib/project-audience-access"
import { getProjectAudienceViewerContact } from "@/lib/project-audience-viewer-contact"
import { isInternalStaffRole } from "@/lib/user-roles"
import { VENDOR_WARRANTY_STATUSES, type VendorWarrantyStatus } from "@/lib/warranty/status"

/** What a sub/vendor sees of a claim assigned to them: the owner-visible fields only. */
export type VendorWarrantyClaim = {
  readonly id: string
  readonly claimNumber: string
  readonly title: string
  readonly location: string | null
  readonly category: string
  readonly description: string
  readonly priority: string
  readonly status: string
  readonly claimantName: string
  readonly assignedName: string | null
  readonly scheduledFor: string | null
  readonly workStartedAt: string | null
  readonly resolvedAt: string | null
  readonly ownerConfirmedAt: string | null
  readonly resolutionSummary: string | null
  readonly submittedAt: string
  readonly updatedAt: string
  readonly history: readonly {
    readonly id: string
    readonly actorName: string
    readonly toStatus: string | null
    readonly note: string | null
    readonly createdAt: string
  }[]
}

export type VendorWarrantyWorkspace = {
  readonly projectNumber: string | null
  readonly projectName: string
  /** Staff previewing the vendor view see every claim assigned to a contact or vendor. */
  readonly viewerIsInternal: boolean
  readonly claims: readonly VendorWarrantyClaim[]
}


type Db = ReturnType<typeof getDb>

type VendorContext = {
  readonly db: Db
  readonly user: Awaited<ReturnType<typeof requireAuth>>
  readonly organizationId: string
  readonly viewerIsInternal: boolean
  readonly project: { readonly id: string; readonly name: string; readonly projectNumber: string | null }
  /** Which claims this viewer may see and act on. */
  readonly assignedFilter: SQL
}

/**
 * A sub/vendor sees a claim only when staff assigned it to their own project
 * contact or to their company (vendor). The viewer is identified the same way
 * as the rest of the vendor workspace: their accepted invitation, else their
 * email on this project's contact list.
 */
async function vendorWarrantyContext(projectId: string): Promise<VendorContext> {
  const user = await requireAuth()
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const access = await assertProjectAccess(db, user, projectId)
  if (!access.organizationId) throw new Error("Project organization is missing.")
  const project = await db
    .select({ id: projects.id, name: projects.name, projectNumber: projects.projectNumber })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, access.organizationId)))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!project) throw new Error("Project not found.")

  const viewerIsInternal = isInternalStaffRole(user.role)
  if (viewerIsInternal) {
    return {
      db,
      user,
      organizationId: access.organizationId,
      viewerIsInternal,
      project,
      assignedFilter: or(
        isNotNull(projectWarrantyClaims.assignedProjectContactId),
        isNotNull(projectWarrantyClaims.assignedVendorId),
      ) ?? isNotNull(projectWarrantyClaims.assignedVendorId),
    }
  }

  const membership = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!canUseProjectAudience(membership?.role ?? null, "sub_vendor")) throw new Error("Project not found.")
  const contact = await getProjectAudienceViewerContact(db, projectId, { id: user.id, email: user.email })
  if (!contact || (contact.contactType !== "subcontractor" && contact.contactType !== "supplier")) {
    // Not matched to a vendor contact on this project: nothing is assigned to them.
    return { db, user, organizationId: access.organizationId, viewerIsInternal, project, assignedFilter: eq(projectWarrantyClaims.id, "") }
  }
  const byContact = eq(projectWarrantyClaims.assignedProjectContactId, contact.id)
  return {
    db,
    user,
    organizationId: access.organizationId,
    viewerIsInternal,
    project,
    assignedFilter: contact.vendorId
      ? (or(byContact, eq(projectWarrantyClaims.assignedVendorId, contact.vendorId)) ?? byContact)
      : byContact,
  }
}

export async function getVendorWarrantyWorkspace(projectId: string): Promise<VendorWarrantyWorkspace> {
  const context = await vendorWarrantyContext(projectId)
  const rows = await context.db
    .select()
    .from(projectWarrantyClaims)
    .where(
      and(
        eq(projectWarrantyClaims.projectId, projectId),
        eq(projectWarrantyClaims.organizationId, context.organizationId),
        context.assignedFilter,
      ),
    )
    .orderBy(desc(projectWarrantyClaims.updatedAt))
  const events = rows.length
    ? await context.db
        .select()
        .from(projectWarrantyClaimEvents)
        .where(
          and(
            inArray(projectWarrantyClaimEvents.claimId, rows.map((row) => row.id)),
            eq(projectWarrantyClaimEvents.ownerVisible, true),
          ),
        )
        .orderBy(asc(projectWarrantyClaimEvents.createdAt))
    : []
  return {
    projectNumber: context.project.projectNumber,
    projectName: context.project.name,
    viewerIsInternal: context.viewerIsInternal,
    claims: rows.map((row) => ({
      id: row.id,
      claimNumber: row.claimNumber,
      title: row.title,
      location: row.location,
      category: row.category,
      description: row.description,
      priority: row.priority,
      status: row.status,
      claimantName: row.claimantName,
      assignedName: row.assignedName,
      scheduledFor: row.scheduledFor,
      workStartedAt: row.workStartedAt,
      resolvedAt: row.resolvedAt,
      ownerConfirmedAt: row.ownerConfirmedAt,
      resolutionSummary: row.resolutionSummary,
      submittedAt: row.submittedAt,
      updatedAt: row.updatedAt,
      history: events
        .filter((event) => event.claimId === row.id)
        .map((event) => ({
          id: event.id,
          actorName: event.actorName,
          toStatus: event.toStatus,
          note: event.note,
          createdAt: event.createdAt,
        })),
    })),
  }
}

type VendorUpdateResult = { readonly success: true } | { readonly success: false; readonly error: string }

/**
 * A sub/vendor updates their own claim: the visit date, work started or
 * resolved, and a progress note the owner sees. Priority, assignment and
 * internal notes stay with staff; the owner still confirms a resolution.
 */
export async function updateVendorWarrantyClaim(
  projectId: string,
  claimId: string,
  input: { readonly scheduledFor: string | null; readonly status: string; readonly note: string | null },
): Promise<VendorUpdateResult> {
  try {
    const context = await vendorWarrantyContext(projectId)
    if (context.viewerIsInternal) {
      return { success: false, error: "Staff update claims from the project's warranty page." }
    }
    const status = VENDOR_WARRANTY_STATUSES.find((value) => value === input.status)
    if (!status) return { success: false, error: "Choose visit scheduled, in progress or resolved." }
    const note = input.note?.trim() ? input.note.trim().slice(0, 2000) : null
    const scheduledFor = input.scheduledFor?.trim() ? input.scheduledFor.trim() : null
    if (scheduledFor && Number.isNaN(Date.parse(scheduledFor))) {
      return { success: false, error: "Enter a valid visit date." }
    }
    const existing = await context.db
      .select()
      .from(projectWarrantyClaims)
      .where(
        and(
          eq(projectWarrantyClaims.id, claimId),
          eq(projectWarrantyClaims.projectId, projectId),
          eq(projectWarrantyClaims.organizationId, context.organizationId),
          context.assignedFilter,
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!existing) return { success: false, error: "This claim isn't assigned to you." }
    if (existing.status === "closed" || existing.status === "rejected" || existing.ownerConfirmedAt) {
      return { success: false, error: "This claim is closed." }
    }

    const now = new Date().toISOString()
    const nextStatus: VendorWarrantyStatus = status
    await context.db
      .update(projectWarrantyClaims)
      .set({
        status: nextStatus,
        scheduledFor,
        acknowledgedAt: existing.acknowledgedAt ?? now,
        workStartedAt: nextStatus === "in_progress" || nextStatus === "resolved" ? existing.workStartedAt ?? now : existing.workStartedAt,
        resolvedAt: nextStatus === "resolved" ? existing.resolvedAt ?? now : null,
        resolutionSummary: note ?? existing.resolutionSummary,
        updatedAt: now,
      })
      .where(and(eq(projectWarrantyClaims.id, claimId), eq(projectWarrantyClaims.projectId, projectId)))
    const statusChanged = existing.status !== nextStatus
    await context.db.insert(projectWarrantyClaimEvents).values({
      id: crypto.randomUUID(),
      organizationId: context.organizationId,
      projectId,
      claimId,
      actorUserId: context.user.id,
      actorName: context.user.displayName?.trim() || context.user.email,
      actorRole: context.user.role,
      eventType: statusChanged ? "status_changed" : "vendor_update",
      fromStatus: existing.status,
      toStatus: nextStatus,
      note,
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
        ? `Changed ${existing.claimNumber} from ${existing.status} to ${nextStatus}.`
        : `Updated ${existing.claimNumber}.`,
      metadata: { status: nextStatus, by: "sub_vendor" },
    })
    if (statusChanged) {
      try {
        await notifyWarrantyClaimUpdated({
          organizationId: context.organizationId,
          projectId,
          claimId,
          claimNumber: existing.claimNumber,
          title: existing.title,
          status: nextStatus,
          claimantUserId: existing.claimantUserId,
          updatedBy: context.user,
        })
      } catch (notificationError) {
        console.error("Warranty vendor update notification failed", notificationError)
      }
    }
    for (const path of [
      `/dashboard/projects/${projectId}/warranty`,
      `/preview/projects/${projectId}/owner/warranty`,
      `/preview/projects/${projectId}/sub-vendor/warranty`,
    ]) revalidatePath(path)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to update the claim." }
  }
}
