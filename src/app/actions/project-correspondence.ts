"use server"

import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { correspondence, correspondenceCompositionDrafts, correspondenceDrafts, correspondenceMessages, correspondenceParticipants, correspondenceRecipients, correspondenceRevisions, correspondenceState } from "@/db/schema-correspondence"
import { correspondenceSourceMessages } from "@/db/schema-correspondence-source"
import { authorizedConversation, correspondenceContacts, correspondenceContext, currentParticipants } from "@/lib/correspondence/access"
import { listCorrespondence, readCorrespondence } from "@/lib/correspondence/read"
import { parseCorrespondenceSend } from "@/lib/correspondence/validation"
import { persistCorrespondence, RejectedCorrespondenceSendError } from "@/lib/correspondence/send"
import { correspondenceWriteGuard, clearCorrespondenceWriteGuard } from "@/lib/correspondence/write-guard"
import type { CorrespondenceInboxFilter, CorrespondenceCompositionDraft, CorrespondenceDetail, CorrespondenceInbox, CorrespondenceResult, CorrespondenceStateInput, SendCorrespondenceInput, SendCorrespondenceResult } from "@/lib/correspondence/types"

function failure(error: unknown): { readonly success: false; readonly error: string } {
  // Never return SQL/provider internals or another participant's content.
  const safe = error instanceof Error && !/SQL|sqlite|constraint|query|D1|database|syntax/i.test(error.message)
  return { success: false, error: safe ? error.message : "Messaging is temporarily unavailable. Your draft has been retained." }
}
function refresh(projectId: string): void { revalidatePath(`/dashboard/projects/${projectId}/messages`) }

