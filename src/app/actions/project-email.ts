"use server"

import { and, eq, isNull, or, sql, type AnyColumn } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { customerContacts, customers, emailReplyThreads, internalContacts, projectContacts, vendors, vendorContacts } from "@/db/schema"
import { correspondence, correspondenceAttachments, correspondenceMessages, correspondenceOutbox, correspondenceParticipants, correspondenceRecipients } from "@/db/schema-correspondence"
import { projectEmailCampaigns, projectEmailRecipients } from "@/db/schema-project-email"
import { correspondenceContacts, correspondenceContext } from "@/lib/correspondence/access"
import type { CorrespondenceContext } from "@/lib/correspondence/access"
import { validateProjectEmailAttachments, emailAttachmentGuard, loadProjectEmailAttachments } from "@/lib/correspondence/email-attachments"
import { releaseRejectedComposition, savedDraftGuard, retireSentComposition } from "@/lib/correspondence/saved-drafts"
import { correspondenceHash } from "@/lib/correspondence/send"
import { clearCorrespondenceWriteGuard, correspondenceWriteGuard } from "@/lib/correspondence/write-guard"
import { sendCompassEmail } from "@/lib/email/compass-email"
import { validateProjectEmailAudience, type ProjectEmailAudience } from "@/lib/email/project-email-validation"
import { createReplyToken, trackedReplyAddress } from "@/lib/email/reply-tracking"
import { projectInboundEmailAddress } from "@/lib/email/project-address"
import { isValidRecipientEmail, normalizeRecipientEmail, type EmailRecipientCategory, type EmailRecipientOption } from "@/lib/email/recipient-options"

type RecipientScope = "project" | "directory"
type SearchResult = { readonly success: true; readonly data: readonly EmailRecipientOption[] } | { readonly success: false; readonly error: string }
type SendResult = { readonly success: true; readonly conversationId: string; readonly status: "sent" | "failed" | "unknown"; readonly error: string | null } | { readonly success: false; readonly error: string; readonly draftVersion?: number }
type Campaign = typeof projectEmailCampaigns.$inferSelect

function safeFailure(error: unknown, fallback = "Project email is temporarily unavailable. Check project messages before trying again."): { readonly success: false; readonly error: string } {
  if (error instanceof Error && /^(Only project staff|Project not found|Project messaging is not enabled|Demo mode is read-only)/.test(error.message)) return { success: false, error: error.message }
  return { success: false, error: fallback }
}

function searchOption(id: string, email: string | null, displayName: string, companyName: string | null, category: EmailRecipientCategory): EmailRecipientOption | null {
  const normalized = normalizeRecipientEmail(email ?? "")
  return isValidRecipientEmail(normalized) ? { id, email: normalized, displayName, companyName, category, recommended: false } : null
}

export async function searchProjectEmailRecipients(projectId: string, scope: RecipientScope, query: string): Promise<SearchResult> {
  try {
    const ctx = await correspondenceContext(projectId)
    if (ctx.workspace !== "staff") throw new Error("Only project staff can email the directory.")
    if (scope !== "project" && scope !== "directory") return { success: false, error: "Choose a contact list." }
    const term = query.trim().slice(0, 100)
    if (scope === "directory" && term.length < 2) return { success: true, data: [] }
    const contains = (column: AnyColumn) => sql`instr(lower(${column}), lower(${term})) > 0`
    const options: EmailRecipientOption[] = []
    if (scope === "project") {
      const rows = await ctx.db.select({ id: projectContacts.id, type: projectContacts.contactType, name: projectContacts.displayName, company: projectContacts.companyName, email: projectContacts.email })
        .from(projectContacts).where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.active, true), term ? or(contains(projectContacts.displayName), contains(projectContacts.companyName), contains(projectContacts.email)) : undefined)).limit(60)
      for (const row of rows) {
        const category: EmailRecipientCategory = row.type === "internal" ? "internal" : row.type === "owner" ? "client" : "vendor"
        const option = searchOption(row.id, row.email, row.name, row.company, category)
        if (option) options.push(option)
      }
    } else {
      const [clients, suppliers, staff] = await Promise.all([
        ctx.db.select({ id: customerContacts.id, name: customerContacts.name, email: customerContacts.email, company: customers.name })
          .from(customerContacts).innerJoin(customers, eq(customers.id, customerContacts.customerId))
          .where(and(eq(customers.organizationId, ctx.organizationId), isNull(customers.mergedIntoCustomerId), eq(customerContacts.active, true), or(contains(customerContacts.name), contains(customerContacts.email), contains(customers.name)))).limit(30),
        ctx.db.select({ id: vendorContacts.id, name: vendorContacts.name, email: vendorContacts.email, company: vendors.name })
          .from(vendorContacts).innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
          .where(and(eq(vendors.organizationId, ctx.organizationId), isNull(vendors.mergedIntoVendorId), eq(vendorContacts.active, true), or(contains(vendorContacts.name), contains(vendorContacts.email), contains(vendors.name)))).limit(30),
        ctx.db.select({ id: internalContacts.id, name: internalContacts.name, email: internalContacts.email })
          .from(internalContacts).where(and(eq(internalContacts.organizationId, ctx.organizationId), eq(internalContacts.active, true), or(contains(internalContacts.name), contains(internalContacts.email)))).limit(30),
      ])
      for (const row of clients) { const option = searchOption(row.id, row.email, row.name, row.company, "client"); if (option) options.push(option) }
      for (const row of suppliers) { const option = searchOption(row.id, row.email, row.name, row.company, "vendor"); if (option) options.push(option) }
      for (const row of staff) { const option = searchOption(row.id, row.email, row.name, null, "internal"); if (option) options.push(option) }
    }
    return { success: true, data: [...new Map(options.map((option) => [option.email, option])).values()].slice(0, 50) }
  } catch (error) { return safeFailure(error, "Contact search is temporarily unavailable.") }
}

