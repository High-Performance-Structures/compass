import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm"
import { correspondence, correspondenceAttachments, correspondenceDrafts, correspondenceMessages, correspondenceParticipants, correspondenceRecipients, correspondenceState } from "@/db/schema-correspondence"
import { correspondenceSourceMessages, correspondenceSourceRecipients } from "@/db/schema-correspondence-source"
import { authorizedConversation, authorizedProjectConversation, currentParticipants, type CorrespondenceContext } from "./access"
import type { CorrespondenceDetail, CorrespondenceMessage, CorrespondenceSummary } from "./types"

type SourceHeader = {
  readonly sourceSentDisplay: string
  readonly sourceSentAt: string | null
  readonly expectedRecoverableFileCount: number | null
  readonly recipients: readonly { readonly name: string; readonly kind: "to" | "cc" }[]
}

async function sourceHeaders(ctx: CorrespondenceContext, conversationId: string, messageIds: readonly string[]): Promise<ReadonlyMap<string, SourceHeader>> {
  if (messageIds.length === 0) return new Map()
  let sources: typeof correspondenceSourceMessages.$inferSelect[]
  let sourceRecipients: typeof correspondenceSourceRecipients.$inferSelect[]
  try {
    sources = await ctx.db.select().from(correspondenceSourceMessages).where(and(
      eq(correspondenceSourceMessages.organizationId, ctx.organizationId),
      eq(correspondenceSourceMessages.projectId, ctx.projectId),
      eq(correspondenceSourceMessages.conversationId, conversationId),
      inArray(correspondenceSourceMessages.messageId, messageIds),
    ))
    if (sources.length === 0) return new Map()
    const sourceIds = sources.map((source) => source.id)
    sourceRecipients = await ctx.db.select().from(correspondenceSourceRecipients).where(inArray(correspondenceSourceRecipients.sourceMessageId, sourceIds))
  } catch (error) {
    if (isMissingSourceAudienceTable(error)) return new Map()
    throw error
  }
  const bySourceId = new Map<string, { readonly name: string; readonly kind: "to" | "cc"; readonly ordinal: number }[]>()
  for (const recipient of sourceRecipients) {
    if (recipient.kind !== "to" && recipient.kind !== "cc") continue
    const existing = bySourceId.get(recipient.sourceMessageId)
    const list = existing ?? []
    list.push({ name: recipient.sourceName, kind: recipient.kind, ordinal: recipient.sourceOrdinal })
    bySourceId.set(recipient.sourceMessageId, list)
  }
  for (const list of bySourceId.values()) list.sort((left, right) => left.ordinal - right.ordinal)
  return new Map(sources.map((source) => [source.messageId, {
    sourceSentDisplay: source.sourceSentDisplay,
    sourceSentAt: source.sourceSentAt,
    expectedRecoverableFileCount: expectedRecoverableFileCount(source.sourceEvidenceJson),
    recipients: (bySourceId.get(source.id) ?? []).map(({ name, kind }) => ({ name, kind })),
  }]))
}

function expectedRecoverableFileCount(evidenceJson: string): number | null {
  try {
    const parsed: unknown = JSON.parse(evidenceJson)
    if (typeof parsed !== "object" || parsed === null || !("expectedRecoverableFileCount" in parsed)) return null
    const value = parsed.expectedRecoverableFileCount
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null
  } catch {
    return null
  }
}

function isMissingSourceAudienceTable(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (/no such table: correspondence_source_(messages|recipients)/i.test(error.message)) return true
  return error.cause !== undefined && isMissingSourceAudienceTable(error.cause)
}

