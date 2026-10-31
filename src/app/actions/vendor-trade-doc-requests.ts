"use server"

import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { activityEvents, vendorContacts, vendors } from "@/db/schema"
import { vendorTradeDocLinks, vendorTradeDocuments } from "@/db/schema-trade-docs"
import { recordActivityEvent } from "@/lib/activity-log"
import { readDepartmentProfiles } from "@/lib/department-profiles-server"
import type { EmailRecipientOption } from "@/lib/email/recipient-options"
import { isValidRecipientEmail, normalizeRecipientEmail } from "@/lib/email/recipient-options"
import { brandForDepartment } from "@/lib/project-branding"
import { quoteLinkIsLive } from "@/lib/rfqs/quote-links"
import { tradeDocAccess } from "@/lib/trade-docs/access"
import { ensureVendorTradeDocsFolder } from "@/lib/trade-docs/drive"
import { sendTradeDocLink } from "@/lib/trade-docs/link-delivery"
import { toTradeDocOnFile } from "@/lib/trade-docs/records"
import { tradeDocRequestSubject } from "@/lib/trade-docs/request-email"
import { summarizeTradeDocs } from "@/lib/trade-docs/status"
import { TRADE_DOC_REPLY_ACTION, certificateHolderLines } from "@/lib/trade-docs/vendor-link"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

type TradeDocLinkSummary = {
  readonly id: string
  readonly audience: "vendor" | "agent"
  readonly recipientEmail: string
  readonly createdAt: string
  readonly createdByName: string
  readonly expiresAt: string
  readonly lastOpenedAt: string | null
  readonly lastSubmittedAt: string | null
  readonly live: boolean
}

type TradeDocReply = {
  readonly id: string
  readonly from: string
  readonly receivedAt: string
  readonly summary: string
  readonly files: readonly string[]
}

export type TradeDocRequestPanel = {
  readonly recipients: readonly EmailRecipientOption[]
  readonly defaultTo: readonly string[]
  readonly types: readonly { readonly id: string; readonly label: string; readonly owed: boolean }[]
  readonly subject: string
  readonly note: string
  readonly linkDays: number
  readonly links: readonly TradeDocLinkSummary[]
  readonly replies: readonly TradeDocReply[]
}

function replyFiles(metadata: string | null): readonly string[] {
  if (!metadata) return []
  try {
    const parsed: unknown = JSON.parse(metadata)
    if (typeof parsed !== "object" || parsed === null || !("savedFiles" in parsed) || typeof parsed.savedFiles !== "string") return []
    return parsed.savedFiles.split("\n").filter(Boolean)
  } catch {
    return []
  }
}

