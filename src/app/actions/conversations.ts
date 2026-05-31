"use server"

import { getCloudflareContext } from "@/lib/db"
import { eq, and, sql } from "drizzle-orm"
import { getDb } from "@/db"
import {
  channels,
  channelMembers,
  channelReadState,
  type NewChannel,
  type NewChannelMember,
  type NewChannelReadState,
} from "@/db/schema-conversations"
import { users, organizationMembers } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"

export async function listChannels() {
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
          // if private, must be a member
          sql`(${channels.isPrivate} = 0 OR ${channelMembers.userId} IS NOT NULL)`,
          // not archived
          sql`${channels.archivedAt} IS NULL`
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

    // if private, check membership
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
      },
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to get channel",
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
