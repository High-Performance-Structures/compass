"use server"

import { getCloudflareContext } from "@/lib/db"
import { eq, and, sql, inArray } from "drizzle-orm"
import { getDb } from "@/db"
import { projectMembers } from "@/db/schema"
import {
  channels,
  channelMembers,
  channelReadState,
  messageAttachments,
  messageMentions,
  messageReactions,
  messages,
  typingSessions,
  type NewChannel,
  type NewChannelMember,
  type NewChannelReadState,
} from "@/db/schema-conversations"
import { getCurrentUser } from "@/lib/auth"
import { can, requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"

type ChannelAudience = "organization" | "staff" | "clients" | "sub_vendors"

function isStaffRole(role: string): boolean {
  return (
    role === "admin" ||
    role === "secondary_admin" ||
    role === "office" ||
    role === "field"
  )
}

function normalizeChannelAudience(value: string | null): ChannelAudience {
  if (value === "staff") return "staff"
  if (value === "clients") return "clients"
  if (value === "sub_vendors") return "sub_vendors"
  return "organization"
}

function audienceAccessSql(user: { readonly id: string; readonly role: string }) {
  const canSeeStaff = isStaffRole(user.role)
  return sql`(
    ${channels.audience} = 'organization'
    OR (${channels.audience} = 'staff' AND ${canSeeStaff})
    OR (
      ${channels.audience} = 'clients'
      AND EXISTS (
        SELECT 1
        FROM project_members
        WHERE project_members.user_id = ${user.id}
          AND project_members.role = 'owner'
          AND (${channels.projectId} IS NULL OR project_members.project_id = ${channels.projectId})
      )
    )
    OR (
      ${channels.audience} = 'sub_vendors'
      AND EXISTS (
        SELECT 1
        FROM project_members
        WHERE project_members.user_id = ${user.id}
          AND project_members.role IN ('supplier', 'subcontractor')
          AND (${channels.projectId} IS NULL OR project_members.project_id = ${channels.projectId})
      )
    )
  )`
}

async function canAccessChannelAudience(
  db: ReturnType<typeof getDb>,
  user: { readonly id: string; readonly role: string },
  channel: {
    readonly audience: string | null
    readonly projectId: string | null
  }
): Promise<boolean> {
  const audience = normalizeChannelAudience(channel.audience)
  if (audience === "organization") return true
  if (audience === "staff") return isStaffRole(user.role)

  const roleCondition =
    audience === "clients"
      ? eq(projectMembers.role, "owner")
      : inArray(projectMembers.role, ["supplier", "subcontractor"])

  const matchingMembership = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.userId, user.id),
        roleCondition,
        channel.projectId
          ? eq(projectMembers.projectId, channel.projectId)
          : undefined
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  return matchingMembership !== null
}

export async function listChannels(options?: {
  readonly includeArchived?: boolean
}) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // get all channels the user can access:
    // - public channels in their org
    // - private channels they're a member of
    const allChannels = await db
      .select({
        id: channels.id,
        name: channels.name,
        type: channels.type,
        description: channels.description,
        organizationId: channels.organizationId,
        projectId: channels.projectId,
        categoryId: channels.categoryId,
        isPrivate: channels.isPrivate,
        audience: channels.audience,
        sortOrder: channels.sortOrder,
        archivedAt: channels.archivedAt,
        createdAt: channels.createdAt,
        updatedAt: channels.updatedAt,
        memberRole: channelMembers.role,
        unreadCount: channelReadState.unreadCount,
      })
      .from(channels)
      .leftJoin(
        channelMembers,
        and(
          eq(channelMembers.channelId, channels.id),
          eq(channelMembers.userId, user.id)
        )
      )
      .leftJoin(
        channelReadState,
        and(
          eq(channelReadState.channelId, channels.id),
          eq(channelReadState.userId, user.id)
        )
      )
      .where(
        and(
          // must be in user's org
          eq(channels.organizationId, orgId),
          // private channels are member-only. public channels are audience-scoped.
          sql`(
            (${channels.isPrivate} = 1 AND ${channelMembers.userId} IS NOT NULL)
            OR (${channels.isPrivate} = 0 AND ${audienceAccessSql(user)})
          )`,
          // not archived
          options?.includeArchived ? undefined : sql`${channels.archivedAt} IS NULL`
        )
      )
      .orderBy(channels.sortOrder, channels.createdAt)

    return { success: true, data: allChannels }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to list channels",
    }
  }
}

