"use server"

import { and, eq, gt, inArray, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { projectMembers, users } from "@/db/schema"
import {
  channelMembers,
  channels,
  voiceParticipants,
  voiceSignals,
} from "@/db/schema-conversations"
import { getCloudflareContext } from "@/lib/db"
import { getCurrentUser, type AuthUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"
import { isInternalStaffRole } from "@/lib/user-roles"

const ACTIVE_PARTICIPANT_WINDOW_MS = 30_000
const STALE_SIGNAL_WINDOW_MS = 5 * 60_000

type VoiceSignalType = "offer" | "answer" | "ice"

export type VoiceParticipantData = {
  readonly userId: string
  readonly displayName: string | null
  readonly isMuted: boolean
  readonly isDeafened: boolean
  readonly joinedAt: string
  readonly lastSeenAt: string
}

export type VoiceSignalData = {
  readonly id: string
  readonly senderUserId: string
  readonly signalType: VoiceSignalType
  readonly payloadJson: string
  readonly createdAt: string
}

type VoiceChannelAccess = {
  readonly id: string
  readonly organizationId: string
  readonly projectId: string | null
  readonly isPrivate: boolean
  readonly audience: string
}

type VoiceActionResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string }

function activeAfterIso(now = Date.now()): string {
  return new Date(now - ACTIVE_PARTICIPANT_WINDOW_MS).toISOString()
}

function staleSignalBeforeIso(now = Date.now()): string {
  return new Date(now - STALE_SIGNAL_WINDOW_MS).toISOString()
}

function normalizeSignalType(value: string): VoiceSignalType | null {
  if (value === "offer" || value === "answer" || value === "ice") {
    return value
  }
  return null
}

function displayNameForUser(user: Pick<AuthUser, "displayName" | "email">): string {
  return user.displayName ?? user.email.split("@")[0] ?? "Compass user"
}

async function verifyVoiceChannelAccess(
  db: ReturnType<typeof getDb>,
  user: AuthUser,
  channelId: string
): Promise<VoiceChannelAccess | null> {
  const orgId = requireOrg(user)
  const channel = await db
    .select({
      id: channels.id,
      organizationId: channels.organizationId,
      projectId: channels.projectId,
      type: channels.type,
      isPrivate: channels.isPrivate,
      audience: channels.audience,
      archivedAt: channels.archivedAt,
    })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (
    !channel ||
    channel.organizationId !== orgId ||
    channel.type !== "voice" ||
    channel.archivedAt !== null
  ) {
    return null
  }

  const membership = await db
    .select({ id: channelMembers.id })
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, channelId),
        eq(channelMembers.userId, user.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (membership || can(user, "channels", "moderate")) {
    return channel
  }

  if (channel.isPrivate) {
    return null
  }

  if (channel.audience === "organization") {
    return channel
  }

  if (channel.audience === "staff" && isInternalStaffRole(user.role)) {
    return channel
  }

  const projectRoleCondition =
    channel.audience === "clients"
      ? eq(projectMembers.role, "owner")
      : inArray(projectMembers.role, ["supplier", "subcontractor"])

  const projectMembership = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.userId, user.id),
        projectRoleCondition,
        channel.projectId
          ? eq(projectMembers.projectId, channel.projectId)
          : undefined
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  return projectMembership ? channel : null
}

async function cleanupVoiceSession(
  db: ReturnType<typeof getDb>,
  channelId: string
): Promise<void> {
  const now = Date.now()
  await db
    .delete(voiceParticipants)
    .where(
      and(
        eq(voiceParticipants.channelId, channelId),
        sql`${voiceParticipants.lastSeenAt} < ${activeAfterIso(now)}`
      )
    )
  await db
    .delete(voiceSignals)
    .where(
      and(
        eq(voiceSignals.channelId, channelId),
        sql`${voiceSignals.createdAt} < ${staleSignalBeforeIso(now)}`
      )
    )
}

async function listActiveParticipants(
  db: ReturnType<typeof getDb>,
  channelId: string
): Promise<readonly VoiceParticipantData[]> {
  const rows = await db
    .select({
      userId: voiceParticipants.userId,
      displayName: voiceParticipants.displayName,
      userDisplayName: users.displayName,
      email: users.email,
      isMuted: voiceParticipants.isMuted,
      isDeafened: voiceParticipants.isDeafened,
      joinedAt: voiceParticipants.joinedAt,
      lastSeenAt: voiceParticipants.lastSeenAt,
    })
    .from(voiceParticipants)
    .leftJoin(users, eq(users.id, voiceParticipants.userId))
    .where(
      and(
        eq(voiceParticipants.channelId, channelId),
        gt(voiceParticipants.lastSeenAt, activeAfterIso())
      )
    )
    .orderBy(voiceParticipants.joinedAt)

  return rows.map((row) => ({
    userId: row.userId,
    displayName:
      row.displayName ?? row.userDisplayName ?? row.email?.split("@")[0] ?? null,
    isMuted: row.isMuted,
    isDeafened: row.isDeafened,
    joinedAt: row.joinedAt,
    lastSeenAt: row.lastSeenAt,
  }))
}

export async function joinVoiceSession(
  channelId: string,
  state?: { readonly isMuted?: boolean; readonly isDeafened?: boolean }
): Promise<
  VoiceActionResult<{
    readonly self: VoiceParticipantData
    readonly participants: readonly VoiceParticipantData[]
  }>
> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Unauthorized" }
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const channel = await verifyVoiceChannelAccess(db, user, channelId)
    if (!channel) return { success: false, error: "Voice channel not found" }

    const now = new Date().toISOString()
    await cleanupVoiceSession(db, channelId)
    await db
      .delete(voiceParticipants)
      .where(eq(voiceParticipants.userId, user.id))
    await db.insert(voiceParticipants).values({
      id: crypto.randomUUID(),
      channelId,
      userId: user.id,
      displayName: displayNameForUser(user),
      isMuted: state?.isMuted ?? false,
      isDeafened: state?.isDeafened ?? false,
      joinedAt: now,
      lastSeenAt: now,
    })

    const participants = await listActiveParticipants(db, channelId)
    const self = participants.find((participant) => participant.userId === user.id)
    if (!self) {
      return { success: false, error: "Failed to join voice channel" }
    }

    return { success: true, data: { self, participants } }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to join voice channel",
    }
  }
}

export async function leaveVoiceSession(
  channelId: string
): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Unauthorized" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const channel = await verifyVoiceChannelAccess(db, user, channelId)
    if (!channel) return { success: false, error: "Voice channel not found" }

    await db
      .delete(voiceParticipants)
      .where(
        and(
          eq(voiceParticipants.channelId, channelId),
          eq(voiceParticipants.userId, user.id)
        )
      )
    await db
      .delete(voiceSignals)
      .where(
        and(
          eq(voiceSignals.channelId, channelId),
          eq(voiceSignals.targetUserId, user.id)
        )
      )
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to leave voice channel",
    }
  }
}

export async function updateVoicePresence(
  channelId: string,
  state: { readonly isMuted: boolean; readonly isDeafened: boolean }
): Promise<VoiceActionResult<{ readonly participants: readonly VoiceParticipantData[] }>> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Unauthorized" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const channel = await verifyVoiceChannelAccess(db, user, channelId)
    if (!channel) return { success: false, error: "Voice channel not found" }

    await cleanupVoiceSession(db, channelId)
    await db
      .update(voiceParticipants)
      .set({
        isMuted: state.isMuted,
        isDeafened: state.isDeafened,
        lastSeenAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(voiceParticipants.channelId, channelId),
          eq(voiceParticipants.userId, user.id)
        )
      )

    return {
      success: true,
      data: { participants: await listActiveParticipants(db, channelId) },
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to update voice state",
    }
  }
}

export async function sendVoiceSignal(input: {
  readonly channelId: string
  readonly targetUserId: string
  readonly signalType: VoiceSignalType
  readonly payloadJson: string
}): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Unauthorized" }
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }

    const signalType = normalizeSignalType(input.signalType)
    if (!signalType) return { success: false, error: "Invalid signal type" }
    if (input.payloadJson.length > 64_000) {
      return { success: false, error: "Signal payload is too large" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const channel = await verifyVoiceChannelAccess(db, user, input.channelId)
    if (!channel) return { success: false, error: "Voice channel not found" }

    const target = await db
      .select({ id: voiceParticipants.id })
      .from(voiceParticipants)
      .where(
        and(
          eq(voiceParticipants.channelId, input.channelId),
          eq(voiceParticipants.userId, input.targetUserId),
          gt(voiceParticipants.lastSeenAt, activeAfterIso())
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!target) return { success: false, error: "Recipient is not in voice" }

    await db.insert(voiceSignals).values({
      id: crypto.randomUUID(),
      channelId: input.channelId,
      senderUserId: user.id,
      targetUserId: input.targetUserId,
      signalType,
      payloadJson: input.payloadJson,
      createdAt: new Date().toISOString(),
    })

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to send voice signal",
    }
  }
}

export async function pollVoiceSession(
  channelId: string,
  afterSignalCreatedAt?: string
): Promise<
  VoiceActionResult<{
    readonly participants: readonly VoiceParticipantData[]
    readonly signals: readonly VoiceSignalData[]
  }>
> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Unauthorized" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const channel = await verifyVoiceChannelAccess(db, user, channelId)
    if (!channel) return { success: false, error: "Voice channel not found" }

    await cleanupVoiceSession(db, channelId)
    await db
      .update(voiceParticipants)
      .set({ lastSeenAt: new Date().toISOString() })
      .where(
        and(
          eq(voiceParticipants.channelId, channelId),
          eq(voiceParticipants.userId, user.id)
        )
      )

    const signalRows = await db
      .select({
        id: voiceSignals.id,
        senderUserId: voiceSignals.senderUserId,
        signalType: voiceSignals.signalType,
        payloadJson: voiceSignals.payloadJson,
        createdAt: voiceSignals.createdAt,
      })
      .from(voiceSignals)
      .where(
        and(
          eq(voiceSignals.channelId, channelId),
          eq(voiceSignals.targetUserId, user.id),
          afterSignalCreatedAt
            ? gt(voiceSignals.createdAt, afterSignalCreatedAt)
            : undefined
        )
      )
      .orderBy(voiceSignals.createdAt)
      .limit(100)

    const signals: VoiceSignalData[] = []
    for (const row of signalRows) {
      const signalType = normalizeSignalType(row.signalType)
      if (signalType) {
        signals.push({
          id: row.id,
          senderUserId: row.senderUserId,
          signalType,
          payloadJson: row.payloadJson,
          createdAt: row.createdAt,
        })
      }
    }

    return {
      success: true,
      data: {
        participants: await listActiveParticipants(db, channelId),
        signals,
      },
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to poll voice channel",
    }
  }
}
