import { and, eq, inArray, sql } from "drizzle-orm"

import { getDb } from "@/db"
import { channelMembers, channelReadState, channelThreadUserState, channels, messages } from "@/db/schema-conversations"
import { getCurrentUser } from "@/lib/auth"
import { conversationRequestViewer } from "@/lib/conversations/preview-viewer"
import { getCloudflareContext } from "@/lib/db"
import { peopleView } from "@/lib/domain/identity/views"
import { requireOrg } from "@/lib/org-scope"
import { getProjectAudienceRequestScope } from "@/lib/project-audience-request-server"
import { isInternalStaffRole } from "@/lib/user-roles"

/*
 * One job's conversations for its Messages page "Conversations" tab: the
 * channels the viewer may open on that job, the job's own (non-imported)
 * conversations first, then newest activity first. Visibility matches the
 * conversation list in readVisibleChannels.
 */

const PROJECT_CONVERSATION_FILTERS = ["all", "unread", "staff", "owners", "vendors", "imported"] as const
export type ProjectConversationFilter = (typeof PROJECT_CONVERSATION_FILTERS)[number]

/** "mine": conversations the viewer is in; "global": every conversation on the job staff may open, like email's Global history. */
export type ProjectConversationScope = "mine" | "global"

const PROJECT_CONVERSATION_PAGE_SIZE = 25

export type ProjectConversationRow = {
  readonly id: string
  readonly name: string
  readonly audience: string
  readonly imported: boolean
  readonly unreadCount: number
  readonly lastActivityAt: string
  readonly lastSender: string | null
  readonly lastText: string | null
}

export type ProjectConversationPage = {
  readonly rows: readonly ProjectConversationRow[]
  readonly total: number
  readonly page: number
  readonly pageCount: number
  readonly scope: ProjectConversationScope
  readonly viewerIsInternal: boolean
}

export function projectConversationScope(value: string | undefined): ProjectConversationScope {
  return value === "global" ? "global" : "mine"
}

export function projectConversationFilter(value: string | undefined): ProjectConversationFilter {
  return PROJECT_CONVERSATION_FILTERS.find((filter) => filter === value) ?? "all"
}

const AUDIENCE_BY_FILTER: Partial<Record<ProjectConversationFilter, string>> = {
  staff: "staff",
  owners: "clients",
  vendors: "sub_vendors",
}

function previewText(content: string): string {
  // Imported email bodies quote whole earlier messages; the first line is enough.
  const firstLine = content.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? ""
  return firstLine.length > 140 ? `${firstLine.slice(0, 139)}…` : firstLine
}

