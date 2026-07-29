"use server"

import { getCloudflareContext } from "@/lib/db"
import { eq, and } from "drizzle-orm"
import { getDb } from "@/db"
import { userPresence, channelMembers } from "@/db/schema-conversations"
import { organizationMembers, users } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import {
  teamAvailabilityFromRows,
  type TeamAvailabilityMember,
} from "@/lib/dashboard/office-status"
import { requireOrg } from "@/lib/org-scope"
import { isInternalStaffRole } from "@/lib/user-roles"
import { recordActivityEvent } from "@/lib/activity-log"

export type PresenceStatus = "online" | "idle" | "dnd" | "offline"

export type CurrentUserPresence = {
  readonly status: PresenceStatus
  readonly statusMessage: string | null
}

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
  statusMessage?: string,
  observedActivity = false
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
          ...(observedActivity ? { lastActiveAt: now } : {}),
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
        lastActiveAt: observedActivity ? now : null,
        updatedAt: now,
      })
    }

    if (
      user.organizationId &&
      statusMessage !== undefined &&
      statusMessage !== existing?.statusMessage
    ) {
      await recordActivityEvent({
        db,
        organizationId: user.organizationId,
        actor: user,
        category: "presence",
        action: "presence.designation_changed",
        entityType: "user_presence",
        entityId: user.id,
        summary: `Changed work status to ${statusMessage}.`,
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
 * Read the current user's saved presence. The dashboard uses the status
 * message to restore the user's selected office location after a refresh.
 */
export async function getCurrentUserPresence(): Promise<
  | { success: true; data: CurrentUserPresence | null }
  | { success: false; error: string }
> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const presence = await db
      .select({
        status: userPresence.status,
        statusMessage: userPresence.statusMessage,
      })
      .from(userPresence)
      .where(eq(userPresence.userId, user.id))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!presence) {
      return { success: true, data: null }
    }

    const status = VALID_STATUSES.find((value) => value === presence.status)
    if (!status) {
      return { success: false, error: "Saved presence status is invalid" }
    }

    return {
      success: true,
      data: {
        status,
        statusMessage: presence.statusMessage,
      },
    }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to get current presence",
    }
  }
}

/**
 * Read the saved office availability for internal staff in the active
 * organization. This is intentionally separate from channel membership so
 * dashboard availability is shared across the whole company.
 */
export async function getOrganizationTeamAvailability(): Promise<
  | { success: true; data: readonly TeamAvailabilityMember[] }
  | { success: false; error: string }
> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }
    if (!isInternalStaffRole(user.role)) {
      return { success: false, error: "Access denied" }
    }

    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const rows = await db
      .select({
        userId: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        role: organizationMembers.role,
        statusMessage: userPresence.statusMessage,
        lastActiveAt: userPresence.lastActiveAt,
        updatedAt: userPresence.updatedAt,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(organizationMembers.userId, users.id))
      .leftJoin(userPresence, eq(users.id, userPresence.userId))
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(users.isActive, true)
        )
      )

    return {
      success: true,
      data: teamAvailabilityFromRows(rows, user.id),
    }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to get team availability",
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
