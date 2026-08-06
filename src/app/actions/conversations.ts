"use server"

import { getCloudflareContext } from "@/lib/db"
import { eq, and, sql, ne, inArray } from "drizzle-orm"
import { getDb } from "@/db"
import {
  channels,
  channelMembers,
  channelReadState,
  type NewChannel,
  type NewChannelMember,
  type NewChannelReadState,
} from "@/db/schema-conversations"
import { organizationMembers, projects, users } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"
import { isInternalStaffRole } from "@/lib/user-roles"
import {
  directChannelId,
  directParticipantIds,
} from "@/lib/conversations/direct-channel"

async function ensureChannelMember(
  db: ReturnType<typeof getDb>,
  channelId: string,
  userId: string,
  now: string
): Promise<void> {
  const existingMember = await db
    .select({ id: channelMembers.id })
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, channelId),
        eq(channelMembers.userId, userId)
      )
    )
    .get()

  if (!existingMember) {
    await db.insert(channelMembers).values({
      id: crypto.randomUUID(),
      channelId,
      userId,
      role: "member",
      notifyLevel: "all",
      joinedAt: now,
    })
  }

  const existingReadState = await db
    .select({ id: channelReadState.id })
    .from(channelReadState)
    .where(
      and(
        eq(channelReadState.channelId, channelId),
        eq(channelReadState.userId, userId)
      )
    )
    .get()

  if (!existingReadState) {
    await db.insert(channelReadState).values({
      id: crypto.randomUUID(),
      channelId,
      userId,
      lastReadMessageId: null,
      lastReadAt: now,
      unreadCount: 0,
    })
  }
}

export async function listDirectMessageRecipients() {
  try {
    const user = await getCurrentUser()
    if (!user || !isInternalStaffRole(user.role)) {
      return { success: false, error: "Only staff can start direct messages" }
    }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const rows = await db
      .select({
        id: users.id,
        name: users.displayName,
        email: users.email,
        avatarUrl: users.avatarUrl,
        role: organizationMembers.role,
      })
      .from(users)
      .innerJoin(
        organizationMembers,
        and(
          eq(organizationMembers.userId, users.id),
          eq(organizationMembers.organizationId, organizationId)
        )
      )
      .where(and(ne(users.id, user.id), eq(users.isActive, true)))
      .orderBy(users.displayName, users.email)

    return {
      success: true,
      data: rows
        .filter((row) => isInternalStaffRole(row.role))
        .map((row) => ({
          id: row.id,
          name: row.name ?? row.email,
          email: row.email,
          avatarUrl: row.avatarUrl,
        })),
    }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to load direct message recipients",
    }
  }
}

export async function createDirectMessage(targetUserIds: readonly string[]) {
  try {
    const user = await getCurrentUser()
    if (!user || !isInternalStaffRole(user.role)) {
      return { success: false, error: "Only staff can start direct messages" }
    }
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    const requestedTargetIds = Array.from(
      new Set(targetUserIds.filter((targetUserId) => targetUserId !== user.id))
    )
    if (requestedTargetIds.length === 0) {
      return { success: false, error: "Choose at least one team member" }
    }
    if (requestedTargetIds.length > 20) {
      return { success: false, error: "Choose no more than 20 team members" }
    }

    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const targets = await db
      .select({
        id: users.id,
        name: users.displayName,
        email: users.email,
        role: organizationMembers.role,
      })
      .from(users)
      .innerJoin(
        organizationMembers,
        and(
          eq(organizationMembers.userId, users.id),
          eq(organizationMembers.organizationId, organizationId)
        )
      )
      .where(
        and(inArray(users.id, requestedTargetIds), eq(users.isActive, true))
      )

    if (
      targets.length !== requestedTargetIds.length ||
      targets.some((target) => !isInternalStaffRole(target.role))
    ) {
      return { success: false, error: "One or more team members were not found" }
    }

    const participantIds = directParticipantIds(user.id, requestedTargetIds)
    const channelId = await directChannelId(organizationId, participantIds)
    const now = new Date().toISOString()
    const existingChannel = await db
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.id, channelId))
      .get()

    if (!existingChannel) {
      const participantNames = [
        user.displayName ?? user.email,
        ...targets.map((target) => target.name ?? target.email),
      ].sort((first, second) => first.localeCompare(second))
      await db.insert(channels).values({
        id: channelId,
        name: participantNames.join(" · "),
        type: "text",
        description:
          participantIds.length === 2
            ? "Private direct message"
            : "Private group message",
        organizationId,
        projectId: null,
        categoryId: null,
        isPrivate: true,
        audience: "direct",
        createdBy: user.id,
        sortOrder: 0,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      })
    }

    for (const participantId of participantIds) {
      await ensureChannelMember(db, channelId, participantId, now)
    }

    revalidatePath("/dashboard/conversations")
    return { success: true, data: { channelId } }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to start direct message",
    }
  }
}

export async function listChannels() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const viewerIsInternal = isInternalStaffRole(user.role)

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
          // External project users only discover conversations they belong to.
          viewerIsInternal
            ? sql`(${channels.isPrivate} = 0 OR ${channelMembers.userId} IS NOT NULL)`
            : sql`${channelMembers.userId} IS NOT NULL`,
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

    if (
      (channel.isPrivate || !isInternalStaffRole(user.role)) &&
      !membership
    ) {
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
    if (!isInternalStaffRole(user.role)) {
      return { success: false, error: "Only staff can create channels" }
    }
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    if (data.projectId) {
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, data.projectId),
            eq(projects.organizationId, orgId)
          )
        )
        .limit(1)
      if (!project) {
        return { success: false, error: "Project not found" }
      }
    }

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
    if (!isInternalStaffRole(user.role)) {
      return {
        success: false,
        error: "Project partners join conversations through their project team.",
      }
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
