import "server-only"

import { and, eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { emailReplyThreads, users, vendors } from "@/db/schema"
import { recordActivityEvent } from "@/lib/activity-log"
import { stripHtml, type InboundCandidate } from "@/lib/email/gmail-message-parser"
import { emailReplyPreview } from "@/lib/email/tracked-record-email"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { ensureVendorTradeDocsFolder } from "@/lib/trade-docs/drive"
import { notifyTradeDocLinkSender } from "@/lib/trade-docs/link-delivery"
import { TRADE_DOC_LINK_MAX_BYTES, TRADE_DOC_REPLY_ACTION } from "@/lib/trade-docs/vendor-link"

type Db = ReturnType<typeof getDb>

/** Small images are usually email signatures and logos, not documents. */
const MIN_IMAGE_BYTES = 40 * 1024

export function isLikelyDocumentAttachment(attachment: { readonly mimeType: string; readonly size: number | null; readonly data: Uint8Array | null }): boolean {
  const size = attachment.size ?? attachment.data?.byteLength ?? 0
  if (size <= 0 || size > TRADE_DOC_LINK_MAX_BYTES) return false
  return !attachment.mimeType.startsWith("image/") || size >= MIN_IMAGE_BYTES
}

/**
 * A reply to a trade docs request. Vendor emails have no job, so instead of
 * posting to a project channel the attachments go into the vendor's trade
 * docs folder, the reply is logged in Activity (where the vendor's trade docs
 * list it), and whoever sent the request is told. Staff then record each
 * file as the right document.
 */
export async function postTradeDocReply(input: {
  readonly env: unknown
  readonly db: Db
  readonly replyThread: typeof emailReplyThreads.$inferSelect
  readonly candidate: InboundCandidate
}): Promise<"posted" | "needs_review"> {
  const { db, replyThread, candidate } = input
  const vendor = await db
    .select({ id: vendors.id, name: vendors.name, tradeDocsFolderId: vendors.tradeDocsFolderId })
    .from(vendors)
    .where(and(eq(vendors.id, replyThread.sourceId), eq(vendors.organizationId, replyThread.organizationId)))
    .get()
  if (!vendor) return "needs_review"
  const sender = replyThread.createdBy
    ? await db
        .select({ id: users.id, email: users.email, googleEmail: users.googleEmail })
        .from(users)
        .where(and(eq(users.id, replyThread.createdBy), eq(users.isActive, true)))
        .get()
    : undefined

  const saved: string[] = []
  let saveError: string | null = null
  const attachments = candidate.attachments.filter(isLikelyDocumentAttachment)
  if (attachments.length > 0 && sender) {
    try {
      const settings = await readFeatureSettings(db, replyThread.organizationId, "trade-docs")
      const drive = await ensureVendorTradeDocsFolder({
        db,
        environment: input.env,
        organizationId: replyThread.organizationId,
        user: sender,
        vendor,
        rootFolderId: settings.driveFolderId,
      })
      const day = candidate.receivedAt.slice(0, 10)
      for (const attachment of attachments) {
        if (!attachment.data) continue
        const file = await drive.client.uploadFile(drive.userEmail, {
          name: `Emailed ${day} - ${attachment.fileName}`.slice(0, 200),
          mimeType: attachment.mimeType || "application/octet-stream",
          parentId: drive.folderId,
          driveId: drive.driveId ?? undefined,
          data: new Blob([new Uint8Array(attachment.data)], { type: attachment.mimeType || "application/octet-stream" }),
        })
        saved.push(file.name)
      }
    } catch (error) {
      console.error("[trade-docs] saving reply attachments failed", error)
      saveError = error instanceof Error ? error.message : "Saving attachments failed"
    }
  }

  const from = candidate.fromName?.trim() || candidate.fromAddress
  const text = candidate.textBody?.trim() || (candidate.htmlBody ? stripHtml(candidate.htmlBody).trim() : "") || candidate.snippet?.trim() || ""
  const preview = emailReplyPreview(text)
  const files = saved.length > 0 ? ` with ${saved.length} file${saved.length === 1 ? "" : "s"} saved to their Drive folder` : ""
  await recordActivityEvent({
    db,
    id: `tracked-reply-${candidate.gmailMessageId}`,
    organizationId: replyThread.organizationId,
    actor: { id: null, email: candidate.fromAddress, displayName: candidate.fromName, firstName: null, lastName: null, role: "email" },
    category: "email",
    action: TRADE_DOC_REPLY_ACTION,
    entityType: "vendor",
    entityId: vendor.id,
    summary: `${from} replied to the docs request for ${vendor.name}${files}${preview ? `: ${preview}` : "."}`,
    metadata: {
      from: candidate.fromAddress,
      attachments: candidate.attachments.length,
      savedFiles: saved.join("\n"),
      saveError,
    },
    createdAt: candidate.receivedAt,
  })
  if (replyThread.createdBy) {
    await notifyTradeDocLinkSender({
      db,
      organizationId: replyThread.organizationId,
      senderUserId: replyThread.createdBy,
      vendor,
      eventType: "trade_docs.email_reply",
      title: `${vendor.name}: reply to your docs request`,
      body: `${from} replied${files}.${saveError ? " Some attachments couldn't be saved; open the email to get them." : ""}${preview ? ` ${preview}` : ""}`,
    })
  }
  return "posted"
}
