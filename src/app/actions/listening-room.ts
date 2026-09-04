"use server"

import { and, asc, eq, gt, isNull, ne, or, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"
import { getDb } from "@/db"
import { users } from "@/db/schema"
import {
  listeningQueueItems,
  listeningRoomParticipants,
  listeningRooms,
  listeningTrackLinks,
} from "@/db/schema-conversations"
import { getCurrentUser, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import {
  LISTENING_ROOM_START_DELAY_MS,
  MUSIC_PROVIDERS,
  canManageListeningTrackLink,
  isMusicProvider,
  listeningPlaybackPositionMs,
  musicProviderFromUrl,
  normalizeMusicUrl,
  type ListeningPlaybackState,
  type MusicProvider,
} from "@/lib/listening-room"
import { can } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"
import {
  getVoiceChannelAccess,
  type VoiceChannelAccess,
} from "@/lib/voice-channel-access"

const channelIdSchema = z.string().trim().min(1).max(200)
const musicProviderSchema = z.enum(MUSIC_PROVIDERS)
const addTrackSchema = z.object({
  channelId: channelIdSchema,
  title: z.string().trim().min(1).max(160),
  artist: z.string().trim().max(160).optional(),
  url: z.string().trim().max(2_048).optional(),
})
const addTrackLinkSchema = z.object({
  channelId: channelIdSchema,
  queueItemId: z.string().trim().min(1).max(200),
  url: z.string().trim().min(1).max(2_048),
})

type ListeningActionResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string }

export type ListeningRoomSyncAuthorization = {
  readonly roomId: string
  readonly userId: string
}

export type ListeningTrackLinkData = {
  readonly id: string
  readonly provider: MusicProvider
  readonly url: string
  readonly addedBy: string
}

export type ListeningQueueItemData = {
  readonly id: string
  readonly title: string
  readonly artist: string | null
  readonly durationMs: number | null
  readonly sortOrder: number
  readonly addedBy: string
  readonly addedByName: string
  readonly playedAt: string | null
  readonly links: readonly ListeningTrackLinkData[]
}

export type ListeningParticipantData = {
  readonly userId: string
  readonly displayName: string
  readonly preferredProvider: MusicProvider | null
}

export type ListeningRoomSnapshot = {
  readonly id: string
  readonly channelId: string
  readonly hostUserId: string
  readonly hostDisplayName: string
  readonly playbackState: ListeningPlaybackState
  readonly currentTrackId: string | null
  readonly anchorPositionMs: number
  readonly playbackStartedAt: string | null
  readonly positionMs: number
  readonly serverTime: string
  readonly queue: readonly ListeningQueueItemData[]
  readonly participants: readonly ListeningParticipantData[]
  readonly currentUserId: string
  readonly currentUserJoined: boolean
  readonly canControl: boolean
  readonly canModerate: boolean
}

type ListeningContext = {
  readonly db: ReturnType<typeof getDb>
  readonly user: AuthUser
  readonly channel: VoiceChannelAccess
}

function actionError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function playbackState(value: string): ListeningPlaybackState {
  return value === "playing" ? "playing" : "paused"
}

function displayName(input: {
  readonly displayName: string | null
  readonly email: string | null
}): string {
  return input.displayName ?? input.email?.split("@")[0] ?? "Compass user"
}

async function listeningContext(
  channelId: string,
  options?: { readonly write?: boolean; readonly create?: boolean }
): Promise<ListeningContext> {
  const user = await getCurrentUser()
  if (!user || !can(user, "channels", "read")) {
    throw new Error("Unauthorized")
  }
  if (!isInternalStaffRole(user.role)) {
    throw new Error("Listening rooms are available to internal staff only")
  }
  if (options?.write && isDemoUser(user.id)) {
    throw new Error("DEMO_READ_ONLY")
  }
  if (options?.create && !can(user, "channels", "create")) {
    throw new Error("You do not have permission to start a listening room")
  }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const channel = await getVoiceChannelAccess(db, user, channelId)
  if (!channel) throw new Error("Voice channel not found")

  return { db, user, channel }
}

async function roomForChannel(
  db: ReturnType<typeof getDb>,
  channelId: string
) {
  return db
    .select()
    .from(listeningRooms)
    .where(eq(listeningRooms.channelId, channelId))
    .get()
}

export async function authorizeListeningRoomSync(
  channelId: string
): Promise<ListeningActionResult<ListeningRoomSyncAuthorization>> {
  try {
    const parsed = channelIdSchema.safeParse(channelId)
    if (!parsed.success) return { success: false, error: "Invalid channel" }
    const context = await listeningContext(parsed.data)
    const room = await roomForChannel(context.db, context.channel.id)
    if (!room) return { success: false, error: "Listening room not found" }
    const participant = await context.db
      .select({ id: listeningRoomParticipants.id })
      .from(listeningRoomParticipants)
      .where(
        and(
          eq(listeningRoomParticipants.roomId, room.id),
          eq(listeningRoomParticipants.userId, context.user.id)
        )
      )
      .get()
    if (!participant) {
      return { success: false, error: "Join the listening room first" }
    }
    return {
      success: true,
      data: {
        roomId: room.id,
        userId: context.user.id,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: actionError(error, "Unable to authorize listening room"),
    }
  }
}

async function roomSnapshot(
  context: ListeningContext
): Promise<ListeningRoomSnapshot | null> {
  const room = await roomForChannel(context.db, context.channel.id)
  if (!room) return null

  const [queueRows, linkRows, participantRows, host] = await Promise.all([
    context.db
      .select({
        id: listeningQueueItems.id,
        title: listeningQueueItems.title,
        artist: listeningQueueItems.artist,
        durationMs: listeningQueueItems.durationMs,
        sortOrder: listeningQueueItems.sortOrder,
        addedBy: listeningQueueItems.addedBy,
        addedByDisplayName: users.displayName,
        addedByEmail: users.email,
        playedAt: listeningQueueItems.playedAt,
      })
      .from(listeningQueueItems)
      .leftJoin(users, eq(users.id, listeningQueueItems.addedBy))
      .where(eq(listeningQueueItems.roomId, room.id))
      .orderBy(
        asc(listeningQueueItems.sortOrder),
        asc(listeningQueueItems.createdAt),
        asc(listeningQueueItems.id)
      ),
    context.db
      .select({
        id: listeningTrackLinks.id,
        queueItemId: listeningTrackLinks.queueItemId,
        provider: listeningTrackLinks.provider,
        url: listeningTrackLinks.url,
        addedBy: listeningTrackLinks.addedBy,
      })
      .from(listeningTrackLinks)
      .innerJoin(
        listeningQueueItems,
        eq(listeningQueueItems.id, listeningTrackLinks.queueItemId)
      )
      .where(eq(listeningQueueItems.roomId, room.id)),
    context.db
      .select({
        userId: listeningRoomParticipants.userId,
        preferredProvider: listeningRoomParticipants.preferredProvider,
        displayName: users.displayName,
        email: users.email,
      })
      .from(listeningRoomParticipants)
      .leftJoin(users, eq(users.id, listeningRoomParticipants.userId))
      .where(eq(listeningRoomParticipants.roomId, room.id))
      .orderBy(asc(listeningRoomParticipants.joinedAt)),
    context.db
      .select({ displayName: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, room.hostUserId))
      .get(),
  ])

  const linksByItem = new Map<string, ListeningTrackLinkData[]>()
  for (const row of linkRows) {
    if (!isMusicProvider(row.provider)) continue
    const links = linksByItem.get(row.queueItemId) ?? []
    links.push({
      id: row.id,
      provider: row.provider,
      url: row.url,
      addedBy: row.addedBy,
    })
    linksByItem.set(row.queueItemId, links)
  }

  const queue: ListeningQueueItemData[] = queueRows.map((row) => ({
    id: row.id,
    title: row.title,
    artist: row.artist,
    durationMs: row.durationMs,
    sortOrder: row.sortOrder,
    addedBy: row.addedBy,
    addedByName: displayName({
      displayName: row.addedByDisplayName,
      email: row.addedByEmail,
    }),
    playedAt: row.playedAt,
    links: linksByItem.get(row.id) ?? [],
  }))
  const participants: ListeningParticipantData[] = participantRows.map(
    (row) => ({
      userId: row.userId,
      displayName: displayName(row),
      preferredProvider:
        row.preferredProvider && isMusicProvider(row.preferredProvider)
          ? row.preferredProvider
          : null,
    })
  )
  const state = playbackState(room.playbackState)
  const serverTime = new Date().toISOString()
  const canModerate = can(context.user, "channels", "moderate")

  return {
    id: room.id,
    channelId: room.channelId,
    hostUserId: room.hostUserId,
    hostDisplayName: host ? displayName(host) : "Compass user",
    playbackState: state,
    currentTrackId: room.currentTrackId,
    anchorPositionMs: room.anchorPositionMs,
    playbackStartedAt: room.playbackStartedAt,
    positionMs: listeningPlaybackPositionMs({
      state,
      anchorPositionMs: room.anchorPositionMs,
      playbackStartedAt: room.playbackStartedAt,
      nowMs: Date.parse(serverTime),
    }),
    serverTime,
    queue,
    participants,
    currentUserId: context.user.id,
    currentUserJoined: participants.some(
      (participant) => participant.userId === context.user.id
    ),
    canControl: room.hostUserId === context.user.id || canModerate,
    canModerate,
  }
}

async function requiredRoomSnapshot(
  context: ListeningContext
): Promise<ListeningActionResult<ListeningRoomSnapshot>> {
  const data = await roomSnapshot(context)
  return data
    ? { success: true, data }
    : { success: false, error: "Listening room not found" }
}

function revalidateListeningRoom(channelId: string): void {
  revalidatePath(`/dashboard/conversations/${channelId}`)
}

export async function getListeningRoom(
  channelId: string
): Promise<ListeningActionResult<{ readonly room: ListeningRoomSnapshot | null }>> {
  try {
    const parsed = channelIdSchema.safeParse(channelId)
    if (!parsed.success) return { success: false, error: "Invalid channel" }
    const context = await listeningContext(parsed.data)
    return { success: true, data: { room: await roomSnapshot(context) } }
  } catch (error) {
    return { success: false, error: actionError(error, "Failed to load listening room") }
  }
}

export async function startListeningRoom(
  channelId: string
): Promise<ListeningActionResult<ListeningRoomSnapshot>> {
  try {
    const parsed = channelIdSchema.safeParse(channelId)
    if (!parsed.success) return { success: false, error: "Invalid channel" }
    const context = await listeningContext(parsed.data, {
      write: true,
      create: true,
    })
    const now = new Date().toISOString()
    const roomId = crypto.randomUUID()
    await context.db
      .insert(listeningRooms)
      .values({
        id: roomId,
        channelId: context.channel.id,
        hostUserId: context.user.id,
        playbackState: "paused",
        currentTrackId: null,
        anchorPositionMs: 0,
        playbackStartedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: listeningRooms.channelId })
    const room = await roomForChannel(context.db, context.channel.id)
    if (!room) return { success: false, error: "Failed to start listening room" }
    await context.db
      .insert(listeningRoomParticipants)
      .values({
        id: crypto.randomUUID(),
        roomId: room.id,
        userId: context.user.id,
        preferredProvider: null,
        joinedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          listeningRoomParticipants.roomId,
          listeningRoomParticipants.userId,
        ],
        set: { updatedAt: now },
      })
    revalidateListeningRoom(context.channel.id)
    return requiredRoomSnapshot(context)
  } catch (error) {
    return { success: false, error: actionError(error, "Failed to start listening room") }
  }
}

export async function joinListeningRoom(input: {
  readonly channelId: string
  readonly preferredProvider: MusicProvider | null
}): Promise<ListeningActionResult<ListeningRoomSnapshot>> {
  try {
    const channelId = channelIdSchema.safeParse(input.channelId)
    const provider = input.preferredProvider === null
      ? null
      : musicProviderSchema.safeParse(input.preferredProvider)
    if (!channelId.success || (provider !== null && !provider.success)) {
      return { success: false, error: "Invalid listening preference" }
    }
    const context = await listeningContext(channelId.data, { write: true })
    const room = await roomForChannel(context.db, context.channel.id)
    if (!room) return { success: false, error: "Listening room not found" }
    const now = new Date().toISOString()
    await context.db
      .insert(listeningRoomParticipants)
      .values({
        id: crypto.randomUUID(),
        roomId: room.id,
        userId: context.user.id,
        preferredProvider: provider === null ? null : provider.data,
        joinedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          listeningRoomParticipants.roomId,
          listeningRoomParticipants.userId,
        ],
        set: {
          preferredProvider: provider === null ? null : provider.data,
          updatedAt: now,
        },
      })
    return requiredRoomSnapshot(context)
  } catch (error) {
    return { success: false, error: actionError(error, "Failed to join listening room") }
  }
}

