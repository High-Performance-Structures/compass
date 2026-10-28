"use server"

import { and, eq, lt, sql } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"

import { vendorTradeDocLinks, vendorTradeDocuments } from "@/db/schema-trade-docs"
import { recordActivityEvent, type ActivityActor } from "@/lib/activity-log"
import { getCloudflareContext } from "@/lib/db"
import { ensureVendorTradeDocsFolder } from "@/lib/trade-docs/drive"
import { buildInfoSheetPdf } from "@/lib/trade-docs/info-sheet-pdf"
import { notifyTradeDocLinkSender, recordLinkTradeDoc, sendTradeDocLink } from "@/lib/trade-docs/link-delivery"
import { tradeDocRequestSubject } from "@/lib/trade-docs/request-email"
import {
  TRADE_DOC_LINK_MAX_BYTES,
  TRADE_DOC_LINK_UPLOAD_LIMIT,
  certificateHolderLines,
  checkInfoSheetAnswers,
  infoSheetAgent,
  tradeDocFileName,
} from "@/lib/trade-docs/vendor-link"
import { linkInfoSheet, resolveTradeDocLink, tradeDocLinkBrand, type TradeDocLinkContext } from "@/lib/trade-docs/vendor-link-server"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

const UNAVAILABLE = "This link is no longer available. Reply to the email instead, or ask for a new link."
const DATE = /^\d{4}-\d{2}-\d{2}$/

async function context(token: string): Promise<{ readonly env: CloudflareEnv; readonly link: TradeDocLinkContext } | null> {
  const { env } = await getCloudflareContext()
  const link = await resolveTradeDocLink(env, token, new Date())
  return link ? { env, link } : null
}

async function requestOrigin(): Promise<string | undefined> {
  const requestHeaders = await headers()
  const origin = requestHeaders.get("origin")
  if (origin && /^https?:\/\/[^/]+$/.test(origin)) return origin
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
  return host ? `${requestHeaders.get("x-forwarded-proto") ?? "https"}://${host}` : undefined
}

/** Counts one more upload against the link's limit; false once it's used up. */
async function takeUpload(link: TradeDocLinkContext): Promise<boolean> {
  const taken = await link.db
    .update(vendorTradeDocLinks)
    .set({ uploadCount: sql`${vendorTradeDocLinks.uploadCount} + 1` })
    .where(and(eq(vendorTradeDocLinks.id, link.link.id), lt(vendorTradeDocLinks.uploadCount, TRADE_DOC_LINK_UPLOAD_LIMIT)))
    .returning({ id: vendorTradeDocLinks.id })
  return taken.length > 0
}

function linkActor(link: TradeDocLinkContext, name: string | null): ActivityActor {
  const who = name?.trim() ? `${name.trim()} (${link.link.recipientEmail})` : link.link.recipientEmail
  return { id: null, email: link.link.recipientEmail, displayName: who, firstName: null, lastName: null, role: link.audience === "agent" ? "insurance agent" : "vendor" }
}

function folderFor(link: TradeDocLinkContext, env: CloudflareEnv) {
  return ensureVendorTradeDocsFolder({
    db: link.db,
    environment: env,
    organizationId: link.organizationId,
    user: link.sender,
    vendor: link.vendor,
    rootFolderId: link.settings.driveFolderId,
  })
}

/** Starts a browser upload into the vendor's trade docs folder in Drive. */
export async function startTradeDocLinkUpload(
  token: string,
  input: { readonly docType: string; readonly kind: "document" | "waiver"; readonly fileName: string; readonly mimeType: string; readonly size: number },
): Promise<Result<{ readonly uploadUrl: string }>> {
  try {
    const found = await context(token)
    if (!found) return { success: false, error: UNAVAILABLE }
    const { env, link } = found
    const type = link.types.find((item) => item.id === input.docType)
    if (!type) return { success: false, error: "That document isn't on this request." }
    if (input.kind === "waiver" && !type.waiverLabel) return { success: false, error: `${type.label} has no alternative.` }
    if (!Number.isFinite(input.size) || input.size <= 0) return { success: false, error: "That file is empty." }
    if (input.size > TRADE_DOC_LINK_MAX_BYTES) return { success: false, error: "Files can be up to 25 MB. Reply to the email with larger files." }
    if (!(await takeUpload(link))) return { success: false, error: "This link has taken all the files it can. Reply to the email with the rest." }
    const drive = await folderFor(link, env)
    const label = input.kind === "waiver" ? type.waiverLabel ?? type.label : type.label
    const uploadUrl = await drive.client.initiateResumableUpload(drive.userEmail, {
      name: `${label} - ${input.fileName.trim().slice(0, 160) || "document"}`,
      mimeType: input.mimeType || "application/octet-stream",
      parentId: drive.folderId,
      driveId: drive.driveId ?? undefined,
      size: input.size,
      browserOrigin: await requestOrigin(),
    })
    return { success: true, data: { uploadUrl } }
  } catch (error) {
    console.error("[vendor-trade-doc-link] upload start failed", error)
    return { success: false, error: "The upload couldn't start. Try again, or reply to the email with the file." }
  }
}

