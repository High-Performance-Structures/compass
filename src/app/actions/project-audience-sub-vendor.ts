"use server"

import { and, eq, inArray, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  projectMembers,
  projectOperations,
  projectRfis,
} from "@/db/schema"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import {
  notifyPurchaseOrderVendorUpdate,
  notifyRfiCreated,
  notifyRfqResponseReceived,
} from "@/lib/notifications/events"
import { assertProjectAccess } from "@/lib/project-access"
import type { ProjectAudienceViewerContact } from "@/lib/project-audience-viewer-contact"
import { getProjectAudienceViewerContact } from "@/lib/project-audience-viewer-contact"
import { getProjectAudienceStaff } from "@/lib/project-audience-staff"
import {
  parsePortalPurchaseOrderPayload,
  portalPurchaseOrderCanReceiveResponse,
  portalPurchaseOrderMatchesRecipient,
  withPortalPurchaseOrderAcknowledgement,
  withPortalPurchaseOrderStatusUpdate,
  validPortalPurchaseOrderVendorStatus,
} from "@/lib/purchase-orders/portal-response"
import {
  parsePortalRfqPayload,
  portalRfqCanReceiveResponse,
  portalRfqMatchesRecipient,
  withPortalRfqVendorResponse,
} from "@/lib/rfqs/portal-response"
import { projectRfqBidApprovals } from "@/db/schema-rfqs"
import { validRfiPriority } from "@/lib/rfis/status"
import { resolveSubVendorRfiRecipient } from "@/lib/rfis/sub-vendor-recipient"

type SubVendorActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

export type CreateSubVendorRfiInput = {
  readonly subject: string
  readonly question: string
  readonly priority: string
  readonly recipientUserId: string | null
}

export type SubmitSubVendorRfqResponseInput = {
  readonly decision: "quote" | "decline"
  readonly amount: number | null
  readonly lines: readonly {
    readonly lineNumber: number
    readonly amount: number | null
    readonly notes: string | null
  }[]
  readonly leadTime: string | null
  readonly validUntil: string | null
  readonly notes: string | null
}

