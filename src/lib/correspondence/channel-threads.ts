import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm"
import { organizationMembers, projectMembers, projects, users } from "@/db/schema"
import { channelMembers, channelReadState, channels, messageAttachments, messages } from "@/db/schema-conversations"
import { canAccessConversationChannel, importedConversationAccess } from "@/lib/conversations/channel-access"
import { importedConversationContent, messageSenderDisplay } from "@/lib/conversations/imported-message-content"
import { normalizeConversationMentions } from "@/lib/conversations/message-content"
import { chunkD1Values } from "@/lib/d1-query"
import { importedMessageColumns } from "@/lib/domain/conversations/imported"
import { upsertChannelReadForUser } from "@/lib/domain/conversations/store"
import { markChannelNotificationsRead } from "@/lib/notifications/clear-on-read"
import { isInternalStaffRole } from "@/lib/user-roles"
import type { CorrespondenceContext } from "./access"
import { channelThreadConversationId } from "./channel-thread-id"
import type { CorrespondenceAttachment, CorrespondenceDetail, CorrespondenceInboxFilter, CorrespondenceMessage, CorrespondencePerson, CorrespondenceSummary } from "./types"

/*
 * Read adapter: project conversations stored as channels (Buildertrend threads
 * imported into live conversations, migration 0287) shown in the project
 * messages inbox as ordinary subjects. Nothing is copied into correspondence
 * tables; replies go through the conversation's own send action, and the
 * only write here is the viewer's channel read state (owned by the
 * conversations store). Access is the conversation rule
 * (canAccessConversationChannel), narrowed to the inbox's own audience.
 * See docs/plans/bt-messages-live-conversations.md.
 */

type ChannelThread = {
  readonly id: string
  readonly name: string
  readonly audience: string
  readonly isPrivate: boolean
  readonly archivedAt: string | null
  readonly sourceSystem: string | null
  readonly unreadCount: number
}

const WORKSPACE_AUDIENCE = { owner: "clients", sub_vendor: "sub_vendors" } as const
const EXCERPT_LENGTH = 180

/**
 * Whether the inbox viewer may open a channel conversation. The staff inbox
 * needs an internal staff role; an owner or vendor inbox only ever shows its
 * own audience (clients / sub_vendors), and then the conversation access
 * rule decides (membership, the project's staff-only switch).
 */
function canOpenChannelThread(input: {
  readonly workspace: CorrespondenceContext["workspace"]
  readonly role: string | null
  readonly isActive: boolean
  readonly hasMembership: boolean
  readonly channel: {
    readonly id: string
    readonly audience: string
    readonly isPrivate: boolean
    readonly sourceSystem: string | null
    readonly projectStaffOnly: boolean | null
  }
}): boolean {
  if (input.role === null) return false
  if ((input.workspace === "staff") !== isInternalStaffRole(input.role)) return false
  if (input.workspace !== "staff" && input.channel.audience !== WORKSPACE_AUDIENCE[input.workspace]) return false
  return canAccessConversationChannel({
    channelId: input.channel.id,
    hasMembership: input.hasMembership,
    isActive: input.isActive,
    isPrivate: input.channel.isPrivate,
    audience: input.channel.audience,
    role: input.role,
    imported: importedConversationAccess({ sourceSystem: input.channel.sourceSystem, projectStaffOnly: input.channel.projectStaffOnly }),
  })
}

async function viewerOrganizationRole(ctx: CorrespondenceContext): Promise<string | null> {
  const row = await ctx.db.select({ role: organizationMembers.role }).from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, ctx.organizationId), eq(organizationMembers.userId, ctx.user.id))).get()
  return row?.role ?? null
}