export async function listCorrespondence(ctx: CorrespondenceContext, conversationId?: string, projectHistory = false): Promise<readonly CorrespondenceSummary[]> {
  if (projectHistory && (ctx.workspace !== "staff" || !conversationId)) throw new Error("Conversation not found.")
  const rows = await ctx.db.select({ conversation: correspondence }).from(correspondence)
    .where(and(projectHistory ? undefined : sql`EXISTS (SELECT 1 FROM correspondence_participants p WHERE p.conversation_id=${correspondence.id} AND p.user_id=${ctx.user.id} AND p.revoked_at IS NULL)`, eq(correspondence.projectId, ctx.projectId), eq(correspondence.organizationId, ctx.organizationId), conversationId ? eq(correspondence.id, conversationId) : undefined))
  const summaries = await Promise.all(rows.map(async ({ conversation }): Promise<CorrespondenceSummary | null> => {
    const people = projectHistory
      ? (await ctx.db.select().from(correspondenceParticipants).where(eq(correspondenceParticipants.conversationId, conversation.id))).map((p) => ({ userId: p.userId, name: p.name, email: p.email, role: p.role, delivery: "compass" as const }))
      : await currentParticipants(ctx, conversation.id)
    if (!projectHistory && !people.some((p) => p.userId === ctx.user.id)) return null
    const messages = await ctx.db.select({ message: correspondenceMessages }).from(correspondenceMessages)
      .where(and(eq(correspondenceMessages.conversationId, conversation.id), projectHistory ? undefined : sql`EXISTS (SELECT 1 FROM correspondence_recipients r WHERE r.message_id=${correspondenceMessages.id} AND r.user_id=${ctx.user.id})`)).orderBy(desc(correspondenceMessages.sentAt), desc(correspondenceMessages.sequence)).limit(1)
    const last = messages[0]
    if (!last) return null
    const lastSource = (await sourceHeaders(ctx, conversation.id, [last.message.id])).get(last.message.id)
    const lastActivitySourceLocal = lastSource !== undefined && lastSource.sourceSentAt === null
    const unread = await ctx.db.select({ id: correspondenceMessages.id }).from(correspondenceMessages)
      .innerJoin(correspondenceRecipients, and(eq(correspondenceRecipients.messageId, correspondenceMessages.id), eq(correspondenceRecipients.userId, ctx.user.id)))
      .where(and(eq(correspondenceMessages.conversationId, conversation.id), or(isNull(correspondenceMessages.authorUserId), ne(correspondenceMessages.authorUserId, ctx.user.id)),
        isNull(correspondenceMessages.retractedAt), eq(correspondenceRecipients.baseline, false), isNull(correspondenceRecipients.openedAt))).limit(1).get()
    const state = await ctx.db.select().from(correspondenceState).where(and(eq(correspondenceState.conversationId, conversation.id), eq(correspondenceState.userId, ctx.user.id))).get()
    return {
      id: conversation.id, projectId: ctx.projectId, subject: conversation.subject,
      excerpt: last.message.retractedAt ? "Message retracted" : last.message.body.slice(0, 180), lastActivityAt: last.message.sentAt,
      lastActivityDisplay: lastActivitySourceLocal ? lastSource?.sourceSentDisplay ?? null : null,
      lastActivitySourceLocal,
      people,
      unread: Boolean(unread),
      saved: state?.saved ?? false, followUp: state?.followUp ?? false, archived: state?.archived ?? false, closed: conversation.closed, shareReadReceipts: state?.shareReadReceipts ?? true,
    }
  }))
  return summaries.filter((row): row is CorrespondenceSummary => row !== null).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt) || b.id.localeCompare(a.id))
}

