"use server"

import { currentDepartmentProfiles } from "@/lib/department-profiles-server"
import { and, desc, eq, gt, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { projectOperations, projects } from "@/db/schema"
import { projectRfqEmailDeliveries, projectRfqQuoteLinks } from "@/db/schema-rfqs"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { notificationLink } from "@/lib/notifications/create-event"
import { hashQuoteLinkToken, newQuoteLinkToken, QUOTE_LINK_PATH, quoteLinkExpiresAt, quoteLinkIsLive } from "@/lib/rfqs/quote-links"
import type { AuthUser } from "@/lib/auth"
import { orgContext, type Db } from "@/lib/server/action-context"
import {
  insertRfqEmailDelivery,
  insertRfqQuoteLink,
  updateOperations,
  updateRfqEmailDelivery,
  updateRfqQuoteLinkById,
  updateRfqQuoteLinks,
} from "@/lib/domain/operations/store"
import { activityActorName, recordActivityEvent } from "@/lib/activity-log"
import { sendTrackedEmail } from "@/lib/email/tracked-send"
import { isValidRecipientEmail, normalizeRecipientEmail } from "@/lib/email/recipient-options"
import { getProjectDocumentDriveContext } from "@/lib/google/project-document-drive"
import { projectTopLevelFolderOf } from "@/lib/google/project-folder-boundary"
import { classifyProjectFolderName, type ProjectFileCategoryKey } from "@/lib/project-files"
import { projectBrandFor } from "@/lib/project-branding"
import { driveFileIdFromRfqLink } from "@/lib/rfqs/drive-links"
import { rfqEmailHtml, rfqEmailText, type RfqEmailDocument } from "@/lib/rfqs/email"
import { parsePortalRfqPayload, rfqNeedsTemplateReview, withPortalRfqRecipientEmail } from "@/lib/rfqs/portal-response"
import { projectNumberAndName } from "@/lib/project-display-name"

/** Project subfolders whose whole contents may be shared with RFQ vendors. */
const RFQ_SHAREABLE_FOLDER_CATEGORIES: ReadonlySet<ProjectFileCategoryKey> = new Set(["plans", "submittals"])

export type RfqEmailDeliveryItem = {
  readonly id: string
  readonly rfqOperationId: string
  readonly recipientEmail: string
  readonly ccEmails: readonly string[]
  readonly status: string
  readonly requestedByName: string
  readonly requestedAt: string
  readonly sentAt: string | null
  readonly documentCount: number
}

export type SendProjectRfqEmailInput = {
  readonly expectedUpdatedAt: string
  readonly to: string
  readonly cc: readonly string[]
  readonly subject: string
  readonly message: string
}

export type SendProjectRfqEmailResult =
  | { readonly success: true; readonly deliveryId: string }
  | { readonly success: false; readonly error: string }

function parseJsonStrings(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : []
  } catch {
    return []
  }
}

async function projectRfqEmailAccess(projectId: string, update: boolean): Promise<{
  readonly db: Db
  readonly env: CloudflareEnv
  readonly user: AuthUser
  readonly organizationId: string
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly googleDriveFolderId: string | null
  }
}> {
  // The project check keeps its own "Project not found." message.
  const context = await orgContext({ feature: "rfqs", action: update ? "update" : "read", mutation: update })
  if (!context.success) throw new Error(context.error)
  const { db, env, user, organizationId } = context.data
  const project = await db.select({
    id: projects.id,
    name: projects.name,
    projectNumber: projects.projectNumber,
    googleDriveFolderId: projects.googleDriveFolderId,
  }).from(projects).where(and(
    eq(projects.id, projectId),
    eq(projects.organizationId, organizationId)
  )).limit(1).then((rows) => rows[0] ?? null)
  if (!project) throw new Error("Project not found.")
  return { db, env, user, organizationId, project }
}