export async function getCorrespondenceInbox(projectId: string): Promise<CorrespondenceResult<CorrespondenceInbox>> {
  try {
    const ctx = await correspondenceContext(projectId)
    const draft = await ctx.db.select().from(correspondenceCompositionDrafts).where(and(eq(correspondenceCompositionDrafts.projectId, projectId), eq(correspondenceCompositionDrafts.organizationId, ctx.organizationId), eq(correspondenceCompositionDrafts.userId, ctx.user.id))).get()
    return { success: true, data: { compositionDraft: draft ? { subject: draft.subject, body: draft.body, recipientUserIds: draft.recipientUserIds, version: draft.version } : null, viewerId: ctx.user.id, projectName: ctx.projectName, workspace: ctx.workspace, conversations: await listCorrespondence(ctx), contacts: (await correspondenceContacts(ctx)).filter((p) => p.userId !== ctx.user.id) } }
  } catch (error) { return failure(error) }
}
export async function getCorrespondenceDetail(projectId: string, conversationId: string, beforeSequence?: number): Promise<CorrespondenceResult<CorrespondenceDetail>> {
  try {
    if (beforeSequence !== undefined && (!Number.isSafeInteger(beforeSequence) || beforeSequence < 1)) throw new Error("Invalid message page.")
    return { success: true, data: await readCorrespondence(await correspondenceContext(projectId), conversationId, beforeSequence) }
  } catch (error) {
    return failure(error)
  }
}
export async function sendCorrespondence(input: SendCorrespondenceInput): Promise<SendCorrespondenceResult> {
  try {
    const parsed = parseCorrespondenceSend(input)
    if (!parsed.success) return { ...parsed, retry: "edit" }
    const data = await persistCorrespondence(await correspondenceContext(parsed.data.projectId), parsed.data)
    refresh(input.projectId)
    return { success: true, data }
  } catch (error) { return { ...failure(error), retry: error instanceof RejectedCorrespondenceSendError ? "edit" : "same_request" } }
}
export async function setCorrespondenceState(projectId: string, conversationId: string, state: CorrespondenceStateInput): Promise<CorrespondenceResult<null>> {
  try {
    if ([state.saved, state.followUp, state.archived].some((v) => typeof v !== "boolean")) throw new Error("Invalid inbox state.")
    const ctx = await correspondenceContext(projectId)
    await authorizedConversation(ctx, conversationId)
    await ctx.db.insert(correspondenceState).values({ id: crypto.randomUUID(), conversationId, userId: ctx.user.id, saved: state.saved, followUp: state.followUp, archived: state.archived }).onConflictDoUpdate({ target: [correspondenceState.conversationId, correspondenceState.userId], set: { saved: state.saved, followUp: state.followUp, archived: state.archived } })
    refresh(projectId)
    return { success: true, data: null }
  } catch (error) { return failure(error) }
}
export async function saveCorrespondenceDraft(projectId: string, conversationId: string, body: string, expectedVersion: number): Promise<CorrespondenceResult<{ readonly version: number }>> {
  try {
    if (typeof body !== "string" || body.length > 50000 || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error("Invalid draft.")
    const ctx = await correspondenceContext(projectId)
    await authorizedConversation(ctx, conversationId)
    const version = expectedVersion + 1
    const rows = expectedVersion === 0
      ? await ctx.db.insert(correspondenceDrafts).values({ id: crypto.randomUUID(), conversationId, userId: ctx.user.id, body, version, updatedAt: new Date().toISOString() }).onConflictDoNothing().returning({ version: correspondenceDrafts.version })
      : await ctx.db.update(correspondenceDrafts).set({ body, version, updatedAt: new Date().toISOString() }).where(and(eq(correspondenceDrafts.conversationId, conversationId), eq(correspondenceDrafts.userId, ctx.user.id), eq(correspondenceDrafts.version, expectedVersion))).returning({ version: correspondenceDrafts.version })
    if (!rows.length) throw new Error("This draft changed on another device. Copy your text before reloading.")
    return { success: true, data: { version } }
  } catch (error) { return failure(error) }
}
export async function discardCorrespondenceDraft(projectId: string, conversationId: string, expectedVersion: number): Promise<CorrespondenceResult<null>> {
  // Keep a versioned empty tombstone, so delayed autosaves cannot resurrect a discarded draft.
  const result = await saveCorrespondenceDraft(projectId, conversationId, "", expectedVersion)
  return result.success ? { success: true, data: null } : result
}
export async function markCorrespondenceOpened(projectId: string, conversationId: string, observedMessages: readonly { readonly id: string; readonly editedAt: string | null }[]): Promise<CorrespondenceResult<null>> {
  try {
    if (!Array.isArray(observedMessages) || !observedMessages.length || observedMessages.length > 50) throw new Error("Invalid visible message selection.")
    const ctx = await correspondenceContext(projectId)
    await authorizedConversation(ctx, conversationId)
    const now = new Date().toISOString()
    for (const observed of observedMessages) {
      if (typeof observed.id !== "string" || observed.editedAt !== null && typeof observed.editedAt !== "string") throw new Error("Invalid visible message selection.")
      // Match the revision actually presented; a delayed read request cannot certify an edit.
      await ctx.db.update(correspondenceRecipients).set({ openedAt: now }).where(and(
        eq(correspondenceRecipients.userId, ctx.user.id), eq(correspondenceRecipients.messageId, observed.id), isNull(correspondenceRecipients.openedAt),
        sql`EXISTS(SELECT 1 FROM correspondence_messages m JOIN correspondence_participants p ON p.conversation_id=m.conversation_id
          WHERE m.id=${observed.id} AND m.conversation_id=${conversationId} AND m.retracted_at IS NULL
          AND p.user_id=${ctx.user.id} AND p.revoked_at IS NULL
          AND ${observed.editedAt === null ? sql`m.edited_at IS NULL` : sql`m.edited_at=${observed.editedAt}`})`
      ))
    }
    return { success: true, data: null }
  } catch (error) { return failure(error) }
}
export async function reviseCorrespondenceMessage(projectId: string, conversationId: string, messageId: string, body: string | null): Promise<CorrespondenceResult<null>> {
  try {
    if (body !== null && (typeof body !== "string" || !body.trim() || body.length > 50000)) throw new Error("Write a message of at most 50,000 characters.")
    const ctx = await correspondenceContext(projectId)
    const conversation = await authorizedConversation(ctx, conversationId)
    const message = await ctx.db.select().from(correspondenceMessages).where(and(eq(correspondenceMessages.id, messageId), eq(correspondenceMessages.conversationId, conversationId), eq(correspondenceMessages.authorUserId, ctx.user.id), eq(correspondenceMessages.source, "compass"), isNull(correspondenceMessages.retractedAt))).get()
    if (!message) throw new Error("Message cannot be changed.")
    const now = new Date().toISOString()
    const guardId = crypto.randomUUID()
    const people = await currentParticipants(ctx, conversationId)
    await ctx.db.batch([
      correspondenceWriteGuard(ctx, { id: guardId, conversationId, participantVersion: conversation.participantVersion, people: people.filter((p) => p.userId === ctx.user.id), extra: sql`EXISTS(SELECT 1 FROM correspondence_messages WHERE id=${messageId} AND body=${message.body} AND retracted_at IS NULL AND ${message.editedAt === null ? sql`edited_at IS NULL` : sql`edited_at=${message.editedAt}`})` }),
      ctx.db.insert(correspondenceRevisions).values({ id: crypto.randomUUID(), messageId, actorUserId: ctx.user.id, previousBody: message.body, operation: body === null ? "retract" : "edit", createdAt: now }),
      ctx.db.update(correspondenceMessages).set(body === null ? { retractedAt: now } : { body, editedAt: now }).where(eq(correspondenceMessages.id, messageId)),
      ctx.db.update(correspondenceRecipients).set({ openedAt: null }).where(eq(correspondenceRecipients.messageId, messageId)),
      clearCorrespondenceWriteGuard(ctx, guardId),
    ])
    refresh(projectId)
    return { success: true, data: null }
  } catch (error) { return failure(error) }
}
export async function setCorrespondenceClosed(projectId: string, conversationId: string, closed: boolean): Promise<CorrespondenceResult<null>> {
  try {
    if (typeof closed !== "boolean") throw new Error("Invalid conversation state.")
    const ctx = await correspondenceContext(projectId)
    if (ctx.workspace !== "staff") throw new Error("Only project staff can close or reopen a conversation.")
    await authorizedConversation(ctx, conversationId)
    await ctx.db.update(correspondence).set({ closed }).where(eq(correspondence.id, conversationId))
    refresh(projectId)
    return { success: true, data: null }
  } catch (error) { return failure(error) }
}

export async function setCorrespondenceReceiptPreference(projectId: string, conversationId: string, share: boolean): Promise<CorrespondenceResult<null>> {
  try {
    if (typeof share !== "boolean") throw new Error("Invalid receipt preference.")
    const ctx = await correspondenceContext(projectId)
    await authorizedConversation(ctx, conversationId)
    await ctx.db.insert(correspondenceState).values({ id: crypto.randomUUID(), conversationId, userId: ctx.user.id, shareReadReceipts: share })
      .onConflictDoUpdate({ target: [correspondenceState.conversationId, correspondenceState.userId], set: { shareReadReceipts: share } })
    refresh(projectId)
    return { success: true, data: null }
  } catch (error) { return failure(error) }
}

export async function searchCorrespondence(projectId: string, query: string, filter?: CorrespondenceInboxFilter): Promise<CorrespondenceResult<{
  readonly hits: readonly { readonly conversationId: string; readonly messageId: string; readonly subject: string; readonly excerpt: string; readonly sentAt: string; readonly sourceSentDisplay: string | null; readonly sourceSentAt: string | null }[]
  readonly hasMore: boolean
}>> {
  try {
    if (typeof query !== "string" || query.trim().length < 2 || query.length > 200) throw new Error("Enter between 2 and 200 characters to search messages.")
    const ctx = await correspondenceContext(projectId)
    if (filter !== undefined && !["inbox", "unread", "follow-up", "saved", "archived"].includes(filter)) throw new Error("Invalid inbox filter.")
    const term = query.trim()
    const stateValue = (field: "archived" | "follow_up" | "saved") => sql`COALESCE((SELECT ${sql.raw(field)} FROM correspondence_user_state s WHERE s.conversation_id=${correspondence.id} AND s.user_id=${ctx.user.id}), 0)`
    const inboxFilter = filter === undefined ? undefined : and(
      sql`${stateValue("archived")}=${filter === "archived" ? 1 : 0}`,
      filter === "saved" ? sql`${stateValue("saved")}=1` : undefined,
      filter === "follow-up" ? sql`${stateValue("follow_up")}=1` : undefined,
      filter === "unread" ? sql`EXISTS(SELECT 1 FROM correspondence_messages unread_message JOIN correspondence_recipients unread_grant ON unread_grant.message_id=unread_message.id
        WHERE unread_message.conversation_id=${correspondence.id} AND unread_grant.user_id=${ctx.user.id}
        AND unread_grant.opened_at IS NULL AND unread_grant.baseline=0 AND unread_message.retracted_at IS NULL
        AND (unread_message.author_user_id IS NULL OR unread_message.author_user_id<>${ctx.user.id}))` : undefined,
    )
    const rows = await ctx.db.select({ conversationId: correspondence.id, messageId: correspondenceMessages.id, subject: correspondence.subject, body: correspondenceMessages.body, sentAt: correspondenceMessages.sentAt })
      .from(correspondenceMessages).innerJoin(correspondence, eq(correspondence.id, correspondenceMessages.conversationId))
      .innerJoin(correspondenceRecipients, and(eq(correspondenceRecipients.messageId, correspondenceMessages.id), eq(correspondenceRecipients.userId, ctx.user.id)))
      .innerJoin(correspondenceParticipants, and(eq(correspondenceParticipants.conversationId, correspondence.id), eq(correspondenceParticipants.userId, ctx.user.id), eq(correspondenceParticipants.role, ctx.workspace), isNull(correspondenceParticipants.revokedAt)))
      .where(and(eq(correspondence.projectId, projectId), eq(correspondence.organizationId, ctx.organizationId), isNull(correspondenceMessages.retractedAt), inboxFilter,
        or(sql`instr(lower(${correspondence.subject}), lower(${term})) > 0`, sql`instr(lower(${correspondenceMessages.body}), lower(${term})) > 0`)))
      .orderBy(desc(correspondenceMessages.sentAt), desc(correspondenceMessages.sequence)).limit(51)
    const sourceByMessage = new Map<string, { readonly sourceSentDisplay: string; readonly sourceSentAt: string | null }>()
    if (rows.length > 0) {
      try {
        const sourceRows = await ctx.db.select({ messageId: correspondenceSourceMessages.messageId, conversationId: correspondenceSourceMessages.conversationId, sourceSentDisplay: correspondenceSourceMessages.sourceSentDisplay, sourceSentAt: correspondenceSourceMessages.sourceSentAt })
          .from(correspondenceSourceMessages)
          .where(and(eq(correspondenceSourceMessages.organizationId, ctx.organizationId), eq(correspondenceSourceMessages.projectId, projectId), inArray(correspondenceSourceMessages.messageId, rows.map((row) => row.messageId))))
        const visibleConversationByMessage = new Map(rows.map((row) => [row.messageId, row.conversationId]))
        for (const source of sourceRows) if (visibleConversationByMessage.get(source.messageId) === source.conversationId) sourceByMessage.set(source.messageId, source)
      } catch (error) {
        if (!isMissingSourceAudienceTable(error)) throw error
      }
    }
    return { success: true, data: { hits: rows.slice(0, 50).map((row) => {
      const start = Math.max(0, row.body.toLowerCase().indexOf(term.toLowerCase()) - 50)
      const source = sourceByMessage.get(row.messageId)
      return { conversationId: row.conversationId, messageId: row.messageId, subject: row.subject, sentAt: row.sentAt, sourceSentDisplay: source?.sourceSentAt === null ? source.sourceSentDisplay : null, sourceSentAt: source?.sourceSentAt ?? null, excerpt: `${start ? "…" : ""}${row.body.slice(start, start + 180)}` }
    }), hasMore: rows.length > 50 } }
  } catch (error) { return failure(error) }
}

function isMissingSourceAudienceTable(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (/no such table: correspondence_source_(messages|recipients)/i.test(error.message)) return true
  return error.cause !== undefined && isMissingSourceAudienceTable(error.cause)
}

export async function saveCorrespondenceCompositionDraft(projectId: string, draft: CorrespondenceCompositionDraft): Promise<CorrespondenceResult<{ readonly version: number }>> {
  try {
    if (typeof draft.subject !== "string" || draft.subject.length > 200 || typeof draft.body !== "string" || draft.body.length > 50000 || !Array.isArray(draft.recipientUserIds) || draft.recipientUserIds.length > 30 || draft.recipientUserIds.some((id) => typeof id !== "string" || id.length > 200) || !Number.isSafeInteger(draft.version) || draft.version < 0) throw new Error("Invalid composition draft.")
    const ctx = await correspondenceContext(projectId)
    const version = draft.version + 1
    const values = { subject: draft.subject, body: draft.body, recipientUserIds: draft.recipientUserIds, version, updatedAt: new Date().toISOString() }
    const rows = draft.version === 0
      ? await ctx.db.insert(correspondenceCompositionDrafts).values({ id: crypto.randomUUID(), organizationId: ctx.organizationId, projectId, userId: ctx.user.id, ...values }).onConflictDoNothing().returning({ version: correspondenceCompositionDrafts.version })
      : await ctx.db.update(correspondenceCompositionDrafts).set(values).where(and(eq(correspondenceCompositionDrafts.organizationId, ctx.organizationId), eq(correspondenceCompositionDrafts.projectId, projectId), eq(correspondenceCompositionDrafts.userId, ctx.user.id), eq(correspondenceCompositionDrafts.version, draft.version))).returning({ version: correspondenceCompositionDrafts.version })
    if (!rows.length) throw new Error("This draft changed on another device. Copy your text before reloading.")
    return { success: true, data: { version } }
  } catch (error) { return failure(error) }
}
