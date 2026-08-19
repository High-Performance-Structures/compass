"use server"

import { and, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  organizationMembers,
  projectMembers,
  projectOperations,
  projectRfis,
  users,
} from "@/db/schema"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import {
  notifyRfiCreated,
  notifyRfqResponseReceived,
} from "@/lib/notifications/events"
import { assertProjectAccess } from "@/lib/project-access"
import type { ProjectAudienceViewerContact } from "@/lib/project-audience-viewer-contact"
import { getProjectAudienceViewerContact } from "@/lib/project-audience-viewer-contact"
import { isAssignedVisibleAudienceTeamMember } from "@/lib/project-audience-team"
import {
  parsePortalRfqPayload,
  portalRfqCanReceiveResponse,
  portalRfqMatchesRecipient,
  withPortalRfqVendorResponse,
} from "@/lib/rfqs/portal-response"
import { validRfiPriority } from "@/lib/rfis/status"

type SubVendorActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

export type CreateSubVendorRfiInput = {
  readonly subject: string
  readonly question: string
  readonly priority: string
  readonly recipientUserId: string
}

export type SubmitSubVendorRfqResponseInput = {
  readonly decision: "quote" | "decline"
  readonly amount: number | null
  readonly leadTime: string | null
  readonly validUntil: string | null
  readonly notes: string | null
}

type SubVendorWriteContext = {
  readonly db: ReturnType<typeof getDb>
  readonly user: AuthUser
  readonly organizationId: string
  readonly projectNumber: string | null
  readonly viewerContact: ProjectAudienceViewerContact
}

function cleanText(value: string | null, maximumLength = 10_000): string | null {
  const trimmed = value?.trim() ?? ""
  if (!trimmed) return null
  if (trimmed.length > maximumLength) {
    throw new Error(`Text must be ${maximumLength.toLocaleString()} characters or fewer.`)
  }
  return trimmed
}

function requireText(
  value: string,
  label: string,
  maximumLength: number
): string {
  const cleaned = cleanText(value, maximumLength)
  if (!cleaned) throw new Error(`${label} is required.`)
  return cleaned
}

function validDate(value: string | null): string | null {
  const cleaned = cleanText(value, 10)
  if (!cleaned) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    throw new Error("Valid until must be a valid date.")
  }
  return cleaned
}

async function getSubVendorWriteContext(
  projectId: string
): Promise<SubVendorWriteContext> {
  const user = await requireAuth()
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const project = await assertProjectAccess(db, user, projectId)
  if (!project.organizationId) throw new Error("Project organization is missing.")

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
  if (
    membership?.role !== "subcontractor" &&
    membership?.role !== "supplier"
  ) {
    throw new Error("Only an assigned sub/vendor can use this action.")
  }

  const viewerContact = await getProjectAudienceViewerContact(db, projectId, {
    id: user.id,
    email: user.email,
  })
  if (!viewerContact) {
    throw new Error("Your project contact record could not be verified.")
  }

  return {
    db,
    user,
    organizationId: project.organizationId,
    projectNumber: project.projectNumber,
    viewerContact,
  }
}

function rfiNumber(
  projectNumber: string | null,
  existingCount: number,
  id: string
): string {
  const sequence = String(existingCount + 1).padStart(3, "0")
  const prefix = projectNumber?.trim() ?? ""
  return prefix
    ? `${prefix}-RFI-${sequence}`
    : `RFI-${sequence}-${id.slice(0, 6).toUpperCase()}`
}

function revalidateSubVendorWorkspace(projectId: string): void {
  revalidatePath(`/preview/projects/${projectId}/sub-vendor`)
  revalidatePath(`/preview/projects/${projectId}/sub-vendor/rfis`)
  revalidatePath(`/preview/projects/${projectId}/sub-vendor/rfqs`)
  revalidatePath(`/dashboard/projects/${projectId}/rfis`)
  revalidatePath(`/dashboard/projects/${projectId}/rfqs`)
  revalidatePath("/dashboard/rfis")
}