export async function getProjectRfqEmailDeliveries(
  projectId: string
): Promise<readonly RfqEmailDeliveryItem[]> {
  const access = await projectRfqEmailAccess(projectId, false)
  const rows = await access.db.select().from(projectRfqEmailDeliveries)
    .where(eq(projectRfqEmailDeliveries.projectId, projectId))
    .orderBy(desc(projectRfqEmailDeliveries.requestedAt))
  return rows.map((row) => ({
    id: row.id,
    rfqOperationId: row.rfqOperationId,
    recipientEmail: row.recipientEmail,
    ccEmails: parseJsonStrings(row.ccEmailsJson),
    status: row.status,
    requestedByName: row.requestedByName,
    requestedAt: row.requestedAt,
    sentAt: row.sentAt,
    documentCount: parseJsonStrings(row.documentLinksJson).length,
  }))
}

export async function sendProjectRfqEmail(
  projectId: string,
  rfqId: string,
  input: SendProjectRfqEmailInput
): Promise<SendProjectRfqEmailResult> {
  try {
    const access = await projectRfqEmailAccess(projectId, true)
    if (!Array.isArray(input.cc) || input.cc.some((email) => typeof email !== "string")) {
      return { success: false, error: "Enter up to five valid Cc email addresses." }
    }
    const to = normalizeRecipientEmail(input.to)
    const cc = [...new Set(input.cc.map(normalizeRecipientEmail))].filter((email) => email !== to)
    if (!isValidRecipientEmail(to)) return { success: false, error: "Enter a valid vendor email." }
    if (cc.length > 5 || cc.some((email) => !isValidRecipientEmail(email))) {
      return { success: false, error: "Enter up to five valid Cc email addresses." }
    }
    const subject = input.subject.trim()
    const message = input.message.trim()
    if (!subject || subject.length > 300 || !message || message.length > 10_000) {
      return { success: false, error: "Enter a subject and message." }
    }
    const rfq = await access.db.select().from(projectOperations).where(and(
      eq(projectOperations.id, rfqId),
      eq(projectOperations.projectId, projectId),
      eq(projectOperations.sourceRecordType, "rfq")
    )).limit(1).then((rows) => rows[0] ?? null)
    if (!rfq) return { success: false, error: "RFQ not found." }
    if (rfq.updatedAt !== input.expectedUpdatedAt) {
      return { success: false, error: "This RFQ changed. Refresh and review its scope and files before sending." }
    }
    if (!["draft", "sent"].includes(rfq.status)) {
      return { success: false, error: "Only a draft or sent RFQ can be emailed." }
    }
    const payload = parsePortalRfqPayload(rfq.sagePayloadJson)
    if (rfqNeedsTemplateReview(rfq.sagePayloadJson)) {
      return { success: false, error: "Review the template RFQ and its document package before sending." }
    }
    if (payload.recipientEmail && normalizeRecipientEmail(payload.recipientEmail) !== to) {
      return { success: false, error: "This RFQ names another recipient. Edit the RFQ or duplicate it for this bidder." }
    }
    if (payload.documentLinks.length === 0) {
      return { success: false, error: "Add the plans and specifications links before sending." }
    }
    if (!access.project.googleDriveFolderId) {
      return { success: false, error: "This project needs a Drive folder before its RFQ files can be shared." }
    }
    const drive = await getProjectDocumentDriveContext({ db: access.db, env: access.env })
    const documents: RfqEmailDocument[] = []
    const fileIds: string[] = []
    for (const link of payload.documentLinks) {
      const fileId = driveFileIdFromRfqLink(link.url)
      if (!fileId || fileId === access.project.googleDriveFolderId) {
        return { success: false, error: `Use a project Drive file or subfolder link for ${link.label}.` }
      }
      const topLevel = await projectTopLevelFolderOf({
        client: drive.client,
        googleEmail: drive.googleEmail,
        itemId: fileId,
        projectFolderId: access.project.googleDriveFolderId,
      })
      if (!topLevel) {
        return { success: false, error: `${link.label} is outside this project's Drive folder.` }
      }
      const file = await drive.client.getFile(drive.googleEmail, fileId)
      if (file.trashed) return { success: false, error: `${link.label} is in Drive trash.` }
      // Sharing a folder gives the vendor everything in it, including records
      // Compass saves later, so whole folders are limited to plans and
      // submittals. Individual files can come from anywhere in the project.
      if (
        file.mimeType === "application/vnd.google-apps.folder" &&
        !RFQ_SHAREABLE_FOLDER_CATEGORIES.has(classifyProjectFolderName(topLevel.name)?.key ?? "unknown")
      ) {
        return {
          success: false,
          error: `${link.label} is a folder outside Plans and Submittals. Link the individual files instead.`,
        }
      }
      fileIds.push(fileId)
      documents.push({
        label: link.label,
        url: file.webViewLink ?? link.url,
        notes: link.notes,
      })
    }
    const now = new Date().toISOString()
    const deliveryId = crypto.randomUUID()
    const actorName = access.user.displayName?.trim() || access.user.email
    await insertRfqEmailDelivery(access.db, {
      id: deliveryId,
      projectId,
      rfqOperationId: rfqId,
      recipientEmail: to,
      ccEmailsJson: JSON.stringify(cc),
      subject,
      documentLinksJson: JSON.stringify(documents.map((document) => document.url)),
      status: "preparing",
      provider: null,
      providerMessageId: null,
      error: null,
      requestedBy: access.user.id,
      requestedByName: actorName,
      requestedAt: now,
      sentAt: null,
    })

    // A private price link for this recipient; only its hash is stored.
    const pricing = await readFeatureSettings(access.db, access.organizationId, "estimate-pricing")
    const quoteToken = newQuoteLinkToken()
    const quoteLinkId = crypto.randomUUID()
    await insertRfqQuoteLink(access.db, {
      id: quoteLinkId,
      projectId,
      rfqOperationId: rfqId,
      tokenHash: await hashQuoteLinkToken(quoteToken),
      recipientEmail: to,
      expiresAt: quoteLinkExpiresAt({
        now: new Date(now),
        dueDate: rfq.dueDate,
        graceDays: pricing.quoteLinkGraceDays,
        daysWithoutDueDate: pricing.quoteLinkDaysWithoutDueDate,
      }),
      revokedAt: null,
      revokedBy: null,
      lastOpenedAt: null,
      submittedAt: null,
      createdBy: access.user.id,
      createdAt: now,
    })
    const quoteUrl = notificationLink(access.env, `${QUOTE_LINK_PATH}/${quoteToken}`)

    let deliveryStatus = "failed"
    let provider: string | null = null
    let providerMessageId: string | null = null
    let deliveryError: string | null = null
    try {
      for (const fileId of new Set(fileIds)) {
        for (const email of [to, ...cc]) {
          await drive.client.ensureReaderPermission(drive.googleEmail, fileId, email)
        }
      }
      const brand = projectBrandFor({ profiles: await currentDepartmentProfiles(), projectId, projectNumber: access.project.projectNumber })
      const emailInput = {
        brand,
        projectLabel: access.project.projectNumber
          ? projectNumberAndName(access.project, " - ")
          : access.project.name,
        rfqNumber: rfq.sourceRecordNumber,
        title: rfq.title,
        scope: rfq.description,
        requestedFrom: rfq.companyName,
        dueDate: rfq.dueDate,
        message,
        senderName: actorName,
        lines: payload.scopeItems,
        documents,
        quoteUrl,
      }
      // The vendor's reply comes back onto this RFQ and still reaches the
      // estimator who sent it.
      const delivery = await sendTrackedEmail({
        env: access.env,
        db: access.db,
        organizationId: access.organizationId,
        projectId,
        kind: "rfq",
        recordId: rfqId,
        recordLabel: rfq.sourceRecordNumber,
        createdBy: access.user.id,
        to: [to],
        cc,
        subject,
        text: rfqEmailText(emailInput),
        html: rfqEmailHtml(emailInput),
        replyName: `${actorName} - ${rfq.sourceRecordNumber ?? "RFQ"}`,
        alsoReplyTo: [access.user.email],
      })
      deliveryStatus = delivery.status === "sent" ? "sent" : "failed"
      provider = delivery.provider
      providerMessageId = delivery.providerMessageId
      deliveryError = delivery.error
    } catch (error) {
      deliveryError = error instanceof Error ? error.message : "Unable to share files or send email."
    }

    const sentAt = deliveryStatus === "sent" ? new Date().toISOString() : null
    await updateRfqEmailDelivery(access.db, deliveryId, {
      status: deliveryStatus,
      provider,
      providerMessageId,
      error: deliveryError,
      sentAt,
    })
    if (deliveryStatus !== "sent") {
      // The email never went out, so its link shouldn't work either.
      await updateRfqQuoteLinkById(access.db, quoteLinkId, { revokedAt: new Date().toISOString() })
      return { success: false, error: deliveryError ?? "RFQ email was not sent. Check the email provider and Drive sharing settings." }
    }
    await updateOperations(access.db, and(
      eq(projectOperations.id, rfqId),
      eq(projectOperations.projectId, projectId),
      eq(projectOperations.updatedAt, rfq.updatedAt)
    ), {
      status: "sent",
      sagePayloadJson: withPortalRfqRecipientEmail(rfq.sagePayloadJson, to),
      updatedAt: sentAt ?? new Date().toISOString(),
    })
    await recordActivityEvent({
      db: access.db,
      organizationId: access.organizationId,
      projectId,
      actor: access.user,
      category: "email",
      action: "rfq_emailed",
      entityType: "project_operation",
      entityId: rfqId,
      summary: `Emailed ${rfq.sourceRecordNumber ?? "RFQ"} ${rfq.title} to ${[to, ...cc].join(", ")}.`,
      metadata: { recipients: 1 + cc.length, documents: documents.length, sentBy: activityActorName(access.user) },
    })
    revalidatePath(`/dashboard/projects/${projectId}/rfqs`)
    revalidatePath(`/preview/projects/${projectId}/sub-vendor/rfqs`)
    return { success: true, deliveryId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to send RFQ email." }
  }
}

export type RfqQuoteLinkItem = {
  readonly id: string
  readonly rfqOperationId: string
  readonly recipientEmail: string
  readonly createdAt: string
  readonly expiresAt: string
  readonly live: boolean
  readonly lastOpenedAt: string | null
  readonly submittedAt: string | null
}

/** Price links sent for this job's RFQs, newest first. */
export async function getProjectRfqQuoteLinks(projectId: string): Promise<readonly RfqQuoteLinkItem[]> {
  const access = await projectRfqEmailAccess(projectId, false)
  const rows = await access.db.select().from(projectRfqQuoteLinks)
    .where(eq(projectRfqQuoteLinks.projectId, projectId))
    .orderBy(desc(projectRfqQuoteLinks.createdAt))
  const now = new Date()
  return rows.map((row) => ({
    id: row.id,
    rfqOperationId: row.rfqOperationId,
    recipientEmail: row.recipientEmail,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    live: quoteLinkIsLive(row, now),
    lastOpenedAt: row.lastOpenedAt,
    submittedAt: row.submittedAt,
  }))
}

/** Turns off every price link for an RFQ. Vendors can still reply by email. */
export async function turnOffRfqQuoteLinks(
  projectId: string,
  rfqId: string
): Promise<{ readonly success: true; readonly count: number } | { readonly success: false; readonly error: string }> {
  try {
    const access = await projectRfqEmailAccess(projectId, true)
    const now = new Date().toISOString()
    const live = await access.db.select({ id: projectRfqQuoteLinks.id }).from(projectRfqQuoteLinks).where(and(
      eq(projectRfqQuoteLinks.projectId, projectId),
      eq(projectRfqQuoteLinks.rfqOperationId, rfqId),
      isNull(projectRfqQuoteLinks.revokedAt),
      gt(projectRfqQuoteLinks.expiresAt, now)
    ))
    if (live.length === 0) return { success: true, count: 0 }
    await updateRfqQuoteLinks(access.db, and(
      eq(projectRfqQuoteLinks.projectId, projectId),
      eq(projectRfqQuoteLinks.rfqOperationId, rfqId),
      isNull(projectRfqQuoteLinks.revokedAt)
    ), { revokedAt: now, revokedBy: access.user.id })
    await recordActivityEvent({
      db: access.db,
      organizationId: access.organizationId,
      projectId,
      actor: access.user,
      category: "email",
      action: "rfq_quote_link_turned_off",
      entityType: "project_operation",
      entityId: rfqId,
      summary: `Turned off ${live.length} price link${live.length === 1 ? "" : "s"} on an RFQ.`,
    })
    revalidatePath(`/dashboard/projects/${projectId}/rfqs`)
    return { success: true, count: live.length }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to turn off the price link." }
  }
}