/** Records a file the vendor just uploaded through their link. */
export async function recordTradeDocLinkUpload(
  token: string,
  input: { readonly docType: string; readonly kind: "document" | "waiver"; readonly driveFileId: string; readonly expiresOn: string | null; readonly name: string | null },
): Promise<Result<null>> {
  try {
    const found = await context(token)
    if (!found) return { success: false, error: UNAVAILABLE }
    const { env, link } = found
    const type = link.types.find((item) => item.id === input.docType)
    if (!type) return { success: false, error: "That document isn't on this request." }
    if (input.kind === "waiver" && !type.waiverLabel) return { success: false, error: `${type.label} has no alternative.` }
    const drive = await folderFor(link, env)
    const file = await drive.client.getFile(drive.userEmail, input.driveFileId).catch(() => null)
    // Only a file uploaded into this vendor's folder after the link was made.
    if (!file || !file.parents?.includes(drive.folderId) || !file.createdTime || file.createdTime < link.link.createdAt) {
      return { success: false, error: "That upload didn't arrive. Try again." }
    }
    const existing = await link.db
      .select({ id: vendorTradeDocuments.id })
      .from(vendorTradeDocuments)
      .where(and(eq(vendorTradeDocuments.vendorId, link.vendor.id), eq(vendorTradeDocuments.driveFileId, file.id)))
      .get()
    if (existing) return { success: true, data: null }
    const expiresOn = type.expires && input.expiresOn && DATE.test(input.expiresOn) ? input.expiresOn : null
    const actor = linkActor(link, input.name)
    const label = input.kind === "waiver" ? `${type.label} alternative` : type.label
    const documentId = await recordLinkTradeDoc({
      db: link.db,
      organizationId: link.organizationId,
      vendorId: link.vendor.id,
      docType: type.id,
      kind: input.kind,
      file: { id: file.id, name: file.name, webUrl: file.webViewLink ?? null },
      expiresOn,
      notes: null,
      receivedFrom: `${actor.displayName ?? link.link.recipientEmail} via docs link`,
    })
    const now = new Date().toISOString()
    await link.db.update(vendorTradeDocLinks).set({ lastSubmittedAt: now }).where(eq(vendorTradeDocLinks.id, link.link.id))
    await recordActivityEvent({
      db: link.db,
      organizationId: link.organizationId,
      actor,
      category: "file",
      action: "trade_doc.received_by_link",
      entityType: "vendor",
      entityId: link.vendor.id,
      summary: `${label} for ${link.vendor.name} came in through the docs link`,
      metadata: { documentId, docType: type.id, linkId: link.link.id },
    })
    await notifyTradeDocLinkSender({
      db: link.db,
      organizationId: link.organizationId,
      senderUserId: link.sender.id,
      vendor: link.vendor,
      eventType: "trade_docs.received",
      title: `${link.vendor.name}: ${label} received`,
      body: `${actor.displayName ?? link.link.recipientEmail} uploaded it through the docs link.${type.certificateChecks ? " Check the certificate before relying on it." : ""}`,
    })
    revalidatePath("/dashboard/contacts")
    return { success: true, data: null }
  } catch (error) {
    console.error("[vendor-trade-doc-link] record failed", error)
    return { success: false, error: "The file uploaded but didn't save. Try again, or reply to the email with it." }
  }
}

export type InfoSheetSubmission = {
  readonly answers: Readonly<Record<string, string>>
  readonly signerName: string
  readonly signerTitle: string
  readonly sendToAgent: boolean
}

/**
 * The vendor's signed info sheet. It's saved as a PDF in their Drive folder
 * (the answers aren't kept in Compass), and, when asked, the certificate
 * holder details go to their insurance agent with an upload link of their own.
 */