export async function getChannel(channelId: string) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify user has access
    const channel = await db
      .select()
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!channel) {
      return { success: false, error: "Channel not found" }
    }

    const orgId = requireOrg(user)
    if (channel.organizationId !== orgId) {
      return { success: false, error: "Channel not found" }
    }

    // if private, check membership. otherwise enforce the channel audience.
    if (channel.isPrivate) {
      const membership = await db
        .select()
        .from(channelMembers)
        .where(
          and(
            eq(channelMembers.channelId, channelId),
            eq(channelMembers.userId, user.id)
          )
        )
        .limit(1)
        .then((rows) => rows[0] ?? null)

      if (!membership) {
        return { success: false, error: "Access denied" }
      }
    } else if (!(await canAccessChannelAudience(db, user, channel))) {
      return { success: false, error: "Access denied" }
    }

    // count members
    const memberCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(channelMembers)
      .where(eq(channelMembers.channelId, channelId))
      .then((rows) => rows[0]?.count ?? 0)

    return {
      success: true,
      data: {
        ...channel,
        memberCount,
        canUpdate: can(user, "channels", "update"),
        canDelete: can(user, "channels", "delete"),
      },
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to get channel",
    }
  }
}

export async function archiveChannel(channelId: string) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }

    requirePermission(user, "channels", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const channel = await db
      .select({
        id: channels.id,
        organizationId: channels.organizationId,
      })
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!channel || channel.organizationId !== orgId) {
      return { success: false, error: "Channel not found" }
    }

    const now = new Date().toISOString()
    await db
      .update(channels)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(channels.id, channelId))

    revalidatePath("/dashboard/conversations")
    revalidatePath(`/dashboard/conversations/${channelId}`)
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to archive channel",
    }
  }
}

export async function restoreChannel(channelId: string) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }

    requirePermission(user, "channels", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const channel = await db
      .select({
        id: channels.id,
        organizationId: channels.organizationId,
      })
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!channel || channel.organizationId !== orgId) {
      return { success: false, error: "Channel not found" }
    }

    const now = new Date().toISOString()
    await db
      .update(channels)
      .set({ archivedAt: null, updatedAt: now })
      .where(eq(channels.id, channelId))

    revalidatePath("/dashboard/conversations")
    revalidatePath(`/dashboard/conversations/${channelId}`)
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to restore channel",
    }
  }
}

export async function deleteChannel(channelId: string) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }

    requirePermission(user, "channels", "delete")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const channel = await db
      .select({
        id: channels.id,
        organizationId: channels.organizationId,
      })
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!channel || channel.organizationId !== orgId) {
      return { success: false, error: "Channel not found" }
    }

    const messageRows = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.channelId, channelId))
    const messageIds = messageRows.map((message) => message.id)

    if (messageIds.length > 0) {
      await db
        .delete(messageMentions)
        .where(inArray(messageMentions.messageId, messageIds))
      await db
        .delete(messageReactions)
        .where(inArray(messageReactions.messageId, messageIds))
      await db
        .delete(messageAttachments)
        .where(inArray(messageAttachments.messageId, messageIds))
      await db.delete(messages).where(eq(messages.channelId, channelId))
    }

    await db.delete(typingSessions).where(eq(typingSessions.channelId, channelId))
    await db
      .delete(channelReadState)
      .where(eq(channelReadState.channelId, channelId))
    await db.delete(channelMembers).where(eq(channelMembers.channelId, channelId))
    await db.delete(channels).where(eq(channels.id, channelId))

    revalidatePath("/dashboard/conversations")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete channel",
    }
  }
}