export async function readProjectConversations(input: {
  readonly projectId: string
  readonly scope: ProjectConversationScope
  readonly filter: ProjectConversationFilter
  readonly search: string
  readonly page: number
}): Promise<{ success: true; data: ProjectConversationPage } | { success: false; error: string }> {
  try {
    const user = await conversationRequestViewer(await getCurrentUser())
    if (!user || !user.isActive) return { success: false, error: "Unauthorized" }
    const scope = await getProjectAudienceRequestScope()
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const viewerIsInternal = isInternalStaffRole(user.role)
    // Owners and vendors only ever see conversations they are in.
    const scopeMine = !viewerIsInternal || input.scope === "mine"

    const lastActivity = sql<string>`coalesce((SELECT max(m.created_at) FROM messages m WHERE m.channel_id = ${channels.id} AND m.deleted_at IS NULL), ${channels.createdAt})`
    const search = input.search.trim().toLowerCase()
    const audience = AUDIENCE_BY_FILTER[input.filter]
    const where = and(
      eq(channels.organizationId, orgId),
      eq(channels.projectId, input.projectId),
      sql`${channels.archivedAt} IS NULL`,
      scope ? eq(channels.audience, scope.audience === "owner" ? "clients" : "sub_vendors") : undefined,
      viewerIsInternal
        ? sql`(${channels.isPrivate} = 0 OR ${channelMembers.userId} IS NOT NULL)`
        : and(
            sql`${channelMembers.userId} IS NOT NULL`,
            sql`${channels.id} NOT LIKE 'bt-message-archive-%'`,
            sql`NOT (${channels.sourceSystem} IS NOT NULL AND EXISTS (SELECT 1 FROM projects p WHERE p.id = ${channels.projectId} AND p.imported_conversations_staff_only = 1))`
          ),
      scopeMine ? sql`${channelMembers.userId} IS NOT NULL` : undefined,
      audience ? eq(channels.audience, audience) : undefined,
      input.filter === "imported" ? sql`${channels.sourceSystem} IS NOT NULL` : undefined,
      input.filter === "unread" ? sql`coalesce(${channelReadState.unreadCount}, 0) > 0` : undefined,
      search
        ? sql`(lower(${channels.name}) LIKE ${`%${search}%`} OR EXISTS (SELECT 1 FROM messages m WHERE m.channel_id = ${channels.id} AND m.deleted_at IS NULL AND lower(m.content) LIKE ${`%${search}%`}))`
        : undefined
    )
    const base = () =>
      db
        .select({
          id: channels.id,
          name: channels.name,
          audience: channels.audience,
          sourceSystem: channels.sourceSystem,
          unreadCount: channelReadState.unreadCount,
          lastActivityAt: lastActivity,
        })
        .from(channels)
        .leftJoin(channelMembers, and(eq(channelMembers.channelId, channels.id), eq(channelMembers.userId, user.id)))
        .leftJoin(channelReadState, and(eq(channelReadState.channelId, channels.id), eq(channelReadState.userId, user.id)))
        .where(where)

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(channels)
      .leftJoin(channelMembers, and(eq(channelMembers.channelId, channels.id), eq(channelMembers.userId, user.id)))
      .leftJoin(channelReadState, and(eq(channelReadState.channelId, channels.id), eq(channelReadState.userId, user.id)))
      .where(where)
    const pageCount = Math.max(1, Math.ceil(total / PROJECT_CONVERSATION_PAGE_SIZE))
    const page = Math.min(Math.max(1, input.page), pageCount)
    const channelRows = await base()
      .orderBy(sql`CASE WHEN ${channels.sourceSystem} IS NULL THEN 0 ELSE 1 END`, sql`${lastActivity} DESC`)
      .limit(PROJECT_CONVERSATION_PAGE_SIZE)
      .offset((page - 1) * PROJECT_CONVERSATION_PAGE_SIZE)

    const ids = channelRows.map((row) => row.id)
    const sender = peopleView("sender")
    const latest = ids.length === 0
      ? []
      : await db
          .select({
            channelId: messages.channelId,
            content: messages.content,
            senderLabel: messages.sourceSenderLabelSnapshot,
            displayName: sender.displayName,
            firstName: sender.firstName,
            lastName: sender.lastName,
          })
          .from(messages)
          .leftJoin(sender, eq(sender.id, messages.userId))
          .where(and(
            inArray(messages.channelId, ids),
            sql`${messages.deletedAt} IS NULL`,
            sql`${messages.createdAt} = (SELECT max(m2.created_at) FROM messages m2 WHERE m2.channel_id = ${messages.channelId} AND m2.deleted_at IS NULL)`
          ))
    const latestByChannel = new Map(latest.map((row) => [row.channelId, row]))

    return {
      success: true,
      data: {
        rows: channelRows.map((row) => {
          const last = latestByChannel.get(row.id)
          const lastSender = last
            ? last.senderLabel ?? last.displayName ?? ([last.firstName, last.lastName].filter(Boolean).join(" ") || null)
            : null
          return {
            id: row.id,
            name: row.name,
            audience: row.audience,
            imported: row.sourceSystem !== null,
            unreadCount: row.unreadCount ?? 0,
            lastActivityAt: row.lastActivityAt,
            lastSender,
            lastText: last ? previewText(last.content) : null,
          }
        }),
        total,
        page,
        pageCount,
        scope: scopeMine ? "mine" : "global",
        viewerIsInternal,
      },
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to list conversations" }
  }
}

/**
 * How many of the job's conversations the viewer is in have unread messages,
 * for the Messages badge: one COUNT, with the conversation list's visibility
 * rules, leaving out conversations the viewer archived in the inbox.
 */
export async function countProjectConversationsUnread(input: {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly projectId: string
  readonly userId: string
  readonly viewerIsInternal: boolean
}): Promise<number> {
  const row = await input.db
    .select({ count: sql<number>`count(*)` })
    .from(channels)
    .innerJoin(channelMembers, and(eq(channelMembers.channelId, channels.id), eq(channelMembers.userId, input.userId)))
    .innerJoin(channelReadState, and(eq(channelReadState.channelId, channels.id), eq(channelReadState.userId, input.userId)))
    .leftJoin(channelThreadUserState, and(eq(channelThreadUserState.channelId, channels.id), eq(channelThreadUserState.userId, input.userId)))
    .where(and(
      eq(channels.organizationId, input.organizationId),
      eq(channels.projectId, input.projectId),
      sql`${channels.archivedAt} IS NULL`,
      sql`${channelReadState.unreadCount} > 0`,
      sql`${channelThreadUserState.archivedAt} IS NULL`,
      input.viewerIsInternal
        ? undefined
        : and(
            sql`${channels.id} NOT LIKE 'bt-message-archive-%'`,
            sql`NOT (${channels.sourceSystem} IS NOT NULL AND EXISTS (SELECT 1 FROM projects p WHERE p.id = ${channels.projectId} AND p.imported_conversations_staff_only = 1))`
          ),
    ))
    .get()
  return row?.count ?? 0
}

/**
 * The conversation half of the Messages badge when project email is off for
 * the job (or the viewer has no email inbox there, such as a demo user): the
 * signed-in viewer's own unread conversations on the job.
 */
export async function readProjectConversationsUnreadForViewer(projectId: string): Promise<number> {
  const user = await conversationRequestViewer(await getCurrentUser())
  if (!user || !user.isActive) return 0
  const { env } = await getCloudflareContext()
  return countProjectConversationsUnread({
    db: getDb(env.DB),
    organizationId: requireOrg(user),
    projectId,
    userId: user.id,
    viewerIsInternal: isInternalStaffRole(user.role),
  })
}