export async function submitTradeDocInfoSheet(
  token: string,
  input: InfoSheetSubmission,
): Promise<Result<{ readonly agentEmailed: string | null; readonly agentError: string | null }>> {
  try {
    const found = await context(token)
    if (!found) return { success: false, error: UNAVAILABLE }
    const { env, link } = found
    const sheet = linkInfoSheet(link)
    if (!sheet) return { success: false, error: "This link doesn't ask for the info sheet." }
    const signerName = input.signerName.trim().slice(0, 120)
    const signerTitle = input.signerTitle.trim().slice(0, 120)
    if (!signerName) return { success: false, error: "Type your name to sign." }
    const checked = checkInfoSheetAnswers(sheet.fields, input.answers)
    if (!checked.ok) return { success: false, error: checked.error }
    if (!(await takeUpload(link))) return { success: false, error: "This link has taken all it can. Reply to the email instead." }

    const brand = await tradeDocLinkBrand(link)
    const signedAt = new Date()
    const pdf = await buildInfoSheetPdf({
      title: sheet.type.label,
      companyName: brand.companyName,
      companyContactLines: brand.contactLines,
      vendorName: link.vendor.name,
      answers: checked.answers,
      certification: link.settings.infoSheet.certification,
      signerName,
      signerTitle,
      signedAt,
      linkRecipient: link.link.recipientEmail,
    })
    const drive = await folderFor(link, env)
    const file = await drive.client.uploadFile(drive.userEmail, {
      name: tradeDocFileName(link.vendor.name, sheet.type.label, signedAt.toISOString().slice(0, 10)),
      mimeType: "application/pdf",
      parentId: drive.folderId,
      driveId: drive.driveId ?? undefined,
      data: new Blob([pdf], { type: "application/pdf" }),
    })
    const actor = linkActor(link, signerName)
    const documentId = await recordLinkTradeDoc({
      db: link.db,
      organizationId: link.organizationId,
      vendorId: link.vendor.id,
      docType: sheet.type.id,
      kind: "document",
      file: { id: file.id, name: file.name, webUrl: file.webViewLink ?? null },
      expiresOn: null,
      notes: signerTitle ? `Signed online by ${signerName}, ${signerTitle}` : `Signed online by ${signerName}`,
      receivedFrom: `${actor.displayName ?? link.link.recipientEmail} via docs link`,
    })
    await link.db.update(vendorTradeDocLinks).set({ lastSubmittedAt: signedAt.toISOString() }).where(eq(vendorTradeDocLinks.id, link.link.id))
    await recordActivityEvent({
      db: link.db,
      organizationId: link.organizationId,
      actor,
      category: "file",
      action: "trade_doc.info_sheet_signed",
      entityType: "vendor",
      entityId: link.vendor.id,
      summary: `${signerName} filled in and signed the ${sheet.type.label.toLowerCase()} for ${link.vendor.name} online`,
      metadata: { documentId, docType: sheet.type.id, linkId: link.link.id },
    })

    let agentEmailed: string | null = null
    let agentError: string | null = null
    const agent = input.sendToAgent ? infoSheetAgent(checked.answers) : null
    if (agent) {
      // Only the certificates still on this request go to the agent.
      const certificates = link.types.filter((type) => type.certificateChecks)
      if (certificates.length > 0) {
        const sent = await sendTradeDocLink({
          env,
          db: link.db,
          organizationId: link.organizationId,
          vendor: link.vendor,
          audience: "agent",
          to: [agent.email],
          cc: [],
          subject: tradeDocRequestSubject({ audience: "agent", companyName: brand.companyName, vendorName: link.vendor.name }),
          message: agent.name ? `Hello ${agent.name},` : "",
          types: certificates.map((type) => ({ id: type.id, label: type.label })),
          days: link.settings.linkDays,
          parentLinkId: link.link.id,
          brand,
          certificateHolder: certificateHolderLines(link.settings.certificateHolder, brand),
          sender: { id: link.sender.id, name: link.sender.name, email: link.sender.googleEmail ?? link.sender.email },
          actor,
          requestedBy: `${signerName} at ${link.vendor.name}`,
        })
        if (sent.success) agentEmailed = agent.email
        else agentError = "We couldn't email your agent. Please send them the certificate holder details below."
      }
    }

    await notifyTradeDocLinkSender({
      db: link.db,
      organizationId: link.organizationId,
      senderUserId: link.sender.id,
      vendor: link.vendor,
      eventType: "trade_docs.received",
      title: `${link.vendor.name}: ${sheet.type.label} signed`,
      body: `${signerName} filled it in online.${agentEmailed ? ` Certificate holder details went to their agent, ${agentEmailed}.` : ""}`,
    })
    revalidatePath("/dashboard/contacts")
    return { success: true, data: { agentEmailed, agentError } }
  } catch (error) {
    console.error("[vendor-trade-doc-link] info sheet failed", error)
    return { success: false, error: "The info sheet didn't save. Try again, or reply to the email." }
  }
}