export async function createChannel(data: {
  name: string
  type: "text" | "voice" | "announcement"
  description?: string
  projectId?: string
  categoryId?: string | null
  isPrivate?: boolean
  audience?: ChannelAudience
}) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }

    // only office+ can create channels
    requirePermission(user, "channels", "create")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const now = new Date().toISOString()
    const channelId = crypto.randomUUID()

    const newChannel: NewChannel = {
      id: channelId,
      name: data.name,
      type: data.type,
      description: data.description ?? null,
      organizationId: orgId,
      projectId: data.projectId ?? null,
      categoryId: data.categoryId ?? null,
      isPrivate: data.isPrivate ?? false,
      audience: data.audience ?? "staff",
      createdBy: user.id,
      sortOrder: 0,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    }

    await db.insert(channels).values(newChannel)

    // add creator as owner
    const memberId = crypto.randomUUID()
    const newMember: NewChannelMember = {
      id: memberId,
      channelId,
      userId: user.id,
      role: "owner",
      notifyLevel: "all",
      joinedAt: now,
    }
    await db.insert(channelMembers).values(newMember)

    // initialize read state for creator
    const readStateId = crypto.randomUUID()
    const newReadState: NewChannelReadState = {
      id: readStateId,
      userId: user.id,
      channelId,
      lastReadMessageId: null,
      lastReadAt: now,
      unreadCount: 0,
    }
    await db.insert(channelReadState).values(newReadState)

    revalidatePath("/dashboard")
    return { success: true, data: { channelId } }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create channel",
    }
  }
}

export async function joinChannel(channelId: string) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify channel exists and is not private
    const channel = await db
      .select()
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!channel) {
      return { success: false, error: "Channel not found" }
    }

    const orgId = requireOrg(user)
    if (channel.organizationId !== orgId) {
      return { success: false, error: "Channel not found" }
    }

    if (channel.isPrivate) {
      return {
        success: false,
        error: "Cannot join private channel without invitation",
      }
    }

    // check if already a member
    const existing = await db
      .select()
      .from(channelMembers)
      .where(
        and(
          eq(channelMembers.channelId, channelId),
          eq(channelMembers.userId, user.id)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (existing) {
      return { success: false, error: "Already a member" }
    }

    const now = new Date().toISOString()
    const memberId = crypto.randomUUID()
    const newMember: NewChannelMember = {
      id: memberId,
      channelId,
      userId: user.id,
      role: "member",
      notifyLevel: "all",
      joinedAt: now,
    }
    await db.insert(channelMembers).values(newMember)

    // initialize read state
    const readStateId = crypto.randomUUID()
    const newReadState: NewChannelReadState = {
      id: readStateId,
      userId: user.id,
      channelId,
      lastReadMessageId: null,
      lastReadAt: now,
      unreadCount: 0,
    }
    await db.insert(channelReadState).values(newReadState)

    revalidatePath("/dashboard")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to join channel",
    }
  }
}

export async function leaveChannel(channelId: string) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // check current membership
    const membership = await db
      .select()
      .from(channelMembers)
      .where(
        and(
          eq(channelMembers.channelId, channelId),
          eq(channelMembers.userId, user.id)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!membership) {
      return { success: false, error: "Not a member of this channel" }
    }

    // if owner, check if there are other owners
    if (membership.role === "owner") {
      const ownerCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(channelMembers)
        .where(
          and(
            eq(channelMembers.channelId, channelId),
            eq(channelMembers.role, "owner")
          )
        )
        .then((rows) => rows[0]?.count ?? 0)

      if (ownerCount <= 1) {
        return {
          success: false,
          error: "Cannot leave - you are the last owner",
        }
      }
    }

    // remove membership and read state
    await db
      .delete(channelMembers)
      .where(
        and(
          eq(channelMembers.channelId, channelId),
          eq(channelMembers.userId, user.id)
        )
      )

    await db
      .delete(channelReadState)
      .where(
        and(
          eq(channelReadState.channelId, channelId),
          eq(channelReadState.userId, user.id)
        )
      )

    revalidatePath("/dashboard")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to leave channel",
    }
  }
}