/** Imported project conversations on this project that the viewer may open. */
async function accessibleChannelThreads(ctx: CorrespondenceContext, channelId?: string): Promise<readonly ChannelThread[]> {
  const role = await viewerOrganizationRole(ctx)
  if (role === null) return []
  const rows = await ctx.db.select({
    id: channels.id, name: channels.name, audience: channels.audience, isPrivate: channels.isPrivate,
    archivedAt: channels.archivedAt, sourceSystem: channels.sourceSystem,
    projectStaffOnly: projects.importedConversationsStaffOnly,
    memberId: channelMembers.id, unreadCount: channelReadState.unreadCount,
  }).from(channels)
    .innerJoin(projects, eq(projects.id, channels.projectId))
    .leftJoin(channelMembers, and(eq(channelMembers.channelId, channels.id), eq(channelMembers.userId, ctx.user.id)))
    .leftJoin(channelReadState, and(eq(channelReadState.channelId, channels.id), eq(channelReadState.userId, ctx.user.id)))
    .where(and(
      eq(channels.organizationId, ctx.organizationId),
      eq(channels.projectId, ctx.projectId),
      isNotNull(channels.sourceSystem),
      channelId === undefined ? undefined : eq(channels.id, channelId),
    ))
  const threads = new Map<string, ChannelThread>()
  for (const row of rows) {
    if (threads.has(row.id)) continue
    const allowed = canOpenChannelThread({
      workspace: ctx.workspace, role, isActive: ctx.user.isActive, hasMembership: row.memberId !== null,
      channel: { id: row.id, audience: row.audience, isPrivate: row.isPrivate, sourceSystem: row.sourceSystem, projectStaffOnly: row.projectStaffOnly },
    })
    if (allowed) threads.set(row.id, { id: row.id, name: row.name, audience: row.audience, isPrivate: row.isPrivate, archivedAt: row.archivedAt, sourceSystem: row.sourceSystem, unreadCount: row.unreadCount ?? 0 })
  }
  return [...threads.values()]
}

/** The channel behind an inbox id, when the viewer may open it. */
async function authorizedChannelThread(ctx: CorrespondenceContext, channelId: string): Promise<ChannelThread> {
  const thread = (await accessibleChannelThreads(ctx, channelId))[0]
  if (!thread) throw new Error("Conversation not found.")
  return thread
}

function messageText(message: { readonly id: string; readonly content: string; readonly sourceSystem: string | null }): string {
  return normalizeConversationMentions(importedConversationContent(message))
}

function personRole(organizationRole: string, projectRole: string | null): CorrespondencePerson["role"] | null {
  if (isInternalStaffRole(organizationRole)) return "staff"
  if (projectRole === "owner" || projectRole === "client") return "owner"
  if (projectRole === "subcontractor" || projectRole === "supplier") return "sub_vendor"
  return null
}