export async function leaveListeningRoom(
  channelId: string
): Promise<ListeningActionResult<{ readonly room: ListeningRoomSnapshot | null }>> {
  try {
    const parsed = channelIdSchema.safeParse(channelId)
    if (!parsed.success) return { success: false, error: "Invalid channel" }
    const context = await listeningContext(parsed.data, { write: true })
    const room = await roomForChannel(context.db, context.channel.id)
    if (!room) return { success: true, data: { room: null } }
    await context.db
      .delete(listeningRoomParticipants)
      .where(
        and(
          eq(listeningRoomParticipants.roomId, room.id),
          eq(listeningRoomParticipants.userId, context.user.id)
        )
      )
    return { success: true, data: { room: await roomSnapshot(context) } }
  } catch (error) {
    return { success: false, error: actionError(error, "Failed to leave listening room") }
  }
}

export async function addListeningTrack(input: {
  readonly channelId: string
  readonly title: string
  readonly artist?: string
  readonly url?: string
}): Promise<ListeningActionResult<ListeningRoomSnapshot>> {
  try {
    const parsed = addTrackSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: "Enter a track title" }
    const suppliedUrl = parsed.data.url?.trim() || null
    const normalizedUrl = suppliedUrl ? normalizeMusicUrl(suppliedUrl) : null
    const provider = suppliedUrl ? musicProviderFromUrl(suppliedUrl) : null
    if (suppliedUrl && (!normalizedUrl || !provider)) {
      return { success: false, error: "Use an http or https music link" }
    }
    const context = await listeningContext(parsed.data.channelId, { write: true })
    const room = await roomForChannel(context.db, context.channel.id)
    if (!room) return { success: false, error: "Listening room not found" }
    const row = await context.db
      .select({ maxSortOrder: sql<number>`coalesce(max(${listeningQueueItems.sortOrder}), -1)` })
      .from(listeningQueueItems)
      .where(eq(listeningQueueItems.roomId, room.id))
      .get()
    const now = new Date().toISOString()
    const queueItemId = crypto.randomUUID()
    await context.db.insert(listeningQueueItems).values({
      id: queueItemId,
      roomId: room.id,
      title: parsed.data.title,
      artist: parsed.data.artist?.trim() || null,
      durationMs: null,
      sortOrder: (row?.maxSortOrder ?? -1) + 1,
      addedBy: context.user.id,
      playedAt: null,
      createdAt: now,
    })
    if (normalizedUrl && provider) {
      await context.db.insert(listeningTrackLinks).values({
        id: crypto.randomUUID(),
        queueItemId,
        provider,
        url: normalizedUrl,
        addedBy: context.user.id,
        createdAt: now,
      })
    }
    await context.db
      .insert(listeningRoomParticipants)
      .values({
        id: crypto.randomUUID(),
        roomId: room.id,
        userId: context.user.id,
        preferredProvider: provider,
        joinedAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
    if (!room.currentTrackId) {
      await context.db
        .update(listeningRooms)
        .set({ currentTrackId: queueItemId, updatedAt: now })
        .where(eq(listeningRooms.id, room.id))
    }
    revalidateListeningRoom(context.channel.id)
    return requiredRoomSnapshot(context)
  } catch (error) {
    return { success: false, error: actionError(error, "Failed to add track") }
  }
}

export async function addListeningTrackLink(input: {
  readonly channelId: string
  readonly queueItemId: string
  readonly url: string
}): Promise<ListeningActionResult<ListeningRoomSnapshot>> {
  try {
    const parsed = addTrackLinkSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: "Enter a valid music link" }
    const normalizedUrl = normalizeMusicUrl(parsed.data.url)
    const provider = musicProviderFromUrl(parsed.data.url)
    if (!normalizedUrl || !provider) {
      return { success: false, error: "Use an http or https music link" }
    }
    const context = await listeningContext(parsed.data.channelId, { write: true })
    const room = await roomForChannel(context.db, context.channel.id)
    if (!room) return { success: false, error: "Listening room not found" }
    const participant = await context.db
      .select({ id: listeningRoomParticipants.id })
      .from(listeningRoomParticipants)
      .where(
        and(
          eq(listeningRoomParticipants.roomId, room.id),
          eq(listeningRoomParticipants.userId, context.user.id)
        )
      )
      .get()
    if (!participant) {
      return { success: false, error: "Join the listening room to add service links" }
    }
    const item = await context.db
      .select({
        id: listeningQueueItems.id,
        addedBy: listeningQueueItems.addedBy,
      })
      .from(listeningQueueItems)
      .where(
        and(
          eq(listeningQueueItems.id, parsed.data.queueItemId),
          eq(listeningQueueItems.roomId, room.id)
        )
      )
      .get()
    if (!item) return { success: false, error: "Track not found" }
    const existingLink = await context.db
      .select({
        id: listeningTrackLinks.id,
        addedBy: listeningTrackLinks.addedBy,
      })
      .from(listeningTrackLinks)
      .where(
        and(
          eq(listeningTrackLinks.queueItemId, item.id),
          eq(listeningTrackLinks.provider, provider)
        )
      )
      .get()
    if (
      existingLink &&
      !canManageListeningTrackLink({
        currentUserId: context.user.id,
        trackAddedBy: item.addedBy,
        linkAddedBy: existingLink.addedBy,
        hostUserId: room.hostUserId,
        canModerate: can(context.user, "channels", "moderate"),
      })
    ) {
      return {
        success: false,
        error: `This track already has a ${provider.replaceAll("_", " ")} link`,
      }
    }
    const now = new Date().toISOString()
    if (existingLink) {
      await context.db
        .update(listeningTrackLinks)
        .set({ url: normalizedUrl, addedBy: context.user.id, createdAt: now })
        .where(eq(listeningTrackLinks.id, existingLink.id))
    } else {
      const linkId = crypto.randomUUID()
      await context.db.insert(listeningTrackLinks).values({
        id: linkId,
        queueItemId: item.id,
        provider,
        url: normalizedUrl,
        addedBy: context.user.id,
        createdAt: now,
      })
      .onConflictDoNothing({
        target: [listeningTrackLinks.queueItemId, listeningTrackLinks.provider],
      })
      const inserted = await context.db
        .select({ id: listeningTrackLinks.id })
        .from(listeningTrackLinks)
        .where(eq(listeningTrackLinks.id, linkId))
        .get()
      if (!inserted) {
        return {
          success: false,
          error: "Another listener added this service link. Refresh and try again.",
        }
      }
    }
    revalidateListeningRoom(context.channel.id)
    return requiredRoomSnapshot(context)
  } catch (error) {
    return { success: false, error: actionError(error, "Failed to add service link") }
  }
}

