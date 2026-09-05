import { and, desc, eq, inArray, isNull, lt, ne, or } from "drizzle-orm"
import { correspondence, correspondenceAttachments, correspondenceDrafts, correspondenceMessages, correspondenceParticipants, correspondenceRecipients, correspondenceState } from "@/db/schema-correspondence"
import { authorizedConversation, currentParticipants, type CorrespondenceContext } from "./access"
import type { CorrespondenceDetail, CorrespondenceMessage, CorrespondenceSummary } from "./types"

export async function listCorrespondence(ctx: CorrespondenceContext, conversationId?: string): Promise<readonly CorrespondenceSummary[]> {
  const rows = await ctx.db.select({ conversation: correspondence }).from(correspondence)
    .innerJoin(correspondenceParticipants, and(eq(correspondenceParticipants.conversationId, correspondence.id), eq(correspondenceParticipants.userId, ctx.user.id), isNull(correspondenceParticipants.revokedAt)))
    .where(and(eq(correspondence.projectId, ctx.projectId), eq(correspondence.organizationId, ctx.organizationId), conversationId ? eq(correspondence.id, conversationId) : undefined))
  const summaries = await Promise.all(rows.map(async ({ conversation }): Promise<CorrespondenceSummary | null> => {
    const people = await currentParticipants(ctx, conversation.id)
    if (!people.some((p) => p.userId === ctx.user.id)) return null
    const messages = await ctx.db.select({ message: correspondenceMessages, grant: correspondenceRecipients }).from(correspondenceMessages)
      .innerJoin(correspondenceRecipients, and(eq(correspondenceRecipients.messageId, correspondenceMessages.id), eq(correspondenceRecipients.userId, ctx.user.id)))
      .where(eq(correspondenceMessages.conversationId, conversation.id)).orderBy(desc(correspondenceMessages.sentAt), desc(correspondenceMessages.sequence)).limit(1)
    const last = messages[0]
    if (!last) return null
    const unread = await ctx.db.select({ id: correspondenceMessages.id }).from(correspondenceMessages)
      .innerJoin(correspondenceRecipients, and(eq(correspondenceRecipients.messageId, correspondenceMessages.id), eq(correspondenceRecipients.userId, ctx.user.id)))
      .where(and(eq(correspondenceMessages.conversationId, conversation.id), or(isNull(correspondenceMessages.authorUserId), ne(correspondenceMessages.authorUserId, ctx.user.id)),
        isNull(correspondenceMessages.retractedAt), eq(correspondenceRecipients.baseline, false), isNull(correspondenceRecipients.openedAt))).limit(1).get()
    const state = await ctx.db.select().from(correspondenceState).where(and(eq(correspondenceState.conversationId, conversation.id), eq(correspondenceState.userId, ctx.user.id))).get()
    return {
      id: conversation.id, projectId: ctx.projectId, subject: conversation.subject,
      excerpt: last.message.retractedAt ? "Message retracted" : last.message.body.slice(0, 180), lastActivityAt: last.message.sentAt,
      people,
      unread: Boolean(unread),
      saved: state?.saved ?? false, followUp: state?.followUp ?? false, archived: state?.archived ?? false, closed: conversation.closed, shareReadReceipts: state?.shareReadReceipts ?? true,
    }
  }))
  return summaries.filter((row): row is CorrespondenceSummary => row !== null).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt) || b.id.localeCompare(a.id))
}

export async function readCorrespondence(ctx: CorrespondenceContext, conversationId: string, beforeSequence?: number): Promise<CorrespondenceDetail> {
  const conversation = await authorizedConversation(ctx, conversationId)
  const summary = (await listCorrespondence(ctx, conversationId)).find((row) => row.id === conversationId)
  if (!summary) throw new Error("Conversation not found.")
  const before = beforeSequence === undefined ? null : await ctx.db.select({ sentAt: correspondenceMessages.sentAt }).from(correspondenceMessages)
    .innerJoin(correspondenceRecipients, and(eq(correspondenceRecipients.messageId, correspondenceMessages.id), eq(correspondenceRecipients.userId, ctx.user.id)))
    .where(and(eq(correspondenceMessages.conversationId, conversationId), eq(correspondenceMessages.sequence, beforeSequence))).get()
  if (beforeSequence !== undefined && !before) throw new Error("Message page not found.")
  const rows = await ctx.db.select({ message: correspondenceMessages }).from(correspondenceMessages)
    .innerJoin(correspondenceRecipients, and(eq(correspondenceRecipients.messageId, correspondenceMessages.id), eq(correspondenceRecipients.userId, ctx.user.id)))
    .where(and(eq(correspondenceMessages.conversationId, conversationId), before && beforeSequence !== undefined ? or(lt(correspondenceMessages.sentAt, before.sentAt), and(eq(correspondenceMessages.sentAt, before.sentAt), lt(correspondenceMessages.sequence, beforeSequence))) : undefined))
    .orderBy(desc(correspondenceMessages.sentAt), desc(correspondenceMessages.sequence)).limit(51)
  const visible = rows.slice(0, 50).reverse()
  const ids = visible.map(({ message }) => message.id)
  const recipients = ids.length ? await ctx.db.select().from(correspondenceRecipients).where(inArray(correspondenceRecipients.messageId, ids)) : []
  const attachments = ids.length ? await ctx.db.select().from(correspondenceAttachments).where(and(eq(correspondenceAttachments.projectId, ctx.projectId), eq(correspondenceAttachments.organizationId, ctx.organizationId), inArray(correspondenceAttachments.messageId, ids))) : []
  const receiptStates = await ctx.db.select().from(correspondenceState).where(eq(correspondenceState.conversationId, conversationId))
  const draft = await ctx.db.select().from(correspondenceDrafts).where(and(eq(correspondenceDrafts.conversationId, conversationId), eq(correspondenceDrafts.userId, ctx.user.id))).get()
  const messages: CorrespondenceMessage[] = visible.map(({ message }) => ({
    id: message.id, sequence: message.sequence, source: message.source, authorName: message.authorName,
    authorUserId: message.authorUserId, sentAt: message.sentAt, body: message.retractedAt ? "" : message.body,
    recipients: recipients.filter((r) => r.messageId === message.id && r.kind !== "author").map((r) => ({ name: r.name, kind: r.kind === "cc" ? "cc" : "to" })),
    attachments: message.retractedAt ? [] : attachments.filter((a) => a.messageId === message.id).map((a) => ({ id: a.id, name: a.name, size: a.size, contentType: a.contentType, available: a.driveFileId !== null })),
    editedAt: message.editedAt, retractedAt: message.retractedAt, delivery: message.source === "buildertrend" ? "imported" : "saved",
    readReceipts: recipients.filter((r) => r.messageId === message.id && r.kind !== "author").map((r) => {
      const canShare = message.source !== "buildertrend" && (receiptStates.find((state) => state.userId === r.userId)?.shareReadReceipts ?? true)
      return { userId: r.userId, name: r.name, status: canShare ? r.openedAt ? "opened" : "not_opened" : "unavailable", openedAt: canShare ? r.openedAt : null }
    }),
    canEdit: message.source === "compass" && message.authorUserId === ctx.user.id && !message.retractedAt,
  }))
  return { conversation: summary, participantVersion: conversation.participantVersion, messages, hasEarlier: rows.length > 50, draft: draft ? { body: draft.body, version: draft.version } : null }
}