async function summarize(ctx: CorrespondenceContext, threads: readonly ChannelThread[]): Promise<readonly CorrespondenceSummary[]> {
  if (threads.length === 0) return []
  const latestRows: { readonly channelId: string; readonly id: string; readonly content: string; readonly createdAt: string; readonly deletedAt: string | null; readonly sourceSystem: string | null; readonly snapshot: string | null }[] = []
  const sentRows: { readonly channelId: string; readonly id: string; readonly content: string; readonly createdAt: string; readonly sourceSystem: string | null }[] = []
  const memberRows: { readonly channelId: string; readonly userId: string; readonly name: string | null; readonly email: string; readonly organizationRole: string; readonly projectRole: string | null }[] = []
  for (const ids of chunkD1Values(threads.map((thread) => thread.id))) {
    const [latest, sent, members] = await Promise.all([
      ctx.db.select({ channelId: messages.channelId, id: messages.id, content: messages.content, createdAt: messages.createdAt, deletedAt: messages.deletedAt, sourceSystem: messages.sourceSystem, snapshot: messages.sourceSentAtSnapshot })
        .from(messages)
        .where(and(inArray(messages.channelId, ids), sql`${messages.id} = (SELECT m.id FROM messages m WHERE m.channel_id = ${messages.channelId} ORDER BY m.created_at DESC, m.id DESC LIMIT 1)`)),
      ctx.db.select({ channelId: messages.channelId, id: messages.id, content: messages.content, createdAt: messages.createdAt, sourceSystem: messages.sourceSystem })
        .from(messages)
        .where(and(inArray(messages.channelId, ids), sql`${messages.id} = (SELECT m.id FROM messages m WHERE m.channel_id = ${messages.channelId} AND m.user_id = ${ctx.user.id} AND m.source_system IS NULL AND m.deleted_at IS NULL ORDER BY m.created_at DESC, m.id DESC LIMIT 1)`)),
      ctx.db.select({ channelId: channelMembers.channelId, userId: users.id, name: users.displayName, email: users.email, organizationRole: organizationMembers.role, projectRole: projectMembers.role })
        .from(channelMembers)
        .innerJoin(users, eq(users.id, channelMembers.userId))
        .innerJoin(organizationMembers, and(eq(organizationMembers.userId, users.id), eq(organizationMembers.organizationId, ctx.organizationId)))
        .leftJoin(projectMembers, and(eq(projectMembers.userId, users.id), eq(projectMembers.projectId, ctx.projectId)))
        .where(and(inArray(channelMembers.channelId, ids), eq(users.isActive, true))),
    ])
    latestRows.push(...latest)
    sentRows.push(...sent)
    memberRows.push(...members)
  }
  return threads.flatMap((thread): CorrespondenceSummary[] => {
    const last = latestRows.find((row) => row.channelId === thread.id)
    if (!last) return []
    const sent = sentRows.find((row) => row.channelId === thread.id)
    const people = new Map<string, CorrespondencePerson>()
    for (const member of memberRows) {
      if (member.channelId !== thread.id || people.has(member.userId)) continue
      const role = personRole(member.organizationRole, member.projectRole)
      if (role !== null) people.set(member.userId, { userId: member.userId, name: member.name ?? member.email, email: member.email, role, delivery: "compass" })
    }
    return [{
      id: channelThreadConversationId(thread.id), projectId: ctx.projectId, subject: thread.name,
      excerpt: last.deletedAt ? "Message deleted" : messageText(last).slice(0, EXCERPT_LENGTH),
      // created_at orders the inbox; the original sent date is the label.
      lastActivityAt: last.createdAt,
      lastActivityDisplay: last.snapshot,
      lastActivitySourceLocal: last.snapshot !== null,
      people: [...people.values()],
      unread: thread.unreadCount > 0,
      saved: false, followUp: false, archived: thread.archivedAt !== null, closed: false, shareReadReceipts: false,
      lastSentAt: sent?.createdAt ?? null, lastSentExcerpt: sent ? messageText(sent).slice(0, EXCERPT_LENGTH) : null, lastSentMessageId: sent?.id ?? null,
      origin: { kind: "channel", source: thread.sourceSystem === "buildertrend" ? "buildertrend" : null },
    }]
  })
}

/** Inbox rows for the viewer's imported project conversations. */
export async function listChannelThreads(ctx: CorrespondenceContext): Promise<readonly CorrespondenceSummary[]> {
  return summarize(ctx, await accessibleChannelThreads(ctx))
}

const PAGE_SIZE = 50