export async function removeListeningTrackLink(input: {
  readonly channelId: string
  readonly linkId: string
}): Promise<ListeningActionResult<ListeningRoomSnapshot>> {
  try {
    const channelId = channelIdSchema.safeParse(input.channelId)
    const linkId = z.string().min(1).max(200).safeParse(input.linkId)
    if (!channelId.success || !linkId.success) return { success: false, error: "Invalid link" }
    const context = await listeningContext(channelId.data, { write: true })
    const room = await roomForChannel(context.db, context.channel.id)
    if (!room) return { success: false, error: "Listening room not found" }
    const link = await context.db
      .select({
        id: listeningTrackLinks.id,
        addedBy: listeningTrackLinks.addedBy,
        queueItemId: listeningTrackLinks.queueItemId,
        trackAddedBy: listeningQueueItems.addedBy,
      })
      .from(listeningTrackLinks)
      .innerJoin(
        listeningQueueItems,
        eq(listeningQueueItems.id, listeningTrackLinks.queueItemId)
      )
      .where(
        and(
          eq(listeningTrackLinks.id, linkId.data),
          eq(listeningQueueItems.roomId, room.id)
        )
      )
      .get()
    if (!link) return { success: false, error: "Link not found" }
    const canRemove =
      link.addedBy === context.user.id ||
      link.trackAddedBy === context.user.id ||
      room.hostUserId === context.user.id ||
      can(context.user, "channels", "moderate")
    if (!canRemove) return { success: false, error: "You cannot remove this link" }
    const linkCount = await context.db
      .select({ count: sql<number>`count(*)` })
      .from(listeningTrackLinks)
      .where(eq(listeningTrackLinks.queueItemId, link.queueItemId))
      .get()
    if ((linkCount?.count ?? 0) <= 1) {
      return { success: false, error: "A track must keep at least one service link" }
    }
    await context.db
      .delete(listeningTrackLinks)
      .where(eq(listeningTrackLinks.id, link.id))
    return requiredRoomSnapshot(context)
  } catch (error) {
    return { success: false, error: actionError(error, "Failed to remove service link") }
  }
}