/** What the "Request docs" panel needs: who to send to, what's owed, past links and replies. */
export async function getTradeDocRequestPanel(vendorId: string): Promise<Result<TradeDocRequestPanel>> {
  try {
    const access = await tradeDocAccess(false)
    const vendor = await access.db
      .select({ id: vendors.id, name: vendors.name, category: vendors.category, email: vendors.email, primaryEmail: vendors.primaryEmail })
      .from(vendors)
      .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, access.organizationId)))
      .get()
    if (!vendor) return { success: false, error: "Vendor not found." }
    const [contacts, docRows, links, replies, profiles] = await Promise.all([
      access.db
        .select({ id: vendorContacts.id, name: vendorContacts.name, email: vendorContacts.email, isPrimary: vendorContacts.isPrimary })
        .from(vendorContacts)
        .where(and(eq(vendorContacts.vendorId, vendor.id), eq(vendorContacts.active, true))),
      access.db
        .select()
        .from(vendorTradeDocuments)
        .where(and(eq(vendorTradeDocuments.vendorId, vendor.id), isNull(vendorTradeDocuments.supersededAt))),
      access.db
        .select()
        .from(vendorTradeDocLinks)
        .where(eq(vendorTradeDocLinks.vendorId, vendor.id))
        .orderBy(desc(vendorTradeDocLinks.createdAt))
        .limit(20),
      access.db
        .select({ id: activityEvents.id, actorName: activityEvents.actorName, createdAt: activityEvents.createdAt, summary: activityEvents.summary, metadata: activityEvents.metadata })
        .from(activityEvents)
        .where(and(
          eq(activityEvents.organizationId, access.organizationId),
          eq(activityEvents.entityType, "vendor"),
          eq(activityEvents.entityId, vendor.id),
          eq(activityEvents.action, TRADE_DOC_REPLY_ACTION),
        ))
        .orderBy(desc(activityEvents.createdAt))
        .limit(20),
      readDepartmentProfiles(access.db, access.organizationId),
    ])

    const recipients = new Map<string, EmailRecipientOption>()
    const add = (id: string, email: string | null, displayName: string, recommended: boolean): void => {
      const normalized = email ? normalizeRecipientEmail(email) : ""
      if (!normalized || !isValidRecipientEmail(normalized) || recipients.has(normalized)) return
      recipients.set(normalized, { id, email: normalized, displayName, companyName: vendor.name, category: "vendor", recommended })
    }
    for (const contact of [...contacts].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))) {
      add(`vendor-contact-${contact.id}`, contact.email, contact.name, contact.isPrimary)
    }
    add(`vendor-${vendor.id}-primary`, vendor.primaryEmail, vendor.name, recipients.size === 0)
    add(`vendor-${vendor.id}`, vendor.email, vendor.name, recipients.size === 0)
    const options = [...recipients.values()]
    const first = options.find((option) => option.recommended) ?? options[0]

    const summary = summarizeTradeDocs({
      docTypes: access.settings.docTypes,
      vendorCategory: vendor.category,
      docs: docRows.map(toTradeDocOnFile),
      today: new Date().toISOString().slice(0, 10),
    })
    const owed = new Set(summary.lines.filter((line) => line.required && line.state !== "on_file" && line.state !== "waived").map((line) => line.type.id))
    const now = new Date()
    const brand = brandForDepartment(access.settings.brandDepartment, profiles)
    return {
      success: true,
      data: {
        recipients: options,
        defaultTo: first ? [first.email] : [],
        types: access.settings.docTypes.filter((type) => type.active).map((type) => ({ id: type.id, label: type.label, owed: owed.has(type.id) })),
        subject: tradeDocRequestSubject({ audience: "vendor", companyName: brand.companyName, vendorName: vendor.name }),
        note: access.settings.requestNote,
        linkDays: access.settings.linkDays,
        links: links.map((link) => ({
          id: link.id,
          audience: link.audience === "agent" ? "agent" : "vendor",
          recipientEmail: link.recipientEmail,
          createdAt: link.createdAt,
          createdByName: link.createdByName,
          expiresAt: link.expiresAt,
          lastOpenedAt: link.lastOpenedAt,
          lastSubmittedAt: link.lastSubmittedAt,
          live: quoteLinkIsLive(link, now),
        })),
        replies: replies.map((reply) => ({
          id: reply.id,
          from: reply.actorName,
          receivedAt: reply.createdAt,
          summary: reply.summary,
          files: replyFiles(reply.metadata),
        })),
      },
    }
  } catch (error) {
    return { success: false, error: message(error, "Could not load the request.") }
  }
}

export type SendTradeDocRequestInput = {
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly subject: string
  readonly note: string
  readonly docTypes: readonly string[]
}

/** Emails the vendor a secure link to send the chosen documents. */
export async function sendTradeDocRequest(vendorId: string, input: SendTradeDocRequestInput): Promise<Result<{ readonly expiresAt: string }>> {
  try {
    const access = await tradeDocAccess(true)
    const vendor = await access.db
      .select({ id: vendors.id, name: vendors.name })
      .from(vendors)
      .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, access.organizationId)))
      .get()
    if (!vendor) return { success: false, error: "Vendor not found." }
    const clean = (emails: readonly string[]): readonly string[] =>
      [...new Set(emails.map(normalizeRecipientEmail))].filter((email) => isValidRecipientEmail(email)).slice(0, 10)
    const to = clean(input.to)
    const cc = clean(input.cc).filter((email) => !to.includes(email))
    if (to.length === 0) return { success: false, error: "Choose who to send it to." }
    const chosen = new Set(input.docTypes)
    const types = access.settings.docTypes.filter((type) => type.active && chosen.has(type.id))
    if (types.length === 0) return { success: false, error: "Choose at least one document." }
    const subject = input.subject.trim().slice(0, 200)
    if (!subject) return { success: false, error: "Enter a subject." }
    const profiles = await readDepartmentProfiles(access.db, access.organizationId)
    const brand = brandForDepartment(access.settings.brandDepartment, profiles)
    const senderName = access.user.displayName ?? access.user.email
    const sent = await sendTradeDocLink({
      env: access.env,
      db: access.db,
      organizationId: access.organizationId,
      vendor,
      audience: "vendor",
      to,
      cc,
      subject,
      message: input.note.trim().slice(0, 3000),
      types: types.map((type) => ({ id: type.id, label: type.label })),
      days: access.settings.linkDays,
      parentLinkId: null,
      brand,
      certificateHolder: certificateHolderLines(access.settings.certificateHolder, brand),
      sender: { id: access.user.id, name: senderName, email: access.user.email },
      actor: access.user,
      requestedBy: null,
    })
    if (!sent.success) return sent
    revalidatePath("/dashboard/contacts")
    return { success: true, data: { expiresAt: sent.data.expiresAt } }
  } catch (error) {
    return { success: false, error: message(error, "Could not send the request.") }
  }
}