export async function readCorrespondence(ctx: CorrespondenceContext, conversationId: string, beforeSequence?: number, projectHistory = false): Promise<CorrespondenceDetail> {
  const conversation = await (projectHistory ? authorizedProjectConversation : authorizedConversation)(ctx, conversationId)
  const summary = (await listCorrespondence(ctx, conversationId, projectHistory)).find((row) => row.id === conversationId)
  if (!summary) throw new Error("Conversation not found.")
  const before = beforeSequence === undefined ? null : await ctx.db.select({ sentAt: correspondenceMessages.sentAt }).from(correspondenceMessages)
    .where(and(projectHistory ? undefined : sql`EXISTS (SELECT 1 FROM correspondence_recipients r WHERE r.message_id=${correspondenceMessages.id} AND r.user_id=${ctx.user.id})`, eq(correspondenceMessages.conversationId, conversationId), eq(correspondenceMessages.sequence, beforeSequence))).get()
  if (beforeSequence !== undefined && !before) throw new Error("Message page not found.")
  const rows = await ctx.db.select({ message: correspondenceMessages }).from(correspondenceMessages)
    .where(and(projectHistory ? undefined : sql`EXISTS (SELECT 1 FROM correspondence_recipients r WHERE r.message_id=${correspondenceMessages.id} AND r.user_id=${ctx.user.id})`, eq(correspondenceMessages.conversationId, conversationId), before && beforeSequence !== undefined ? or(lt(correspondenceMessages.sentAt, before.sentAt), and(eq(correspondenceMessages.sentAt, before.sentAt), lt(correspondenceMessages.sequence, beforeSequence))) : undefined))
    .orderBy(desc(correspondenceMessages.sentAt), desc(correspondenceMessages.sequence)).limit(51)
  const visible = rows.slice(0, 50).reverse()
  const ids = visible.map(({ message }) => message.id)
  const recipients = ids.length ? await ctx.db.select().from(correspondenceRecipients).where(inArray(correspondenceRecipients.messageId, ids)) : []
  const sourceHeadersByMessage = await sourceHeaders(ctx, conversationId, ids)
  const attachments = ids.length ? await ctx.db.select().from(correspondenceAttachments).where(and(eq(correspondenceAttachments.projectId, ctx.projectId), eq(correspondenceAttachments.organizationId, ctx.organizationId), inArray(correspondenceAttachments.messageId, ids))) : []
  const receiptStates = await ctx.db.select().from(correspondenceState).where(eq(correspondenceState.conversationId, conversationId))
  const draft = projectHistory ? null : await ctx.db.select().from(correspondenceDrafts).where(and(eq(correspondenceDrafts.conversationId, conversationId), eq(correspondenceDrafts.userId, ctx.user.id))).get()
  const messages: CorrespondenceMessage[] = visible.map(({ message }) => ({
    ...((): Pick<CorrespondenceMessage, "sourceSentDisplay" | "sourceSentAt" | "sourceAttachmentReadiness"> => {
      const source = sourceHeadersByMessage.get(message.id)
      const linkedDriveIds = new Set(attachments.filter((attachment) => attachment.messageId === message.id && attachment.retiredAt === null && attachment.driveFileId !== null).map((attachment) => attachment.driveFileId))
      const linkedAttachmentCount = linkedDriveIds.size
      const expected = source?.expectedRecoverableFileCount ?? null
      return {
        sourceSentDisplay: source?.sourceSentDisplay ?? null,
        sourceSentAt: source?.sourceSentAt ?? null,
        sourceAttachmentReadiness: expected === null ? null : {
          expectedRecoverableFileCount: expected,
          linkedAttachmentCount,
          pendingFileCount: Math.max(0, expected - linkedAttachmentCount),
        },
      }
    })(),
    id: message.id, sequence: message.sequence, source: message.source, authorName: message.authorName,
    authorUserId: message.authorUserId, sentAt: message.sentAt, body: message.retractedAt ? "" : message.body,
    recipients: sourceHeadersByMessage.get(message.id)?.recipients ?? recipients.filter((r) => r.messageId === message.id && r.kind !== "author").map((r) => ({ name: r.name, kind: r.kind === "cc" ? "cc" : "to" })),
    attachments: message.retractedAt ? [] : attachments.filter((a) => a.messageId === message.id).map((a) => ({ id: a.id, name: a.name, size: a.size, contentType: a.contentType, available: a.retiredAt === null && a.driveFileId !== null })),
    editedAt: message.editedAt, retractedAt: message.retractedAt, delivery: message.source === "buildertrend" ? "imported" : "saved",
    readReceipts: recipients.filter((r) => r.messageId === message.id && r.kind !== "author").map((r) => {
      const canShare = message.source !== "buildertrend" && (receiptStates.find((state) => state.userId === r.userId)?.shareReadReceipts ?? true)
      return { userId: r.userId, name: r.name, status: canShare ? r.openedAt ? "opened" : "not_opened" : "unavailable", openedAt: canShare ? r.openedAt : null }
    }),
    canEdit: !projectHistory && message.source === "compass" && message.authorUserId === ctx.user.id && !message.retractedAt,
  }))
  return { conversation: summary, participantVersion: conversation.participantVersion, messages, hasEarlier: rows.length > 50, draft: draft ? { body: draft.body, version: draft.version } : null }
}
