import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { correspondence, correspondenceAttachments, correspondenceCompositionDrafts, correspondenceDrafts, correspondenceMessages, correspondenceOutbox, correspondenceParticipants, correspondenceRecipients } from "@/db/schema-correspondence"
import { authorizedConversation, correspondenceContacts, currentParticipants, type CorrespondenceContext } from "./access"
import { clearCorrespondenceWriteGuard, correspondenceWriteGuard } from "./write-guard"
import type { CorrespondencePerson, SendCorrespondenceInput } from "./types"

// Only definite pre-write rejections permit changing a frozen send request.
export class RejectedCorrespondenceSendError extends Error {}

export async function correspondenceHash(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function validateCorrespondenceSend(input: SendCorrespondenceInput): string | null {
  if (!input.body.trim() || input.body.length > 50000) return "Write a message of at most 50,000 characters."
  if (!input.subject.trim() || input.subject.trim().length > 200) return "Enter a subject of at most 200 characters."
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(input.idempotencyKey)) return "Invalid send request. Reload and try again."
  if (input.recipientUserIds.length < 1 || input.recipientUserIds.length > 30 || new Set(input.recipientUserIds).size !== input.recipientUserIds.length) return "Choose between 1 and 30 distinct recipients."
  if (input.attachmentIds.length > 10 || new Set(input.attachmentIds).size !== input.attachmentIds.length) return "Choose no more than 10 distinct attachments."
  return null
}

