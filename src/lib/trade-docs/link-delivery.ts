import "server-only"

import { requestVendorCertificateSyncs } from "@/lib/sage/vendor-certificates"
import { and, eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { users } from "@/db/schema"
import { recordActivityEvent, type ActivityActor } from "@/lib/activity-log"
import { sendTrackedEmail } from "@/lib/email/tracked-send"
import { vendorTradeDocsHref } from "@/lib/email/tracked-record-email"
import { createSystemNotificationEvent, notificationLink } from "@/lib/notifications/create-event"
import { hashQuoteLinkToken, newQuoteLinkToken } from "@/lib/rfqs/quote-links"
import { tradeDocRequestHtml, tradeDocRequestText } from "@/lib/trade-docs/request-email"
import { TRADE_DOC_LINK_PATH, tradeDocLinkExpiresAt, type TradeDocLinkAudience } from "@/lib/trade-docs/vendor-link"
import {
  insertTradeDocLink,
  insertTradeDocumentStatement,
  supersedeCurrentTradeDocumentStatement,
  updateTradeDocLink,
} from "@/lib/domain/documents/store"

type Db = ReturnType<typeof getDb>

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
}

/**
 * Creates a docs link and emails it. The link only works once the email has
 * gone out; a failed send turns it off again. Replies come back to the
 * vendor's trade docs, and the send is logged in Activity.
 */
export async function sendTradeDocLink(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
  readonly vendor: { readonly id: string; readonly name: string }
  readonly audience: TradeDocLinkAudience
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly subject: string
  readonly message: string
  readonly types: readonly { readonly id: string; readonly label: string }[]
  readonly days: number
  readonly parentLinkId: string | null
  readonly brand: { readonly companyName: string; readonly contactLines: readonly string[] }
  readonly certificateHolder: readonly string[]
  /** The staff member the email is from (and Drive acts as). */
  readonly sender: { readonly id: string; readonly name: string; readonly email: string }
  /** Shown in Activity: the staff member, or the vendor for an agent request. */
  readonly actor: ActivityActor
  readonly requestedBy: string | null
}): Promise<Result<{ readonly linkId: string; readonly expiresAt: string }>> {
  const recipient = input.to[0]
  if (!recipient) return { success: false, error: "Choose who to send it to." }
  const token = newQuoteLinkToken()
  const linkId = crypto.randomUUID()
  const now = new Date()
  const expiresAt = tradeDocLinkExpiresAt(now, input.days)
  await insertTradeDocLink(input.db, {
    id: linkId,
    organizationId: input.organizationId,
    vendorId: input.vendor.id,
    tokenHash: await hashQuoteLinkToken(token),
    audience: input.audience,
    recipientEmail: recipient,
    requestedJson: JSON.stringify(input.types.map((type) => type.id)),
    parentLinkId: input.parentLinkId,
    expiresAt,
    createdBy: input.sender.id,
    createdByName: input.sender.name.slice(0, 200),
    createdAt: now.toISOString(),
  })
  const emailInput = {
    audience: input.audience,
    companyName: input.brand.companyName,
    companyContactLines: input.brand.contactLines,
    vendorName: input.vendor.name,
    message: input.message,
    items: input.types.map((type) => type.label),
    certificateHolder: input.certificateHolder,
    linkUrl: notificationLink(input.env, `${TRADE_DOC_LINK_PATH}/${token}`),
    expiresOn: longDate(expiresAt),
    senderName: input.sender.name,
    requestedBy: input.requestedBy,
  }
  let error: string | null = null
  try {
    const delivery = await sendTrackedEmail({
      env: input.env,
      db: input.db,
      organizationId: input.organizationId,
      projectId: null,
      kind: "trade_docs",
      recordId: input.vendor.id,
      recordLabel: input.vendor.name,
      createdBy: input.sender.id,
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      text: tradeDocRequestText(emailInput),
      html: tradeDocRequestHtml(emailInput),
      replyName: `${input.sender.name} - ${input.vendor.name} docs`,
      alsoReplyTo: [input.sender.email],
    })
    if (delivery.status !== "sent") error = delivery.error ?? "The email wasn't sent."
  } catch (sendError) {
    error = sendError instanceof Error ? sendError.message : "The email wasn't sent."
  }
  if (error) {
    // The email never went out, so its link shouldn't work either.
    await updateTradeDocLink(input.db, linkId, { revokedAt: new Date().toISOString() })
    return { success: false, error }
  }
  const recipients = [...input.to, ...input.cc].join(", ")
  await recordActivityEvent({
    db: input.db,
    organizationId: input.organizationId,
    actor: input.actor,
    category: "email",
    action: input.audience === "agent" ? "trade_docs_agent_emailed" : "trade_docs_emailed",
    entityType: "vendor",
    entityId: input.vendor.id,
    summary:
      input.audience === "agent"
        ? `Certificate holder details for ${input.vendor.name} sent to their insurance agent (${recipients}).`
        : `Requested ${input.types.length} trade doc${input.types.length === 1 ? "" : "s"} from ${input.vendor.name} (${recipients}).`,
    metadata: { linkId, to: input.to.join(", "), cc: input.cc.join(", "), docTypes: input.types.map((type) => type.id).join(", "), expiresAt },
  })
  return { success: true, data: { linkId, expiresAt } }
}

