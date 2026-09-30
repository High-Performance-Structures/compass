import "server-only"

import { and, eq, isNull, sql } from "drizzle-orm"

import type { getDb } from "@/db"
import { emailReplyThreads, notificationEvents, notificationPreferences, notificationRecipients, organizationMembers, organizations, users } from "@/db/schema"
import { correspondence, correspondenceMessages, correspondenceParticipants, correspondenceRecipients, correspondenceWriteGuards } from "@/db/schema-correspondence"
import { projectEmailCampaigns, projectEmailRecipients } from "@/db/schema-project-email"
import { correspondenceHash } from "@/lib/correspondence/send"
import { stripHtml, type InboundCandidate } from "./gmail-message-parser"
import { normalizeRecipientEmail } from "./recipient-options"
import { projectReplyAddressHasToken } from "./project-email-validation"
import { USER_ROLES, isInternalStaffRole } from "@/lib/user-roles"

type Db = ReturnType<typeof getDb>

export async function routeProjectEmailReply(input: {
  readonly db: Db
  readonly organizationId: string
  readonly replyThread: typeof emailReplyThreads.$inferSelect
  readonly candidate: InboundCandidate
}): Promise<{ readonly status: "posted" | "duplicate" | "needs_review"; readonly messageId: string | null }> {
  const { db, organizationId, replyThread, candidate } = input
  const projectId = replyThread.projectId
  if (!projectId || replyThread.organizationId !== organizationId || replyThread.status !== "active") return { status: "needs_review", messageId: null }
  if (!projectReplyAddressHasToken(candidate.toAddress, replyThread.token)) return { status: "needs_review", messageId: null }

  const campaign = await db.select().from(projectEmailCampaigns).where(and(
    eq(projectEmailCampaigns.replyThreadId, replyThread.id),
    eq(projectEmailCampaigns.organizationId, organizationId),
    eq(projectEmailCampaigns.projectId, projectId),
    eq(projectEmailCampaigns.conversationId, replyThread.sourceId),
  )).get()
  if (!campaign || campaign.status === "queued" || campaign.status === "failed") return { status: "needs_review", messageId: null }

  const senderEmail = normalizeRecipientEmail(candidate.fromAddress)
  const allowed = await db.select({ id: projectEmailRecipients.id }).from(projectEmailRecipients).where(and(
    eq(projectEmailRecipients.campaignId, campaign.id),
    eq(projectEmailRecipients.email, senderEmail),
  )).get()
  if (!allowed) return { status: "needs_review", messageId: null }

  const conversation = await db.select({ id: correspondence.id }).from(correspondence).where(and(
    eq(correspondence.id, campaign.conversationId),
    eq(correspondence.projectId, projectId),
    eq(correspondence.organizationId, organizationId),
  )).get()
  if (!conversation) return { status: "needs_review", messageId: null }

  const participants = await db.select({ userId: correspondenceParticipants.userId, name: users.displayName, email: users.email, role: organizationMembers.role, inApp: notificationPreferences.inAppEnabled }).from(correspondenceParticipants)
    .innerJoin(users, eq(users.id, correspondenceParticipants.userId))
    .innerJoin(organizationMembers, and(eq(organizationMembers.userId, users.id), eq(organizationMembers.organizationId, organizationId)))
    .innerJoin(organizations, and(eq(organizations.id, organizationMembers.organizationId), eq(organizations.type, "internal")))
    .leftJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
    .where(and(eq(correspondenceParticipants.conversationId, conversation.id), eq(correspondenceParticipants.role, "staff"), isNull(correspondenceParticipants.revokedAt), eq(users.isActive, true)))
  const staff = participants.filter((person) => isInternalStaffRole(person.role))
  if (staff.length === 0) return { status: "needs_review", messageId: null }

  const text = candidate.textBody?.trim() || (candidate.htmlBody ? stripHtml(candidate.htmlBody).trim() : "") || candidate.snippet?.trim() || "(No message body.)"
  const body = candidate.attachments.length > 0
    ? `${text}\n\n[${candidate.attachments.length} email ${candidate.attachments.length === 1 ? "attachment is" : "attachments are"} pending manual review and unavailable in Compass.]`
    : text
  const id = `project-email-reply-${await correspondenceHash(JSON.stringify([organizationId, candidate.gmailMessageId]))}`
  const existing = await db.select({ id: correspondenceMessages.id }).from(correspondenceMessages).where(eq(correspondenceMessages.id, id)).get()
  if (existing) return { status: "duplicate", messageId: id }
  const authorName = candidate.fromName?.trim() ? `${candidate.fromName.trim()} <${senderEmail}>` : senderEmail
  const now = new Date().toISOString()
  const guardId = crypto.randomUUID()
  const eventId = `notification-${id}`
  const staffIds = JSON.stringify(staff.map((person) => person.userId))
  const staffRoles = JSON.stringify(USER_ROLES.filter(isInternalStaffRole))
  try {
    await db.batch([
      db.insert(correspondenceWriteGuards).values({ id: guardId, allowed: sql`CASE WHEN EXISTS(SELECT 1 FROM email_reply_threads thread WHERE thread.id=${replyThread.id} AND thread.token=${replyThread.token} AND thread.status='active' AND thread.organization_id=${organizationId} AND thread.project_id=${projectId} AND thread.source_id=${conversation.id}) AND EXISTS(SELECT 1 FROM project_email_campaigns campaign JOIN project_email_recipients recipient ON recipient.campaign_id=campaign.id WHERE campaign.id=${campaign.id} AND campaign.organization_id=${organizationId} AND campaign.project_id=${projectId} AND campaign.conversation_id=${conversation.id} AND campaign.status IN ('sent','dispatching','unknown') AND recipient.email=${senderEmail}) AND NOT EXISTS(SELECT 1 FROM json_each(${staffIds}) person WHERE NOT EXISTS(SELECT 1 FROM correspondence_participants participant JOIN users u ON u.id=participant.user_id JOIN organization_members member ON member.user_id=u.id AND member.organization_id=${organizationId} JOIN organizations org ON org.id=member.organization_id WHERE participant.conversation_id=${conversation.id} AND participant.user_id=person.value AND participant.role='staff' AND participant.revoked_at IS NULL AND u.is_active=1 AND org.type='internal' AND member.role IN (SELECT value FROM json_each(${staffRoles})))) THEN 1 ELSE 0 END` }),
      db.insert(correspondenceMessages).values({ id, conversationId: conversation.id, authorUserId: null, authorName, source: "email", sourceKey: id, body, sentAt: candidate.receivedAt, requestHash: id }),
      ...staff.map((person) => db.insert(correspondenceRecipients).values({ id: crypto.randomUUID(), messageId: id, userId: person.userId, name: person.name ?? person.email, kind: "to" })),
      db.insert(notificationEvents).values({ id: eventId, organizationId, projectId, eventType: "project_message", sourceType: "project_correspondence", sourceId: id, title: `Project email reply from ${candidate.fromName?.trim() || senderEmail}`, body: replyThread.subject, href: `/dashboard/projects/${encodeURIComponent(projectId)}/messages?conversationId=${encodeURIComponent(conversation.id)}&messageId=${encodeURIComponent(id)}`, audience: "internal", createdBy: null, createdAt: now }),
      ...staff.map((person) => db.insert(notificationRecipients).values({ id: `${eventId}-${person.userId}`, eventId, userId: person.userId, inApp: person.inApp ?? true, createdAt: now })),
      db.update(emailReplyThreads).set({ lastInboundAt: candidate.receivedAt, updatedAt: now }).where(eq(emailReplyThreads.id, replyThread.id)),
      db.delete(correspondenceWriteGuards).where(eq(correspondenceWriteGuards.id, guardId)),
    ])
  } catch (error) {
    const winner = await db.select({ id: correspondenceMessages.id }).from(correspondenceMessages).where(eq(correspondenceMessages.id, id)).get()
    if (winner) return { status: "duplicate", messageId: id }
    throw error
  }
  return { status: candidate.attachments.length > 0 ? "needs_review" : "posted", messageId: id }
}