export async function persistCorrespondence(ctx: CorrespondenceContext, input: SendCorrespondenceInput): Promise<{ readonly conversationId: string; readonly messageId: string }> {
  const validationError = validateCorrespondenceSend(input)
  if (validationError) throw new RejectedCorrespondenceSendError(validationError)
  const messageId = await correspondenceHash(JSON.stringify([ctx.organizationId, ctx.user.id, input.idempotencyKey]))
  const conversationId = input.conversationId ?? `correspondence-${messageId}`
  const requestHash = await correspondenceHash(JSON.stringify({ conversationId: input.conversationId, subject: input.subject.trim(), body: input.body, recipients: [...input.recipientUserIds].sort(), attachments: [...input.attachmentIds].sort(), participantVersion: input.participantVersion }))
  const existing = await ctx.db.select().from(correspondenceMessages).where(eq(correspondenceMessages.id, messageId)).get()
  if (existing) {
    await authorizedConversation(ctx, existing.conversationId)
    if (existing.requestHash !== requestHash) throw new RejectedCorrespondenceSendError("This send request already saved different content. Start a new send.")
    return { conversationId: existing.conversationId, messageId }
  }
  const own: CorrespondencePerson = { userId: ctx.user.id, name: ctx.user.displayName ?? ctx.user.email, email: ctx.user.email, role: ctx.workspace, delivery: "compass" }
  let people: readonly CorrespondencePerson[]
  if (input.conversationId) {
    const conversation = await authorizedConversation(ctx, input.conversationId)
    if (input.participantVersion !== conversation.participantVersion) throw new RejectedCorrespondenceSendError("The audience changed. Review the recipients before sending.")
    const current = await currentParticipants(ctx, input.conversationId)
    const expected = current.filter((p) => p.userId !== ctx.user.id).map((p) => p.userId).sort()
    if (expected.join("|") !== [...input.recipientUserIds].sort().join("|")) throw new RejectedCorrespondenceSendError("The audience changed. Reload and review the recipients.")
    people = current
  } else {
    const contacts = await correspondenceContacts(ctx)
    const recipients = contacts.filter((p) => input.recipientUserIds.includes(p.userId) && p.userId !== ctx.user.id)
    if (recipients.length !== input.recipientUserIds.length) throw new RejectedCorrespondenceSendError("A recipient is no longer available for this project.")
    people = [own, ...recipients]
  }
  if (!people.some((p) => p.userId === ctx.user.id)) throw new RejectedCorrespondenceSendError("Conversation not found.")
  const attachments = input.attachmentIds.length ? await ctx.db.select().from(correspondenceAttachments).where(and(inArray(correspondenceAttachments.id, [...input.attachmentIds]), eq(correspondenceAttachments.organizationId, ctx.organizationId), eq(correspondenceAttachments.projectId, ctx.projectId), eq(correspondenceAttachments.ownerUserId, ctx.user.id), isNull(correspondenceAttachments.messageId), isNull(correspondenceAttachments.retiredAt))) : []
  const expiry = new Date(Date.now() - 7 * 86400000).toISOString()
  if (attachments.length !== input.attachmentIds.length || attachments.some((a) => !a.driveFileId || a.size > 25 * 1024 * 1024 || a.createdAt < expiry) || attachments.reduce((n, a) => n + a.size, 0) > 50 * 1024 * 1024) throw new RejectedCorrespondenceSendError("An attachment is unavailable or exceeds the upload limits. Review files before sending.")
  const guardId = crypto.randomUUID()
  const now = new Date().toISOString()
  const attachmentGuard = input.attachmentIds.length ? sql`(SELECT COUNT(*) FROM correspondence_attachments WHERE id IN (${sql.join(input.attachmentIds.map((id) => sql`${id}`), sql`,`)}) AND organization_id=${ctx.organizationId} AND project_id=${ctx.projectId} AND owner_user_id=${ctx.user.id} AND message_id IS NULL AND retired_at IS NULL AND drive_file_id IS NOT NULL)=${input.attachmentIds.length}` : undefined
  const guard = correspondenceWriteGuard(ctx, { id: guardId, conversationId: input.conversationId, participantVersion: input.participantVersion, people, extra: attachmentGuard })
  const insertConversation = ctx.db.insert(correspondence).values({ id: conversationId, organizationId: ctx.organizationId, projectId: ctx.projectId, subject: input.subject.trim(), createdAt: now }).onConflictDoNothing()
  const insertMessage = ctx.db.insert(correspondenceMessages).values({ id: messageId, conversationId, authorUserId: ctx.user.id, authorName: own.name, source: "compass", body: input.body, sentAt: now, requestHash })
  const insertParticipants = people.map((person) => ctx.db.insert(correspondenceParticipants).values([person].map((p) => ({ id: crypto.randomUUID(), conversationId, userId: p.userId, name: p.name, email: p.email, role: p.role }))).onConflictDoNothing())
  const insertRecipients = people.map((person) => ctx.db.insert(correspondenceRecipients).values([person].map((p): typeof correspondenceRecipients.$inferInsert => ({ id: crypto.randomUUID(), messageId, userId: p.userId, name: p.name, kind: p.userId === ctx.user.id ? "author" : "to", openedAt: p.userId === ctx.user.id ? now : null }))))
  const insertOutbox = people.filter((p) => p.userId !== ctx.user.id).map((person) => ctx.db.insert(correspondenceOutbox).values([person].map((p) => ({ id: crypto.randomUUID(), messageId, recipientUserId: p.userId, transport: "compass", status: "available", createdAt: now }))))
  const attach = attachments.map((a) => ctx.db.update(correspondenceAttachments).set({ messageId }).where(and(eq(correspondenceAttachments.id, a.id), isNull(correspondenceAttachments.messageId), isNull(correspondenceAttachments.retiredAt))))
  // SQLite's default trim removes only spaces; match JavaScript trim used by the composer.
  const trimCharacters = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
  const clearSentDraft = input.conversationId
    ? ctx.db.update(correspondenceDrafts).set({ body: "", version: sql`${correspondenceDrafts.version} + 1`, updatedAt: now })
      .where(and(eq(correspondenceDrafts.conversationId, conversationId), eq(correspondenceDrafts.userId, ctx.user.id), sql`trim(${correspondenceDrafts.body}, ${trimCharacters})=${input.body.trim()}`))
    : ctx.db.update(correspondenceCompositionDrafts).set({ body: "", subject: "", recipientUserIds: [], version: sql`${correspondenceCompositionDrafts.version} + 1`, updatedAt: now })
      .where(and(eq(correspondenceCompositionDrafts.organizationId, ctx.organizationId), eq(correspondenceCompositionDrafts.projectId, ctx.projectId), eq(correspondenceCompositionDrafts.userId, ctx.user.id),
        sql`trim(${correspondenceCompositionDrafts.body}, ${trimCharacters})=${input.body.trim()}`, sql`trim(${correspondenceCompositionDrafts.subject}, ${trimCharacters})=${input.subject.trim()}`, eq(correspondenceCompositionDrafts.recipientUserIds, [...input.recipientUserIds])))
  try {
    await ctx.db.batch([guard, insertConversation, ...insertParticipants, insertMessage, ...insertRecipients, ...insertOutbox, ...attach, clearSentDraft, ctx.db.update(correspondence).set({ closed: false }).where(eq(correspondence.id, conversationId)), clearCorrespondenceWriteGuard(ctx, guardId)])
  } catch {
    // A simultaneous identical retry may have committed first. Do not re-send its outbox.
    const winner = await ctx.db.select().from(correspondenceMessages).where(eq(correspondenceMessages.id, messageId)).get()
    if (winner?.requestHash === requestHash) {
      await authorizedConversation(ctx, winner.conversationId)
      return { conversationId: winner.conversationId, messageId }
    }
    throw new Error("The message could not be saved. Access or attachments may have changed. Your draft is retained; reload before retrying.")
  }
  return { conversationId, messageId }
}
