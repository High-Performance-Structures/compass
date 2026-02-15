"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { eq, and } from "drizzle-orm"
import { getDb } from "@/db"
import { userPresence, channelMembers, channels } from "@/db/schema-conversations"
import { users } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"

type PresenceStatus = "online" | "idle" | "dnd" | "offline"

const VALID_STATUSES = ["online", "idle", "dnd", "offline"] as const
const MAX_STATUS_LENGTH = 100

type ChannelMemberWithPresence = {
  id: string
  displayName: string | null
  avatarUrl: string | null
  role: string
  status: string
  statusMessage: string | null
  lastSeenAt: string
}

type GroupedMembers = {
  online: ChannelMemberWithPresence[]
  idle: ChannelMemberWithPresence[]
  dnd: ChannelMemberWithPresence[]
  offline: ChannelMemberWithPresence[]
}

/**
 * Update the current user's presence status.
 * Creates a new presence record or updates the existing one.
 */
export async function updatePresence(
  status?: PresenceStatus,
  statusMessage?: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    if (statusMessage && statusMessage.length > MAX_STATUS_LENGTH) {
      return { success: false, error: `Status message too long (max ${MAX_STATUS_LENGTH} characters)` }
    }

    const effectiveStatus = status ?? "online"
    if (!VALID_STATUSES.includes(effectiveStatus as typeof VALID_STATUSES[number])) {
      return { success: false, error: "Invalid status" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const now = new Date().toISOString()

    // check if presence record exists
    const existing = await db
      .select()
      .from(userPresence)
      .where(eq(userPresence.userId, user.id))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (existing) {
      // update existing record
      await db
        .update(userPresence)
        .set({
          status: effectiveStatus,
          statusMessage: statusMessage ?? existing.statusMessage,
          lastSeenAt: now,
          updatedAt: now,
        })
        .where(eq(userPresence.userId, user.id))
    } else {
      // create new presence record
      await db.insert(userPresence).values({
        id: crypto.randomUUID(),
        userId: user.id,
        status: effectiveStatus,
        statusMessage: statusMessage ?? null,
        lastSeenAt: now,
        updatedAt: now,
      })
    }

    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update presence",
    }
  }
}

/**
 * Get all members of a channel with their presence information.
 * Results are grouped by status for easy display.
 */
export async function getChannelMembersWithPresence(
  channelId: string
): Promise<
  { success: true; data: GroupedMembers } | { success: false; error: string }
> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify user is a member of this channel
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
      return {
        success: false,
        error: "Access denied - not a channel member",
      }
    }

    // fetch all channel members with their user info and presence
    const members = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        role: channelMembers.role,
        status: userPresence.status,
        statusMessage: userPresence.statusMessage,
        lastSeenAt: userPresence.lastSeenAt,
      })
      .from(channelMembers)
      .innerJoin(users, eq(channelMembers.userId, users.id))
      .leftJoin(userPresence, eq(users.id, userPresence.userId))
      .where(eq(channelMembers.channelId, channelId))

    // group members by status
    const grouped: GroupedMembers = {
      online: [],
      idle: [],
      dnd: [],
      offline: [],
    }

    for (const member of members) {
      const memberData: ChannelMemberWithPresence = {
        id: member.id,
        displayName: member.displayName,
        avatarUrl: member.avatarUrl,
        role: member.role,
        status: member.status ?? "offline",
        statusMessage: member.statusMessage,
        lastSeenAt: member.lastSeenAt ?? new Date(0).toISOString(),
      }

      // determine which group based on status
      const status = member.status ?? "offline"
      if (status === "online") {
        grouped.online.push(memberData)
      } else if (status === "idle") {
        grouped.idle.push(memberData)
      } else if (status === "dnd") {
        grouped.dnd.push(memberData)
      } else {
        grouped.offline.push(memberData)
      }
    }

    return { success: true, data: grouped }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to get channel members with presence",
    }
  }
}