/** Turns a docs link off right away. Documents already received stay. */
export async function turnOffTradeDocLink(linkId: string): Promise<Result<null>> {
  try {
    const access = await tradeDocAccess(true)
    const link = await access.db
      .select({ id: vendorTradeDocLinks.id, vendorId: vendorTradeDocLinks.vendorId, recipientEmail: vendorTradeDocLinks.recipientEmail })
      .from(vendorTradeDocLinks)
      .where(and(eq(vendorTradeDocLinks.id, linkId), eq(vendorTradeDocLinks.organizationId, access.organizationId), isNull(vendorTradeDocLinks.revokedAt)))
      .get()
    if (!link) return { success: false, error: "That link is already off." }
    await access.db
      .update(vendorTradeDocLinks)
      .set({ revokedAt: new Date().toISOString(), revokedBy: access.user.id })
      .where(eq(vendorTradeDocLinks.id, link.id))
    await recordActivityEvent({
      db: access.db,
      organizationId: access.organizationId,
      actor: access.user,
      category: "access",
      action: "trade_docs_link_turned_off",
      entityType: "vendor",
      entityId: link.vendorId,
      summary: `Turned off the docs link sent to ${link.recipientEmail}`,
      metadata: { linkId: link.id },
    })
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: message(error, "Could not turn off the link.") }
  }
}

export type VendorFolderFile = { readonly id: string; readonly name: string; readonly modifiedTime: string | null }

/** Files in the vendor's Drive folder that aren't recorded yet, e.g. attachments saved from email replies. */
export async function listUnrecordedVendorFolderFiles(vendorId: string): Promise<Result<readonly VendorFolderFile[]>> {
  try {
    const access = await tradeDocAccess(true)
    const vendor = await access.db
      .select({ id: vendors.id, name: vendors.name, tradeDocsFolderId: vendors.tradeDocsFolderId })
      .from(vendors)
      .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, access.organizationId)))
      .get()
    if (!vendor) return { success: false, error: "Vendor not found." }
    if (!vendor.tradeDocsFolderId) return { success: true, data: [] }
    const drive = await ensureVendorTradeDocsFolder({
      db: access.db,
      environment: access.env,
      organizationId: access.organizationId,
      user: access.user,
      vendor,
      rootFolderId: access.settings.driveFolderId,
    })
    const page = await drive.client.listFiles(drive.userEmail, { folderId: drive.folderId, pageSize: 200, driveId: drive.driveId ?? undefined })
    const files = page.files.filter((file) => file.mimeType !== "application/vnd.google-apps.folder" && !file.trashed)
    if (files.length === 0) return { success: true, data: [] }
    const recorded = await access.db
      .select({ driveFileId: vendorTradeDocuments.driveFileId })
      .from(vendorTradeDocuments)
      .where(and(eq(vendorTradeDocuments.vendorId, vendor.id), inArray(vendorTradeDocuments.driveFileId, files.map((file) => file.id))))
    const taken = new Set(recorded.map((row) => row.driveFileId))
    return {
      success: true,
      data: files
        .filter((file) => !taken.has(file.id))
        .map((file) => ({ id: file.id, name: file.name, modifiedTime: file.modifiedTime ?? null }))
        .sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? "")),
    }
  } catch (error) {
    return { success: false, error: message(error, "Could not read the vendor's Drive folder.") }
  }
}