export type ProjectEmailInput = ProjectEmailAudience & {
  readonly draft?: { readonly id: string; readonly version: number }
  readonly projectId: string
  readonly subject: string
  readonly body: string
  readonly requestId: string
  readonly attachmentIds?: readonly string[]
}

async function dispatchProjectEmailCampaign(ctx: CorrespondenceContext, campaign: Campaign, subject: string, body: string, audience: ProjectEmailAudience): Promise<SendResult> {
  const conversationId = campaign.conversationId
  if (campaign.status === "sent") return { success: true, conversationId, status: "sent", error: null }
  if (campaign.status === "dispatching" || campaign.status === "unknown") return { success: true, conversationId, status: "unknown", error: "Delivery outcome needs review; do not resend this message." }
  let attachments: Awaited<ReturnType<typeof loadProjectEmailAttachments>>
  try { attachments = await loadProjectEmailAttachments(ctx, campaign.messageId) } catch {
    await ctx.db.update(projectEmailCampaigns).set({ status: "failed", error: "An email attachment could not be loaded.", updatedAt: new Date().toISOString() }).where(and(eq(projectEmailCampaigns.id, campaign.id), or(eq(projectEmailCampaigns.status, "queued"), eq(projectEmailCampaigns.status, "failed"))))
    return { success: true, conversationId, status: "failed", error: "An email attachment could not be loaded. Check the files before retrying." }
  }
  const claimed = await ctx.db.update(projectEmailCampaigns).set({ status: "dispatching", updatedAt: new Date().toISOString() })
    .where(and(eq(projectEmailCampaigns.id, campaign.id), or(eq(projectEmailCampaigns.status, "queued"), eq(projectEmailCampaigns.status, "failed"))))
    .returning({ id: projectEmailCampaigns.id })
  if (!claimed[0]) return { success: true, conversationId, status: "unknown", error: "Another send is in progress; check the message before retrying." }
  const thread = await ctx.db.select().from(emailReplyThreads).where(eq(emailReplyThreads.id, campaign.replyThreadId)).get()
  if (!thread || thread.status !== "active" || thread.projectId !== ctx.projectId || thread.organizationId !== ctx.organizationId) return { success: true, conversationId, status: "unknown", error: "The reply route is unavailable; delivery needs review." }
  let delivery: Awaited<ReturnType<typeof sendCompassEmail>>
  try {
    const projectAddress = projectInboundEmailAddress(ctx.projectId)
    // Change only the display name: the saved tracking address keeps replies
    // attached to this conversation, including retries of older messages.
    const replyName = `${ctx.projectName} - Project Messages`.replace(/[\r\n"\\]/g, " ")
    const replyTo = thread.replyToAddress.replace(/^Compass (?=<)/, () => `"${replyName}" `)
    const text = `Project: ${ctx.projectName}\nFrom: ${ctx.user.displayName ?? ctx.user.email}\n\n${body}\n\nReply to this email to respond in this project conversation.\nProject email: ${projectAddress}\nFor a new conversation, email the project address with [MESSAGE] at the start of the subject.`
    delivery = await sendCompassEmail({ env: ctx.env, db: ctx.db, organizationId: ctx.organizationId, to: audience.to, cc: audience.cc, bcc: audience.bcc, replyTo, headers: [{ name: "X-Compass-Reply-Token", value: thread.token }], subject, text, attachments })
  } catch {
    delivery = { status: "unknown", provider: "unknown", providerMessageId: null, error: "Email provider outcome is unknown." }
  }
  const status = delivery.status === "sent" ? "sent" : delivery.status === "failed" || delivery.status === "pending_provider" ? "failed" : "unknown"
  await ctx.db.update(projectEmailCampaigns).set({ status, provider: delivery.provider, providerMessageId: delivery.providerMessageId, error: delivery.error, updatedAt: new Date().toISOString() }).where(eq(projectEmailCampaigns.id, campaign.id))
  revalidatePath(`/dashboard/projects/${ctx.projectId}/messages`)
  return { success: true, conversationId, status, error: status === "sent" ? null : status === "failed" ? "Email delivery failed. Review the message before retrying." : "Delivery outcome needs review; do not resend this message." }
}

export async function sendProjectEmail(input: ProjectEmailInput): Promise<SendResult> {
  const result = await sendProjectEmailRequest(input)
  if (result.success || !input.draft) return result
  try {
    const ctx = await correspondenceContext(input.projectId)
    if (ctx.workspace !== "staff") return result
    const campaignId = `project-email-${await correspondenceHash(JSON.stringify([ctx.organizationId, ctx.user.id, input.requestId]))}`
    const draftVersion = await releaseRejectedComposition(ctx, input.draft, input.requestId, campaignId, "email")
    return draftVersion === null ? result : { ...result, draftVersion }
  } catch { return result }
}

async function sendProjectEmailRequest(input: ProjectEmailInput): Promise<SendResult> {
  let savedConversationId: string | null = null
  try {
    const ctx = await correspondenceContext(input.projectId)
    if (ctx.workspace !== "staff") throw new Error("Only project staff can send project email.")
    const audience = validateProjectEmailAudience(input)
    if (!audience.success) return audience
    const subject = input.subject.trim()
    if (!subject || subject.length > 200 || /[\r\n]/.test(subject) || !input.body.trim() || input.body.length > 50000) return { success: false, error: "Enter a subject and message of at most 50,000 characters." }
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(input.requestId)) return { success: false, error: "Start a new email request and try again." }
    const campaignId = `project-email-${await correspondenceHash(JSON.stringify([ctx.organizationId, ctx.user.id, input.requestId]))}`
    const conversationId = `conversation-${campaignId}`
    const messageId = `message-${campaignId}`
    const attachmentIds = input.attachmentIds ?? []
    const requestHash = await correspondenceHash(JSON.stringify([input.projectId, subject, input.body, audience.data, [...attachmentIds].sort()]))
    let campaign = await ctx.db.select().from(projectEmailCampaigns).where(eq(projectEmailCampaigns.id, campaignId)).get()
    if (campaign && campaign.requestHash !== requestHash) return { success: false, error: "This send request was already used for different content. Start a new email." }
    if (!campaign) {
      let attachments: Awaited<ReturnType<typeof validateProjectEmailAttachments>>
      try { attachments = await validateProjectEmailAttachments(ctx, attachmentIds, input.draft !== undefined) } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Review email attachments before sending." }
      }
      const now = new Date().toISOString()
      const replyThreadId = crypto.randomUUID()
      const token = createReplyToken()
      const senderName = ctx.user.displayName ?? ctx.user.email
      const contacts = await correspondenceContacts(ctx)
      const addressedEmails = new Set([...audience.data.to, ...audience.data.cc, ...audience.data.bcc])
      const staff = contacts.filter((person) => person.role === "staff" && person.userId !== ctx.user.id)
      // Email matching never creates project membership. Blind grants stay private.
      const external = contacts.filter((person) => person.role !== "staff" && person.userId !== ctx.user.id && addressedEmails.has(normalizeRecipientEmail(person.email)))
      const sender = { userId: ctx.user.id, name: senderName, email: ctx.user.email, role: "staff" as const, delivery: "compass" as const }
      const people = [sender, ...staff, ...external]
      const guardId = crypto.randomUUID()
      const members = [
        ...audience.data.to.map((email) => ({ email, kind: "to" as const })),
        ...audience.data.cc.map((email) => ({ email, kind: "cc" as const })),
        ...audience.data.bcc.map((email) => ({ email, kind: "bcc" as const })),
      ]
      try {
        await ctx.db.batch([
        correspondenceWriteGuard(ctx, { id: guardId, conversationId: null, participantVersion: null, people, extra: and(emailAttachmentGuard(ctx, attachmentIds), savedDraftGuard(ctx, input.draft, {kind:"email",subject,body:input.body,...audience.data,attachmentIds,requestId:input.requestId})) }),
        ctx.db.insert(correspondence).values({ id: conversationId, organizationId: ctx.organizationId, projectId: input.projectId, subject, createdAt: now }),
        ...people.map((person) => ctx.db.insert(correspondenceParticipants).values({ id: crypto.randomUUID(), conversationId, userId: person.userId, name: person.name, email: person.email, role: person.role })),
        ctx.db.insert(correspondenceMessages).values({ id: messageId, conversationId, authorUserId: ctx.user.id, authorName: senderName, source: "email", body: input.body, sentAt: now, requestHash }),
        ...people.map((person) => ctx.db.insert(correspondenceRecipients).values({ id: crypto.randomUUID(), messageId, userId: person.userId, name: person.name, kind: person.userId === ctx.user.id ? "author" : "to", openedAt: person.userId === ctx.user.id ? now : null })),
        ...people.filter((person) => person.userId !== ctx.user.id).map((person) => ctx.db.insert(correspondenceOutbox).values({ id: crypto.randomUUID(), messageId, recipientUserId: person.userId, transport: "compass", status: "available", createdAt: now })),
        ...attachments.map((file) => ctx.db.update(correspondenceAttachments).set({ messageId }).where(and(eq(correspondenceAttachments.id, file.id), isNull(correspondenceAttachments.messageId), isNull(correspondenceAttachments.retiredAt)))),
        ctx.db.insert(emailReplyThreads).values({ id: replyThreadId, token, organizationId: ctx.organizationId, projectId: input.projectId, channelId: null, sourceType: "project_correspondence", sourceId: conversationId, sourceNumber: null, replyToAddress: trackedReplyAddress({ env: ctx.env, token }), subject, status: "active", createdBy: ctx.user.id, lastInboundAt: null, createdAt: now, updatedAt: now }),
        ctx.db.insert(projectEmailCampaigns).values({ id: campaignId, organizationId: ctx.organizationId, projectId: input.projectId, conversationId, messageId, senderUserId: ctx.user.id, requestHash, replyThreadId, status: "queued", createdAt: now, updatedAt: now }),
        ...members.map((member) => ctx.db.insert(projectEmailRecipients).values({ id: crypto.randomUUID(), campaignId, email: member.email, kind: member.kind })),
        ...(input.draft ? [retireSentComposition(ctx, input.draft)] : []),
        clearCorrespondenceWriteGuard(ctx, guardId),
        ])
        savedConversationId = conversationId
      } catch {
        // A concurrent click may have saved this exact request first.
        const existing = await ctx.db.select().from(projectEmailCampaigns).where(eq(projectEmailCampaigns.id, campaignId)).get()
        if (!existing || existing.requestHash !== requestHash) throw new Error("Project email could not be saved.")
        savedConversationId = conversationId
      }
      campaign = await ctx.db.select().from(projectEmailCampaigns).where(eq(projectEmailCampaigns.id, campaignId)).get()
    }
    if (!campaign) return { success: false, error: "Project email could not be saved." }
    savedConversationId = conversationId
    return await dispatchProjectEmailCampaign(ctx, campaign, subject, input.body, audience.data)
  } catch (error) {
    if (savedConversationId) return { success: true, conversationId: savedConversationId, status: "unknown", error: "Delivery outcome needs review; do not resend this message." }
    return safeFailure(error)
  }
}