/** One imported conversation as a correspondence detail: every message, oldest first, 50 per page. */
export async function readChannelThread(ctx: CorrespondenceContext, channelId: string, beforeSequence?: number): Promise<CorrespondenceDetail> {
  const thread = await authorizedChannelThread(ctx, channelId)
  const summary = (await summarize(ctx, [thread]))[0]
  if (!summary) throw new Error("Conversation not found.")
  // Sequence is the message's position in created_at order (the original sent order).
  const numbered = ctx.db.select({ id: messages.id, sequence: sql<number>`ROW_NUMBER() OVER (ORDER BY ${messages.createdAt}, ${messages.id})`.as("sequence") })
    .from(messages).where(eq(messages.channelId, thread.id)).as("numbered")
  const rows = await ctx.db.select({
    sequence: numbered.sequence, id: messages.id, userId: messages.userId, content: messages.content,
    createdAt: messages.createdAt, editedAt: messages.editedAt, deletedAt: messages.deletedAt,
    snapshot: messages.sourceSentAtSnapshot, ...importedMessageColumns,
    userDisplayName: users.displayName, userEmail: users.email,
  }).from(numbered)
    .innerJoin(messages, eq(messages.id, numbered.id))
    .leftJoin(users, eq(users.id, messages.userId))
    .where(beforeSequence === undefined ? undefined : lt(numbered.sequence, beforeSequence))
    .orderBy(desc(numbered.sequence)).limit(PAGE_SIZE + 1)
  const visible = rows.slice(0, PAGE_SIZE).reverse()
  const attachments: { readonly messageId: string; readonly id: string; readonly fileName: string; readonly mimeType: string; readonly fileSize: number }[] = []
  for (const ids of chunkD1Values(visible.filter((row) => row.deletedAt === null).map((row) => row.id))) {
    attachments.push(...await ctx.db.select({ messageId: messageAttachments.messageId, id: messageAttachments.id, fileName: messageAttachments.fileName, mimeType: messageAttachments.mimeType, fileSize: messageAttachments.fileSize })
      .from(messageAttachments).where(inArray(messageAttachments.messageId, ids)))
  }
  const detailMessages = visible.map((row): CorrespondenceMessage => {
    const sender = messageSenderDisplay({ message: row, userId: row.userId, userDisplayName: row.userDisplayName ?? row.userEmail, currentUserId: ctx.user.id })
    const imported = row.sourceSystem !== null
    return {
      id: row.id, sequence: row.sequence,
      source: row.sourceSystem === "buildertrend" ? "buildertrend" : "compass",
      authorName: sender.displayName ?? "Unknown sender", authorUserId: sender.senderUserId,
      sentAt: row.createdAt, sourceSentDisplay: row.snapshot, sourceSentAt: null, sourceAttachmentReadiness: null,
      body: row.deletedAt ? "" : messageText(row),
      recipients: [], emailBcc: [], emailDeliveryStatus: null,
      attachments: row.deletedAt ? [] : attachments.filter((file) => file.messageId === row.id).map((file): CorrespondenceAttachment => ({
        id: file.id, name: file.fileName, size: file.fileSize, contentType: file.mimeType, available: true,
        href: `/api/conversations/attachments/${encodeURIComponent(file.id)}`,
      })),
      editedAt: row.editedAt, retractedAt: row.deletedAt,
      delivery: imported ? "imported" : "saved",
      canEdit: false, readReceipts: [],
    }
  })
  return { replyAudience: null, conversation: summary, participantVersion: 0, messages: detailMessages, hasEarlier: rows.length > PAGE_SIZE, draft: null }
}

/** The viewer saw these messages: clear the conversation's unread count and bell notifications. */
export async function markChannelThreadOpened(ctx: CorrespondenceContext, channelId: string, messageIds: readonly string[]): Promise<void> {
  const thread = await authorizedChannelThread(ctx, channelId)
  if (messageIds.length === 0) return
  const newest = await ctx.db.select({ id: messages.id, createdAt: messages.createdAt }).from(messages)
    .where(and(eq(messages.channelId, thread.id), inArray(messages.id, [...messageIds])))
    .orderBy(desc(messages.createdAt), desc(messages.id)).limit(1).get()
  if (!newest) throw new Error("Invalid visible message selection.")
  await markThreadsRead(ctx, [{ channelId: thread.id, messageId: newest.id, createdAt: newest.createdAt }])
}

/** Bulk Mark as read: authorize the whole selection, then read each conversation up to its newest message. */
export async function markChannelThreadsRead(ctx: CorrespondenceContext, channelIds: readonly string[]): Promise<void> {
  const allowed = new Set((await accessibleChannelThreads(ctx)).map((thread) => thread.id))
  if (channelIds.some((id) => !allowed.has(id))) throw new Error("Conversation not found.")
  const latest: { readonly channelId: string; readonly messageId: string; readonly createdAt: string }[] = []
  for (const ids of chunkD1Values(channelIds)) {
    latest.push(...await ctx.db.select({ channelId: messages.channelId, messageId: messages.id, createdAt: messages.createdAt }).from(messages)
      .where(and(inArray(messages.channelId, ids), sql`${messages.id} = (SELECT m.id FROM messages m WHERE m.channel_id = ${messages.channelId} ORDER BY m.created_at DESC, m.id DESC LIMIT 1)`)))
  }
  await markThreadsRead(ctx, latest)
}