export async function setListeningPlayback(input: {
  readonly channelId: string
  readonly command: "play" | "pause" | "skip" | "restart"
}): Promise<ListeningActionResult<ListeningRoomSnapshot>> {
  try {
    const parsed = z.object({
      channelId: channelIdSchema,
      command: z.enum(["play", "pause", "skip", "restart"]),
    }).safeParse(input)
    if (!parsed.success) return { success: false, error: "Invalid playback command" }
    const context = await listeningContext(parsed.data.channelId, { write: true })
    const room = await roomForChannel(context.db, context.channel.id)
    if (!room) return { success: false, error: "Listening room not found" }
    if (
      room.hostUserId !== context.user.id &&
      !can(context.user, "channels", "moderate")
    ) {
      return { success: false, error: "Only the room host can control playback" }
    }
    const nowMs = Date.now()
    const now = new Date(nowMs).toISOString()
    const scheduledStart = new Date(
      nowMs + LISTENING_ROOM_START_DELAY_MS
    ).toISOString()
    if (parsed.data.command === "pause") {
      const positionMs = listeningPlaybackPositionMs({
        state: playbackState(room.playbackState),
        anchorPositionMs: room.anchorPositionMs,
        playbackStartedAt: room.playbackStartedAt,
        nowMs: Date.parse(now),
      })
      await context.db.update(listeningRooms).set({
        playbackState: "paused",
        anchorPositionMs: positionMs,
        playbackStartedAt: null,
        updatedAt: now,
      }).where(eq(listeningRooms.id, room.id))
    } else if (parsed.data.command === "restart") {
      await context.db.update(listeningRooms).set({
        anchorPositionMs: 0,
        playbackStartedAt:
          room.playbackState === "playing" ? scheduledStart : null,
        updatedAt: now,
      }).where(eq(listeningRooms.id, room.id))
    } else if (parsed.data.command === "skip") {
      const current = room.currentTrackId
        ? await context.db
            .select({
              id: listeningQueueItems.id,
              sortOrder: listeningQueueItems.sortOrder,
              createdAt: listeningQueueItems.createdAt,
            })
            .from(listeningQueueItems)
            .where(
              and(
                eq(listeningQueueItems.id, room.currentTrackId),
                eq(listeningQueueItems.roomId, room.id)
              )
            )
            .get()
        : null
      if (room.currentTrackId) {
        await context.db
          .update(listeningQueueItems)
          .set({ playedAt: now })
          .where(eq(listeningQueueItems.id, room.currentTrackId))
      }
      const next = await context.db
        .select({ id: listeningQueueItems.id })
        .from(listeningQueueItems)
        .where(
          and(
            eq(listeningQueueItems.roomId, room.id),
            isNull(listeningQueueItems.playedAt),
            current
              ? or(
                  gt(listeningQueueItems.sortOrder, current.sortOrder),
                  and(
                    eq(listeningQueueItems.sortOrder, current.sortOrder),
                    gt(listeningQueueItems.createdAt, current.createdAt)
                  ),
                  and(
                    eq(listeningQueueItems.sortOrder, current.sortOrder),
                    eq(listeningQueueItems.createdAt, current.createdAt),
                    gt(listeningQueueItems.id, current.id)
                  )
                )
              : undefined
          )
        )
        .orderBy(
          asc(listeningQueueItems.sortOrder),
          asc(listeningQueueItems.createdAt),
          asc(listeningQueueItems.id)
        )
        .get()
      await context.db.update(listeningRooms).set({
        currentTrackId: next?.id ?? null,
        playbackState: next ? room.playbackState : "paused",
        anchorPositionMs: 0,
        playbackStartedAt:
          next && room.playbackState === "playing" ? scheduledStart : null,
        updatedAt: now,
      }).where(eq(listeningRooms.id, room.id))
    } else {
      let currentTrackId = room.currentTrackId
      if (!currentTrackId) {
        const first = await context.db
          .select({ id: listeningQueueItems.id })
          .from(listeningQueueItems)
          .where(
            and(
              eq(listeningQueueItems.roomId, room.id),
              isNull(listeningQueueItems.playedAt)
            )
          )
          .orderBy(
            asc(listeningQueueItems.sortOrder),
            asc(listeningQueueItems.createdAt),
            asc(listeningQueueItems.id)
          )
          .get()
        currentTrackId = first?.id ?? null
      }
      if (!currentTrackId) return { success: false, error: "Add a track first" }
      await context.db.update(listeningRooms).set({
        currentTrackId,
        playbackState: "playing",
        playbackStartedAt: scheduledStart,
        updatedAt: now,
      }).where(eq(listeningRooms.id, room.id))
    }
    revalidateListeningRoom(context.channel.id)
    return requiredRoomSnapshot(context)
  } catch (error) {
    return { success: false, error: actionError(error, "Failed to update playback") }
  }
}