/** Tells the staff member who sent the link that something came back. */
export async function notifyTradeDocLinkSender(input: {
  readonly db: Db
  readonly organizationId: string
  readonly senderUserId: string
  readonly vendor: { readonly id: string; readonly name: string }
  readonly title: string
  readonly body: string
  readonly eventType: string
}): Promise<void> {
  try {
    const sender = await input.db
      .select({ id: users.id, email: users.email, googleEmail: users.googleEmail })
      .from(users)
      .where(and(eq(users.id, input.senderUserId), eq(users.isActive, true)))
      .get()
    if (!sender) return
    await createSystemNotificationEvent({
      organizationId: input.organizationId,
      projectId: null,
      eventType: input.eventType,
      sourceType: "vendor",
      sourceId: input.vendor.id,
      title: input.title,
      body: input.body,
      href: vendorTradeDocsHref(input.vendor.id),
      priority: "normal",
      audience: "internal",
      recipients: [{ userId: sender.id, email: sender.googleEmail?.trim() || sender.email }],
      delivery: { inApp: true, email: true, push: true },
    })
  } catch (error) {
    console.error("[trade-docs] notification failed", error)
  }
}

/**
 * Records a document that came in through a docs link. Like a staff upload,
 * it becomes the vendor's current document of that type and the older one
 * moves to the history.
 */
export async function recordLinkTradeDoc(input: {
  readonly db: Db
  readonly organizationId: string
  readonly vendorId: string
  readonly docType: string
  readonly kind: "document" | "waiver"
  readonly file: { readonly id: string; readonly name: string; readonly webUrl: string | null }
  readonly expiresOn: string | null
  readonly notes: string | null
  readonly receivedFrom: string
}): Promise<string> {
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  await input.db.batch([
    supersedeCurrentTradeDocumentStatement(input.db, { vendorId: input.vendorId, docType: input.docType, now }),
    insertTradeDocumentStatement(input.db, {
      id,
      organizationId: input.organizationId,
      vendorId: input.vendorId,
      docType: input.docType,
      kind: input.kind,
      driveFileId: input.file.id,
      fileName: input.file.name,
      webUrl: input.file.webUrl,
      effectiveOn: null,
      expiresOn: input.expiresOn,
      checksJson: null,
      notes: input.notes,
      source: "vendor_link",
      createdBy: null,
      createdByName: input.receivedFrom.slice(0, 200),
      createdAt: now,
      updatedAt: now,
    }),
  ])
  await requestVendorCertificateSyncs(input.db, input.organizationId, [input.vendorId])
  return id
}
