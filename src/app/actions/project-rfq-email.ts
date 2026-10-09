"use server"

import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projectOperations, projects } from "@/db/schema"
import { projectRfqEmailDeliveries } from "@/db/schema-rfqs"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { sendCompassEmail } from "@/lib/email/compass-email"
import { isValidRecipientEmail, normalizeRecipientEmail } from "@/lib/email/recipient-options"
import { getProjectDocumentDriveContext } from "@/lib/google/project-document-drive"
import { isDriveItemWithinProjectFolder } from "@/lib/google/project-folder-boundary"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { projectBrandFor } from "@/lib/project-branding"
import { driveFileIdFromRfqLink } from "@/lib/rfqs/drive-links"
import { rfqEmailHtml, rfqEmailText, type RfqEmailDocument } from "@/lib/rfqs/email"
import { parsePortalRfqPayload, rfqNeedsTemplateReview, withPortalRfqRecipientEmail } from "@/lib/rfqs/portal-response"
import { projectNumberAndName } from "@/lib/project-display-name"

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
  readonly db: ReturnType<typeof getDb>
  readonly env: CloudflareEnv
  readonly user: Awaited<ReturnType<typeof requireAuth>>
  readonly organizationId: string
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly googleDriveFolderId: string | null
  }
}> {
  const user = await requireAuth()
  if (update && isDemoUser(user.id)) throw new Error("DEMO_READ_ONLY")
  await requireFeaturePermission(user, "rfqs", update ? "update" : "read")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
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
    const drive = await getProjectDocumentDriveContext({
      db: access.db,
      env: access.env,
      organizationId: access.organizationId,
    })
    const documents: RfqEmailDocument[] = []
    const fileIds: string[] = []
    for (const link of payload.documentLinks) {
      const fileId = driveFileIdFromRfqLink(link.url)
      if (!fileId || fileId === access.project.googleDriveFolderId) {
        return { success: false, error: `Use a project Drive file or subfolder link for ${link.label}.` }
      }
      const withinProject = await isDriveItemWithinProjectFolder({
        client: drive.client,
        googleEmail: drive.googleEmail,
        itemId: fileId,
        projectFolderId: access.project.googleDriveFolderId,
      })
      if (!withinProject) {
        return { success: false, error: `${link.label} is outside this project's Drive folder.` }
      }
      const file = await drive.client.getFile(drive.googleEmail, fileId)
      if (file.trashed) return { success: false, error: `${link.label} is in Drive trash.` }
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
    await access.db.insert(projectRfqEmailDeliveries).values({
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
      const brand = projectBrandFor({ projectId, projectNumber: access.project.projectNumber })
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
      }
      const delivery = await sendCompassEmail({
        env: access.env,
        db: access.db,
        organizationId: access.organizationId,
        to: [to],
        cc,
        replyTo: access.user.email,
        subject,
        text: rfqEmailText(emailInput),
        html: rfqEmailHtml(emailInput),
      })
      deliveryStatus = delivery.status === "sent" ? "sent" : "failed"
      provider = delivery.provider
      providerMessageId = delivery.providerMessageId
      deliveryError = delivery.error
    } catch (error) {
      deliveryError = error instanceof Error ? error.message : "Unable to share files or send email."
    }

    const sentAt = deliveryStatus === "sent" ? new Date().toISOString() : null
    await access.db.update(projectRfqEmailDeliveries).set({
      status: deliveryStatus,
      provider,
      providerMessageId,
      error: deliveryError,
      sentAt,
    }).where(eq(projectRfqEmailDeliveries.id, deliveryId))
    if (deliveryStatus !== "sent") {
      return { success: false, error: deliveryError ?? "RFQ email was not sent. Check the email provider and Drive sharing settings." }
    }
    await access.db.update(projectOperations).set({
      status: "sent",
      sagePayloadJson: withPortalRfqRecipientEmail(rfq.sagePayloadJson, to),
      updatedAt: sentAt ?? new Date().toISOString(),
    }).where(and(
      eq(projectOperations.id, rfqId),
      eq(projectOperations.projectId, projectId),
      eq(projectOperations.updatedAt, rfq.updatedAt)
    ))
    revalidatePath(`/dashboard/projects/${projectId}/rfqs`)
    revalidatePath(`/preview/projects/${projectId}/sub-vendor/rfqs`)
    return { success: true, deliveryId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to send RFQ email." }
  }
}