export async function retryFailedProjectEmail(projectId: string, conversationId: string): Promise<SendResult> {
  try {
    const ctx = await correspondenceContext(projectId)
    if (ctx.workspace !== "staff") throw new Error("Only project staff can send project email.")
    const campaign = await ctx.db.select().from(projectEmailCampaigns).where(and(
      eq(projectEmailCampaigns.organizationId, ctx.organizationId),
      eq(projectEmailCampaigns.projectId, projectId),
      eq(projectEmailCampaigns.conversationId, conversationId),
      eq(projectEmailCampaigns.senderUserId, ctx.user.id),
    )).get()
    if (!campaign || campaign.status !== "failed") return { success: false, error: "This email is unavailable for retry." }
    const [message, conversation, recipients] = await Promise.all([
      ctx.db.select().from(correspondenceMessages).where(and(eq(correspondenceMessages.id, campaign.messageId), eq(correspondenceMessages.conversationId, conversationId))).get(),
      ctx.db.select().from(correspondence).where(and(eq(correspondence.id, conversationId), eq(correspondence.projectId, projectId), eq(correspondence.organizationId, ctx.organizationId))).get(),
      ctx.db.select().from(projectEmailRecipients).where(eq(projectEmailRecipients.campaignId, campaign.id)),
    ])
    if (!message || !conversation) return { success: false, error: "The original email is unavailable." }
    const audience = validateProjectEmailAudience({
      to: recipients.filter((recipient) => recipient.kind === "to").map((recipient) => recipient.email),
      cc: recipients.filter((recipient) => recipient.kind === "cc").map((recipient) => recipient.email),
      bcc: recipients.filter((recipient) => recipient.kind === "bcc").map((recipient) => recipient.email),
    })
    if (!audience.success) return audience
    return await dispatchProjectEmailCampaign(ctx, campaign, conversation.subject, message.body, audience.data)
  } catch {
    return { success: false, error: "Retry outcome is unknown. Check project messages before attempting another send." }
  }
}