export type RespondSubVendorPurchaseOrderInput =
  | {
      readonly decision: "acknowledge"
      readonly note: string | null
    }
  | {
      readonly decision: "status"
      readonly status: string
      readonly note: string | null
    }
  | {
      readonly decision: "question"
      readonly question: string
      readonly recipientUserId: string | null
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
  revalidatePath(`/preview/projects/${projectId}/sub-vendor/commitments`)
  revalidatePath(`/dashboard/projects/${projectId}/rfis`)
  revalidatePath(`/dashboard/projects/${projectId}/rfqs`)
  revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
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

    const audienceStaff = await getProjectAudienceStaff(context.db, {
      projectId,
      organizationId: context.organizationId,
      audience: "sub_vendor",
    })
    const recipient = resolveSubVendorRfiRecipient(
      audienceStaff,
      input.recipientUserId
    )
    if (!recipient.valid) {
      return {
        success: false,
        error: "Choose a staff member selected for the sub/vendor workspace.",
      }
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
      assignedToName: recipient.displayName,
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

export async function respondToSubVendorPurchaseOrder(
  projectId: string,
  purchaseOrderId: string,
  input: RespondSubVendorPurchaseOrderInput
): Promise<SubVendorActionResult> {
  try {
    const context = await getSubVendorWriteContext(projectId)
    const purchaseOrder = await context.db
      .select({
        id: projectOperations.id,
        sourceRecordNumber: projectOperations.sourceRecordNumber,
        title: projectOperations.title,
        status: projectOperations.status,
        assigneeName: projectOperations.assigneeName,
        companyName: projectOperations.companyName,
        sageVendorName: projectOperations.sageVendorName,
        sagePayloadJson: projectOperations.sagePayloadJson,
        revision: projectOperations.revision,
        updatedAt: projectOperations.updatedAt,
      })
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.id, purchaseOrderId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "purchase_order")
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!purchaseOrder) {
      return { success: false, error: "Purchase order not found." }
    }
    if (!portalPurchaseOrderCanReceiveResponse(purchaseOrder.status)) {
      return {
        success: false,
        error: "This purchase order is no longer accepting responses.",
      }
    }

    const payload = parsePortalPurchaseOrderPayload(
      purchaseOrder.sagePayloadJson
    )
    if (
      !portalPurchaseOrderMatchesRecipient({
        recipientEmails: payload.recipientEmails,
        companyName: purchaseOrder.companyName,
        assigneeName: purchaseOrder.assigneeName,
        vendorName: purchaseOrder.sageVendorName,
        viewerEmail: context.user.email,
        viewerCompanyName: context.viewerContact.companyName,
        viewerDisplayName: context.viewerContact.displayName,
      })
    ) {
      return {
        success: false,
        error: "This purchase order was assigned to another vendor.",
      }
    }

    const now = new Date().toISOString()
    if (input.decision === "acknowledge") {
      const updateResult = await context.db
        .update(projectOperations)
        .set({
          sagePayloadJson: withPortalPurchaseOrderAcknowledgement(
            purchaseOrder.sagePayloadJson,
            {
              responderUserId: context.user.id,
              responderName: context.user.displayName ?? context.user.email,
              responderCompany: context.viewerContact.companyName,
              note: cleanText(input.note, 2_000),
              submittedAt: now,
            }
          ),
          revision: purchaseOrder.revision + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(projectOperations.id, purchaseOrderId),
            eq(projectOperations.projectId, projectId),
            eq(projectOperations.sourceRecordType, "purchase_order"),
            eq(projectOperations.status, purchaseOrder.status),
            eq(projectOperations.revision, purchaseOrder.revision),
            isNull(projectOperations.purchaseOrderEmailClaimToken),
            eq(projectOperations.updatedAt, purchaseOrder.updatedAt)
          )
        )
        .run()
      if ((updateResult.meta.changes ?? 0) !== 1) {
        return {
          success: false,
          error:
            "The purchase order changed. Refresh the page before responding.",
        }
      }
      revalidateSubVendorWorkspace(projectId)
      try {
        await notifyPurchaseOrderVendorUpdate({
          organizationId: context.organizationId,
          projectId,
          purchaseOrderId,
          purchaseOrderNumber: purchaseOrder.sourceRecordNumber,
          title: purchaseOrder.title,
          update: "acknowledged",
          note: cleanText(input.note, 2_000),
          respondedBy: context.user,
        })
      } catch (notificationError) {
        console.error(
          "[sub-vendor-po-acknowledgement] notification error",
          notificationError
        )
      }
      return { success: true, id: purchaseOrderId }
    }

    if (input.decision === "status") {
      const status = validPortalPurchaseOrderVendorStatus(input.status)
      if (!status) {
        return { success: false, error: "Choose a valid fulfillment status." }
      }
      const note = cleanText(input.note, 2_000)
      const updateResult = await context.db
        .update(projectOperations)
        .set({
          sagePayloadJson: withPortalPurchaseOrderStatusUpdate(
            purchaseOrder.sagePayloadJson,
            {
              status,
              responderUserId: context.user.id,
              responderName: context.user.displayName ?? context.user.email,
              responderCompany: context.viewerContact.companyName,
              note,
              submittedAt: now,
            }
          ),
          updatedAt: now,
        })
        .where(
          and(
            eq(projectOperations.id, purchaseOrderId),
            eq(projectOperations.projectId, projectId),
            eq(projectOperations.status, purchaseOrder.status),
            eq(projectOperations.updatedAt, purchaseOrder.updatedAt)
          )
        )
        .run()
      if ((updateResult.meta.changes ?? 0) !== 1) {
        return {
          success: false,
          error:
            "The purchase order changed. Refresh the page before responding.",
        }
      }
      revalidateSubVendorWorkspace(projectId)
      try {
        await notifyPurchaseOrderVendorUpdate({
          organizationId: context.organizationId,
          projectId,
          purchaseOrderId,
          purchaseOrderNumber: purchaseOrder.sourceRecordNumber,
          title: purchaseOrder.title,
          update: status,
          note,
          respondedBy: context.user,
        })
      } catch (notificationError) {
        console.error(
          "[sub-vendor-po-status] notification error",
          notificationError
        )
      }
      return { success: true, id: purchaseOrderId }
    }

    const audienceStaff = await getProjectAudienceStaff(context.db, {
      projectId,
      organizationId: context.organizationId,
      audience: "sub_vendor",
    })
    const recipient = resolveSubVendorRfiRecipient(
      audienceStaff,
      input.recipientUserId
    )
    if (!recipient.valid) {
      return {
        success: false,
        error: "Choose a staff member selected for the sub/vendor workspace.",
      }
    }

    const rows = await context.db
      .select({ id: projectRfis.id })
      .from(projectRfis)
      .where(eq(projectRfis.projectId, projectId))
    const rfiId = crypto.randomUUID()
    const poReference = purchaseOrder.sourceRecordNumber ?? purchaseOrder.title
    const inserted: typeof projectRfis.$inferInsert = {
      id: rfiId,
      projectId,
      sourceSystem: "compass_portal",
      rfiNumber: rfiNumber(context.projectNumber, rows.length, rfiId),
      subject: `Question about PO ${poReference}`.slice(0, 240),
      question: requireText(input.question, "Question", 10_000),
      status: "new",
      priority: "normal",
      audience: "sub_vendor",
      requesterName: context.user.displayName ?? context.user.email,
      assignedToName: recipient.displayName,
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
        rfiId,
        rfiNumber: inserted.rfiNumber,
        subject: inserted.subject,
        assignedToName: inserted.assignedToName ?? null,
        createdBy: context.user,
      })
    } catch (notificationError) {
      console.error("[sub-vendor-po-question] notification error", notificationError)
    }

    return { success: true, id: rfiId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to respond to the purchase order.",
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
    let amount =
      input.amount === null || !Number.isFinite(input.amount)
        ? null
        : Math.round(input.amount * 100) / 100

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
    const approval = await context.db
      .select({ id: projectRfqBidApprovals.id })
      .from(projectRfqBidApprovals)
      .where(eq(projectRfqBidApprovals.rfqOperationId, rfqId))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (approval) {
      return { success: false, error: "This RFQ bid has already been approved." }
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

    const responseLines = input.decision === "quote"
      ? input.lines.map((line) => ({
          lineNumber: line.lineNumber,
          amount:
            line.amount === null || !Number.isFinite(line.amount)
              ? null
              : Math.round(line.amount * 100) / 100,
          notes: cleanText(line.notes, 2_000),
        }))
      : []
    if (input.decision === "quote" && payload.scopeItems.length > 0) {
      const expectedNumbers = new Set(
        payload.scopeItems.map((line) => line.lineNumber)
      )
      const submittedNumbers = new Set(
        responseLines.map((line) => line.lineNumber)
      )
      const complete =
        expectedNumbers.size === responseLines.length &&
        expectedNumbers.size === submittedNumbers.size &&
        [...expectedNumbers].every((lineNumber) =>
          submittedNumbers.has(lineNumber)
        )
      if (
        !complete ||
        responseLines.some(
          (line) => line.amount === null || line.amount < 0
        )
      ) {
        return {
          success: false,
          error: "Enter a valid price for every RFQ scope line.",
        }
      }
      amount = responseLines.reduce(
        (total, line) => total + (line.amount ?? 0),
        0
      )
    }
    if (input.decision === "quote" && (amount === null || amount < 0)) {
      return { success: false, error: "Enter a valid quote amount." }
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
          lines:
            input.decision === "quote"
              ? responseLines.flatMap((line) =>
                  line.amount === null
                    ? []
                    : [{ ...line, amount: line.amount }]
                )
              : [],
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