async function markThreadsRead(ctx: CorrespondenceContext, reads: readonly { readonly channelId: string; readonly messageId: string; readonly createdAt: string }[]): Promise<void> {
  if (reads.length === 0) return
  const existing: { readonly id: string; readonly channelId: string }[] = []
  for (const ids of chunkD1Values(reads.map((read) => read.channelId))) {
    existing.push(...await ctx.db.select({ id: channelReadState.id, channelId: channelReadState.channelId }).from(channelReadState)
      .where(and(inArray(channelReadState.channelId, ids), eq(channelReadState.userId, ctx.user.id))))
  }
  const now = new Date().toISOString()
  await Promise.all(reads.map((read) => upsertChannelReadForUser(ctx.db, {
    existingId: existing.find((row) => row.channelId === read.channelId)?.id ?? null,
    channelId: read.channelId, userId: ctx.user.id, lastReadMessageId: read.messageId, lastReadAt: now,
  })))
  // Best effort, as in the chat: the read state above is what matters.
  await Promise.all(reads.map((read) => markChannelNotificationsRead(ctx.db, ctx.user.id, read.channelId, read.createdAt)))
    .catch((error: unknown) => console.error("channel_thread_notification_clear_failed", error instanceof Error ? error.message : error))
}

export type ChannelThreadSearchHit = {
  readonly conversationId: string
  readonly messageId: string
  readonly subject: string
  readonly excerpt: string
  readonly sentAt: string
  readonly sourceSentDisplay: string | null
  readonly sourceSentAt: string | null
}

/** Subject and message search across the viewer's imported conversations, newest first. */
export async function searchChannelThreads(ctx: CorrespondenceContext, term: string, filter: CorrespondenceInboxFilter | undefined): Promise<readonly ChannelThreadSearchHit[]> {
  // No saved or follow-up state is kept for channel conversations.
  if (filter === "saved" || filter === "follow-up" || filter === "drafts") return []
  const threads = (await accessibleChannelThreads(ctx)).filter((thread) =>
    (filter === undefined || filter === "sent" || (thread.archivedAt !== null) === (filter === "archived")) &&
    (filter !== "unread" || thread.unreadCount > 0))
  const hits: ChannelThreadSearchHit[] = []
  for (const ids of chunkD1Values(threads.map((thread) => thread.id))) {
    const rows = await ctx.db.select({ channelId: messages.channelId, subject: channels.name, id: messages.id, content: messages.content, createdAt: messages.createdAt, snapshot: messages.sourceSentAtSnapshot, sourceSystem: messages.sourceSystem })
      .from(messages).innerJoin(channels, eq(channels.id, messages.channelId))
      .where(and(inArray(messages.channelId, ids), isNull(messages.deletedAt),
        filter === "sent" ? and(eq(messages.userId, ctx.user.id), isNull(messages.sourceSystem)) : undefined,
        or(sql`instr(lower(${channels.name}), lower(${term})) > 0`, sql`instr(lower(${messages.content}), lower(${term})) > 0`)))
      .orderBy(desc(messages.createdAt)).limit(51)
    for (const row of rows) {
      const text = messageText(row)
      const start = Math.max(0, text.toLowerCase().indexOf(term.toLowerCase()) - 50)
      hits.push({
        conversationId: channelThreadConversationId(row.channelId), messageId: row.id, subject: row.subject,
        excerpt: `${start ? "…" : ""}${text.slice(start, start + EXCERPT_LENGTH)}`,
        sentAt: row.createdAt, sourceSentDisplay: row.snapshot, sourceSentAt: null,
      })
    }
  }
  return hits.sort((left, right) => right.sentAt.localeCompare(left.sentAt)).slice(0, 51)
}