export async function createSubVendorRfi(
  projectId: string,
  input: CreateSubVendorRfiInput
): Promise<SubVendorActionResult> {
  try {
    const context = await getSubVendorWriteContext(projectId)
    const priority = validRfiPriority(input.priority)
    if (!priority) return { success: false, error: "Choose a valid priority." }

    const recipient = await context.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        organizationRole: organizationMembers.role,
        projectRole: projectMembers.role,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .innerJoin(
        organizationMembers,
        and(
          eq(organizationMembers.userId, users.id),
          eq(organizationMembers.organizationId, context.organizationId)
        )
      )
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, input.recipientUserId),
          eq(users.isActive, true)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (
      !recipient ||
      !isAssignedVisibleAudienceTeamMember({
        userId: recipient.id,
        email: recipient.email,
        organizationRole: recipient.organizationRole,
        projectRole: recipient.projectRole,
      })
    ) {
      return { success: false, error: "Choose an assigned project team member." }
    }

    const rows = await context.db
      .select({ id: projectRfis.id })
      .from(projectRfis)
      .where(eq(projectRfis.projectId, projectId))
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const inserted: typeof projectRfis.$inferInsert = {
      id,
      projectId,
      sourceSystem: "compass_portal",
      rfiNumber: rfiNumber(context.projectNumber, rows.length, id),
      subject: requireText(input.subject, "Subject", 240),
      question: requireText(input.question, "Question", 10_000),
      status: "new",
      priority,
      audience: "sub_vendor",
      requesterName: context.user.displayName ?? context.user.email,
      assignedToName: recipient.displayName ?? recipient.email,
      companyName: context.viewerContact.companyName,
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    }
    await context.db.insert(projectRfis).values(inserted)
    revalidateSubVendorWorkspace(projectId)

    try {
      await notifyRfiCreated({
        organizationId: context.organizationId,
        projectId,
        rfiId: id,
        rfiNumber: inserted.rfiNumber,
        subject: inserted.subject,
        assignedToName: inserted.assignedToName ?? null,
        createdBy: context.user,
      })
    } catch (notificationError) {
      console.error("[sub-vendor-rfi] notification error", notificationError)
    }

    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to send the RFI.",
    }
  }
}

export async function submitSubVendorRfqResponse(
  projectId: string,
  rfqId: string,
  input: SubmitSubVendorRfqResponseInput
): Promise<SubVendorActionResult> {
  try {
    const context = await getSubVendorWriteContext(projectId)
    if (input.decision !== "quote" && input.decision !== "decline") {
      return { success: false, error: "Choose quote or decline." }
    }
    const amount =
      input.amount === null || !Number.isFinite(input.amount)
        ? null
        : Math.round(input.amount * 100) / 100
    if (input.decision === "quote" && (amount === null || amount < 0)) {
      return { success: false, error: "Enter a valid quote amount." }
    }

    const rfq = await context.db
      .select()
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.id, rfqId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "rfq")
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!rfq) return { success: false, error: "RFQ not found." }
    if (!portalRfqCanReceiveResponse(rfq.status)) {
      return { success: false, error: "This RFQ is not accepting responses." }
    }

    const payload = parsePortalRfqPayload(rfq.sagePayloadJson)
    if (
      !portalRfqMatchesRecipient({
        recipientEmail: payload.recipientEmail,
        companyName: rfq.companyName,
        assigneeName: rfq.assigneeName,
        viewerEmail: context.user.email,
        viewerCompanyName: context.viewerContact.companyName,
        viewerDisplayName: context.viewerContact.displayName,
      })
    ) {
      return { success: false, error: "This RFQ was assigned to another vendor." }
    }

    const now = new Date().toISOString()
    const responseStatus =
      input.decision === "decline" ? "declined" : "response_received"
    await context.db
      .update(projectOperations)
      .set({
        status: responseStatus,
        amount: input.decision === "quote" ? amount : null,
        sagePayloadJson: withPortalRfqVendorResponse(rfq.sagePayloadJson, {
          decision: input.decision,
          amount: input.decision === "quote" ? amount : null,
          leadTime: cleanText(input.leadTime, 240),
          validUntil: validDate(input.validUntil),
          notes: cleanText(input.notes, 10_000),
          responderUserId: context.user.id,
          responderName: context.user.displayName ?? context.user.email,
          responderCompany: context.viewerContact.companyName,
          submittedAt: now,
        }),
        updatedAt: now,
      })
      .where(
        and(
          eq(projectOperations.id, rfqId),
          eq(projectOperations.projectId, projectId),
          inArray(projectOperations.status, ["sent", "response_received"])
        )
      )
    const updatedRfq = await context.db
      .select({ status: projectOperations.status })
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.id, rfqId),
          eq(projectOperations.projectId, projectId)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (updatedRfq?.status !== responseStatus) {
      return {
        success: false,
        error: "The RFQ status changed. Refresh the page before responding.",
      }
    }
    revalidateSubVendorWorkspace(projectId)

    try {
      await notifyRfqResponseReceived({
        organizationId: context.organizationId,
        projectId,
        rfqId,
        rfqNumber: rfq.sourceRecordNumber,
        title: rfq.title,
        decision: input.decision,
        amount: input.decision === "quote" ? amount : null,
        respondedBy: context.user,
      })
    } catch (notificationError) {
      console.error("[sub-vendor-rfq] notification error", notificationError)
    }

    return { success: true, id: rfqId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to submit the RFQ response.",
    }
  }
}