export async function removeListeningTrack(input: {
  readonly channelId: string
  readonly queueItemId: string
}): Promise<ListeningActionResult<ListeningRoomSnapshot>> {
  try {
    const channelId = channelIdSchema.safeParse(input.channelId)
    const itemId = z.string().min(1).max(200).safeParse(input.queueItemId)
    if (!channelId.success || !itemId.success) return { success: false, error: "Invalid track" }
    const context = await listeningContext(channelId.data, { write: true })
    const room = await roomForChannel(context.db, context.channel.id)
    if (!room) return { success: false, error: "Listening room not found" }
    const item = await context.db
      .select({ id: listeningQueueItems.id, addedBy: listeningQueueItems.addedBy, sortOrder: listeningQueueItems.sortOrder })
      .from(listeningQueueItems)
      .where(
        and(
          eq(listeningQueueItems.id, itemId.data),
          eq(listeningQueueItems.roomId, room.id)
        )
      )
      .get()
    if (!item) return { success: false, error: "Track not found" }
    const canRemove =
      item.addedBy === context.user.id ||
      room.hostUserId === context.user.id ||
      can(context.user, "channels", "moderate")
    if (!canRemove) return { success: false, error: "You cannot remove this track" }
    if (room.currentTrackId === item.id) {
      const next = await context.db
        .select({ id: listeningQueueItems.id })
        .from(listeningQueueItems)
        .where(
          and(
            eq(listeningQueueItems.roomId, room.id),
            ne(listeningQueueItems.id, item.id),
            isNull(listeningQueueItems.playedAt)
          )
        )
        .orderBy(
          asc(listeningQueueItems.sortOrder),
          asc(listeningQueueItems.createdAt),
          asc(listeningQueueItems.id)
        )
        .get()
      const nowMs = Date.now()
      const now = new Date(nowMs).toISOString()
      const scheduledStart = new Date(
        nowMs + LISTENING_ROOM_START_DELAY_MS
      ).toISOString()
      await context.db.update(listeningRooms).set({
        currentTrackId: next?.id ?? null,
        playbackState: next ? room.playbackState : "paused",
        anchorPositionMs: 0,
        playbackStartedAt:
          next && room.playbackState === "playing" ? scheduledStart : null,
        updatedAt: now,
      }).where(eq(listeningRooms.id, room.id))
    }
    await context.db
      .delete(listeningQueueItems)
      .where(eq(listeningQueueItems.id, item.id))
    revalidateListeningRoom(context.channel.id)
    return requiredRoomSnapshot(context)
  } catch (error) {
    return { success: false, error: actionError(error, "Failed to remove track") }
  }
}

export async function endListeningRoom(
  channelId: string
): Promise<ListeningActionResult<{ readonly ended: true }>> {
  try {
    const parsed = channelIdSchema.safeParse(channelId)
    if (!parsed.success) return { success: false, error: "Invalid channel" }
    const context = await listeningContext(parsed.data, { write: true })
    const room = await roomForChannel(context.db, context.channel.id)
    if (!room) return { success: true, data: { ended: true } }
    if (
      room.hostUserId !== context.user.id &&
      !can(context.user, "channels", "moderate")
    ) {
      return { success: false, error: "Only the room host can close this room" }
    }
    await context.db.delete(listeningRooms).where(eq(listeningRooms.id, room.id))
    revalidateListeningRoom(context.channel.id)
    return { success: true, data: { ended: true } }
  } catch (error) {
    return { success: false, error: actionError(error, "Failed to close listening room") }
  }
}
