"use server"

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { users } from "@/db/schema"
import {
  channelMembers,
  listeningPlaylistItems,
  listeningPlaylists,
  listeningPlaylistTrackLinks,
  listeningQueueItems,
  listeningRooms,
  listeningTrackLinks,
} from "@/db/schema-conversations"
import { getCurrentUser, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import {
  canManageListeningPlaylist,
  findMatchingPlaylistRun,
  isMusicProvider,
  LISTENING_ROOM_START_DELAY_MS,
  type MusicProvider,
} from "@/lib/listening-room"
import { can } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"
import {
  getVoiceChannelAccess,
  type VoiceChannelAccess,
} from "@/lib/voice-channel-access"

const channelIdSchema = z.string().trim().min(1).max(200)
const playlistIdSchema = z.string().trim().min(1).max(200)
const playlistItemIdSchema = z.string().trim().min(1).max(200)
const playlistNameSchema = z.string().trim().min(1).max(120)

type PlaylistActionResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string }

export type ListeningPlaylistLinkData = {
  readonly id: string
  readonly provider: MusicProvider
  readonly url: string
}

export type ListeningPlaylistItemData = {
  readonly id: string
  readonly title: string
  readonly artist: string | null
  readonly durationMs: number | null
  readonly sortOrder: number
  readonly links: readonly ListeningPlaylistLinkData[]
}

export type ListeningPlaylistData = {
  readonly id: string
  readonly name: string
  readonly createdBy: string
  readonly createdByName: string
  readonly updatedAt: string
  readonly canEdit: boolean
  readonly items: readonly ListeningPlaylistItemData[]
}

type PlaylistContext = {
  readonly db: ReturnType<typeof getDb>
  readonly user: AuthUser
  readonly channel: VoiceChannelAccess
  readonly canModerate: boolean
}

type QueueTemplateItem = {
  readonly id: string
  readonly title: string
  readonly artist: string | null
  readonly durationMs: number | null
  readonly sortOrder: number
}

type QueueTemplateLink = {
  readonly queueItemId: string
  readonly provider: string
  readonly url: string
}

function actionError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function displayName(input: {
  readonly displayName: string | null
  readonly email: string | null
}): string {
  return input.displayName ?? input.email?.split("@")[0] ?? "Compass user"
}

async function playlistContext(
  channelId: string,
  write = false
): Promise<PlaylistContext> {
  const user = await getCurrentUser()
  if (!user || !can(user, "channels", "read")) throw new Error("Unauthorized")
  if (!isInternalStaffRole(user.role)) {
    throw new Error("Listening-room playlists are available to internal staff only")
  }
  if (write && isDemoUser(user.id)) throw new Error("DEMO_READ_ONLY")

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const channel = await getVoiceChannelAccess(db, user, channelId)
  if (!channel) throw new Error("Voice channel not found")
  const membership = await db
    .select({ role: channelMembers.role })
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, channel.id),
        eq(channelMembers.userId, user.id)
      )
    )
    .get()
  const canModerate =
    can(user, "channels", "moderate") ||
    membership?.role === "owner" ||
    membership?.role === "moderator"
  return { db, user, channel, canModerate }
}

async function activePlaylist(
  context: PlaylistContext,
  playlistId: string
) {
  return context.db
    .select()
    .from(listeningPlaylists)
    .where(
      and(
        eq(listeningPlaylists.id, playlistId),
        eq(listeningPlaylists.organizationId, context.channel.organizationId),
        isNull(listeningPlaylists.deletedAt)
      )
    )
    .get()
}

function canEditPlaylist(
  context: PlaylistContext,
  createdBy: string
): boolean {
  return canManageListeningPlaylist({
    currentUserId: context.user.id,
    createdBy,
    canModerate: context.canModerate,
  })
}

async function currentQueueTemplate(context: PlaylistContext): Promise<{
  readonly items: readonly QueueTemplateItem[]
  readonly links: readonly QueueTemplateLink[]
}> {
  const room = await context.db
    .select({ id: listeningRooms.id })
    .from(listeningRooms)
    .where(eq(listeningRooms.channelId, context.channel.id))
    .get()
  if (!room) throw new Error("Listening room not found")

  const items = await context.db
    .select({
      id: listeningQueueItems.id,
      title: listeningQueueItems.title,
      artist: listeningQueueItems.artist,
      durationMs: listeningQueueItems.durationMs,
      sortOrder: listeningQueueItems.sortOrder,
    })
    .from(listeningQueueItems)
    .where(eq(listeningQueueItems.roomId, room.id))
    .orderBy(
      asc(listeningQueueItems.sortOrder),
      asc(listeningQueueItems.createdAt),
      asc(listeningQueueItems.id)
    )
  if (items.length === 0) throw new Error("Add at least one track before saving a playlist")

  const links = await context.db
    .select({
      queueItemId: listeningTrackLinks.queueItemId,
      provider: listeningTrackLinks.provider,
      url: listeningTrackLinks.url,
    })
    .from(listeningTrackLinks)
    .innerJoin(
      listeningQueueItems,
      eq(listeningQueueItems.id, listeningTrackLinks.queueItemId)
    )
    .where(eq(listeningQueueItems.roomId, room.id))
  return { items, links }
}

async function copyTemplateToPlaylist(
  context: PlaylistContext,
  playlistId: string,
  template: {
    readonly items: readonly QueueTemplateItem[]
    readonly links: readonly QueueTemplateLink[]
  },
  now: string
): Promise<void> {
  const itemIds = new Map<string, string>()
  const itemValues = template.items.map((item, index) => {
    const id = crypto.randomUUID()
    itemIds.set(item.id, id)
    return {
      id,
      playlistId,
      title: item.title,
      artist: item.artist,
      durationMs: item.durationMs,
      sortOrder: index,
      addedBy: context.user.id,
      createdAt: now,
    }
  })
  await context.db.insert(listeningPlaylistItems).values(itemValues)

  const linkValues = template.links.flatMap((link) => {
    const playlistItemId = itemIds.get(link.queueItemId)
    if (!playlistItemId || !isMusicProvider(link.provider)) return []
    return [{
      id: crypto.randomUUID(),
      playlistItemId,
      provider: link.provider,
      url: link.url,
      addedBy: context.user.id,
      createdAt: now,
    }]
  })
  if (linkValues.length > 0) {
    await context.db.insert(listeningPlaylistTrackLinks).values(linkValues)
  }
}

function revalidatePlaylistPaths(channelId: string): void {
  revalidatePath(`/dashboard/conversations/${channelId}`)
  revalidatePath(`/dashboard/conversations/${channelId}/listening-room`)
}

export async function getListeningPlaylists(
  channelId: string
): Promise<PlaylistActionResult<{ readonly playlists: readonly ListeningPlaylistData[] }>> {
  try {
    const parsed = channelIdSchema.safeParse(channelId)
    if (!parsed.success) return { success: false, error: "Invalid channel" }
    const context = await playlistContext(parsed.data)
    const [playlistRows, itemRows, linkRows] = await Promise.all([
      context.db
        .select({
          id: listeningPlaylists.id,
          name: listeningPlaylists.name,
          createdBy: listeningPlaylists.createdBy,
          updatedAt: listeningPlaylists.updatedAt,
          creatorDisplayName: users.displayName,
          creatorEmail: users.email,
        })
        .from(listeningPlaylists)
        .leftJoin(users, eq(users.id, listeningPlaylists.createdBy))
        .where(
          and(
            eq(listeningPlaylists.organizationId, context.channel.organizationId),
            isNull(listeningPlaylists.deletedAt)
          )
        )
        .orderBy(desc(listeningPlaylists.updatedAt), asc(listeningPlaylists.name)),
      context.db
        .select({
          id: listeningPlaylistItems.id,
          playlistId: listeningPlaylistItems.playlistId,
          title: listeningPlaylistItems.title,
          artist: listeningPlaylistItems.artist,
          durationMs: listeningPlaylistItems.durationMs,
          sortOrder: listeningPlaylistItems.sortOrder,
        })
        .from(listeningPlaylistItems)
        .innerJoin(
          listeningPlaylists,
          eq(listeningPlaylists.id, listeningPlaylistItems.playlistId)
        )
        .where(
          and(
            eq(listeningPlaylists.organizationId, context.channel.organizationId),
            isNull(listeningPlaylists.deletedAt)
          )
        )
        .orderBy(
          asc(listeningPlaylistItems.sortOrder),
          asc(listeningPlaylistItems.createdAt),
          asc(listeningPlaylistItems.id)
        ),
      context.db
        .select({
          id: listeningPlaylistTrackLinks.id,
          playlistItemId: listeningPlaylistTrackLinks.playlistItemId,
          provider: listeningPlaylistTrackLinks.provider,
          url: listeningPlaylistTrackLinks.url,
        })
        .from(listeningPlaylistTrackLinks)
        .innerJoin(
          listeningPlaylistItems,
          eq(listeningPlaylistItems.id, listeningPlaylistTrackLinks.playlistItemId)
        )
        .innerJoin(
          listeningPlaylists,
          eq(listeningPlaylists.id, listeningPlaylistItems.playlistId)
        )
        .where(
          and(
            eq(listeningPlaylists.organizationId, context.channel.organizationId),
            isNull(listeningPlaylists.deletedAt)
          )
        ),
    ])

    const linksByItem = new Map<string, ListeningPlaylistLinkData[]>()
    for (const row of linkRows) {
      if (!isMusicProvider(row.provider)) continue
      const links = linksByItem.get(row.playlistItemId) ?? []
      links.push({ id: row.id, provider: row.provider, url: row.url })
      linksByItem.set(row.playlistItemId, links)
    }
    const itemsByPlaylist = new Map<string, ListeningPlaylistItemData[]>()
    for (const row of itemRows) {
      const items = itemsByPlaylist.get(row.playlistId) ?? []
      items.push({
        id: row.id,
        title: row.title,
        artist: row.artist,
        durationMs: row.durationMs,
        sortOrder: row.sortOrder,
        links: linksByItem.get(row.id) ?? [],
      })
      itemsByPlaylist.set(row.playlistId, items)
    }

    return {
      success: true,
      data: {
        playlists: playlistRows.map((playlist) => ({
          id: playlist.id,
          name: playlist.name,
          createdBy: playlist.createdBy,
          createdByName: displayName({
            displayName: playlist.creatorDisplayName,
            email: playlist.creatorEmail,
          }),
          updatedAt: playlist.updatedAt,
          canEdit: canEditPlaylist(context, playlist.createdBy),
          items: itemsByPlaylist.get(playlist.id) ?? [],
        })),
      },
    }
  } catch (error) {
    return { success: false, error: actionError(error, "Failed to load playlists") }
  }
}

export async function createListeningPlaylist(input: {
  readonly channelId: string
  readonly name: string
}): Promise<PlaylistActionResult<{ readonly playlistId: string }>> {
  try {
    const channelId = channelIdSchema.safeParse(input.channelId)
    const name = playlistNameSchema.safeParse(input.name)
    if (!channelId.success || !name.success) {
      return { success: false, error: "Enter a playlist name" }
    }
    const context = await playlistContext(channelId.data, true)
    const template = await currentQueueTemplate(context)
    const now = new Date().toISOString()
    const playlistId = crypto.randomUUID()
    await context.db.insert(listeningPlaylists).values({
      id: playlistId,
      organizationId: context.channel.organizationId,
      name: name.data,
      createdBy: context.user.id,
      updatedBy: context.user.id,
      deletedAt: now,
      deletedBy: context.user.id,
      createdAt: now,
      updatedAt: now,
    })
    await copyTemplateToPlaylist(context, playlistId, template, now)
    await context.db
      .update(listeningPlaylists)
      .set({ deletedAt: null, deletedBy: null })
      .where(eq(listeningPlaylists.id, playlistId))
    revalidatePlaylistPaths(context.channel.id)
    return { success: true, data: { playlistId } }
  } catch (error) {
    return { success: false, error: actionError(error, "Failed to save playlist") }
  }
}

export async function renameListeningPlaylist(input: {
  readonly channelId: string
  readonly playlistId: string
  readonly name: string
}): Promise<PlaylistActionResult<{ readonly renamed: true }>> {
  try {
    const channelId = channelIdSchema.safeParse(input.channelId)
    const playlistId = playlistIdSchema.safeParse(input.playlistId)
    const name = playlistNameSchema.safeParse(input.name)
    if (!channelId.success || !playlistId.success || !name.success) {
      return { success: false, error: "Enter a valid playlist name" }
    }
    const context = await playlistContext(channelId.data, true)
    const playlist = await activePlaylist(context, playlistId.data)
    if (!playlist) return { success: false, error: "Playlist not found" }
    if (!canEditPlaylist(context, playlist.createdBy)) {
      return { success: false, error: "You cannot edit this playlist" }
    }
    await context.db
      .update(listeningPlaylists)
      .set({
        name: name.data,
        updatedBy: context.user.id,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(listeningPlaylists.id, playlist.id))
    revalidatePlaylistPaths(context.channel.id)
    return { success: true, data: { renamed: true } }
  } catch (error) {
    return { success: false, error: actionError(error, "Failed to rename playlist") }
  }
}

export async function replaceListeningPlaylistFromQueue(input: {
  readonly channelId: string
  readonly playlistId: string
}): Promise<PlaylistActionResult<{ readonly playlistId: string }>> {
  try {
    const channelId = channelIdSchema.safeParse(input.channelId)
    const playlistId = playlistIdSchema.safeParse(input.playlistId)
    if (!channelId.success || !playlistId.success) {
      return { success: false, error: "Invalid playlist" }
    }
    const context = await playlistContext(channelId.data, true)
    const playlist = await activePlaylist(context, playlistId.data)
    if (!playlist) return { success: false, error: "Playlist not found" }
    if (!canEditPlaylist(context, playlist.createdBy)) {
      return { success: false, error: "You cannot edit this playlist" }
    }
    const template = await currentQueueTemplate(context)
    const now = new Date().toISOString()
    const replacementId = crypto.randomUUID()
    await context.db.insert(listeningPlaylists).values({
      id: replacementId,
      organizationId: playlist.organizationId,
      name: playlist.name,
      createdBy: playlist.createdBy,
      updatedBy: context.user.id,
      deletedAt: now,
      deletedBy: context.user.id,
      createdAt: playlist.createdAt,
      updatedAt: now,
    })
    await copyTemplateToPlaylist(context, replacementId, template, now)
    await context.db.batch([
      context.db
        .update(listeningPlaylists)
        .set({ deletedAt: now, deletedBy: context.user.id, updatedAt: now })
        .where(eq(listeningPlaylists.id, playlist.id)),
      context.db
        .update(listeningPlaylists)
        .set({ deletedAt: null, deletedBy: null })
        .where(eq(listeningPlaylists.id, replacementId)),
    ])
    revalidatePlaylistPaths(context.channel.id)
    return { success: true, data: { playlistId: replacementId } }
  } catch (error) {
    return { success: false, error: actionError(error, "Failed to update playlist") }
  }
}

export async function deleteListeningPlaylist(input: {
  readonly channelId: string
  readonly playlistId: string
}): Promise<PlaylistActionResult<{ readonly deleted: true }>> {
  try {
    const channelId = channelIdSchema.safeParse(input.channelId)
    const playlistId = playlistIdSchema.safeParse(input.playlistId)
    if (!channelId.success || !playlistId.success) {
      return { success: false, error: "Invalid playlist" }
    }
    const context = await playlistContext(channelId.data, true)
    const playlist = await activePlaylist(context, playlistId.data)
    if (!playlist) return { success: false, error: "Playlist not found" }
    if (!canEditPlaylist(context, playlist.createdBy)) {
      return { success: false, error: "You cannot delete this playlist" }
    }
    const now = new Date().toISOString()
    await context.db
      .update(listeningPlaylists)
      .set({
        deletedAt: now,
        deletedBy: context.user.id,
        updatedBy: context.user.id,
        updatedAt: now,
      })
      .where(eq(listeningPlaylists.id, playlist.id))
    revalidatePlaylistPaths(context.channel.id)
    return { success: true, data: { deleted: true } }
  } catch (error) {
    return { success: false, error: actionError(error, "Failed to delete playlist") }
  }
}

export async function addListeningPlaylistToRoom(input: {
  readonly channelId: string
  readonly playlistId: string
  readonly startAtItemId?: string
}): Promise<PlaylistActionResult<{
  readonly addedCount: number
  readonly started: boolean
}>> {
  try {
    const channelId = channelIdSchema.safeParse(input.channelId)
    const playlistId = playlistIdSchema.safeParse(input.playlistId)
    const startAtItemId = input.startAtItemId === undefined
      ? null
      : playlistItemIdSchema.safeParse(input.startAtItemId)
    if (
      !channelId.success ||
      !playlistId.success ||
      (startAtItemId !== null && !startAtItemId.success)
    ) {
      return { success: false, error: "Invalid playlist" }
    }
    const context = await playlistContext(channelId.data, true)
    const playlist = await activePlaylist(context, playlistId.data)
    if (!playlist) return { success: false, error: "Playlist not found" }
    const room = await context.db
      .select()
      .from(listeningRooms)
      .where(eq(listeningRooms.channelId, context.channel.id))
      .get()
    if (!room) return { success: false, error: "Start a listening room first" }
    if (
      startAtItemId !== null &&
      room.hostUserId !== context.user.id &&
      !can(context.user, "channels", "moderate")
    ) {
      return { success: false, error: "Only the room host can start playback" }
    }

    const items = await context.db
      .select()
      .from(listeningPlaylistItems)
      .where(eq(listeningPlaylistItems.playlistId, playlist.id))
      .orderBy(
        asc(listeningPlaylistItems.sortOrder),
        asc(listeningPlaylistItems.createdAt),
        asc(listeningPlaylistItems.id)
    )
    if (items.length === 0) return { success: false, error: "This playlist is empty" }
    const selectedItem = startAtItemId === null
      ? null
      : items.find((item) => item.id === startAtItemId.data) ?? null
    if (startAtItemId !== null && !selectedItem) {
      return { success: false, error: "Playlist track not found" }
    }
    const links = await context.db
      .select()
      .from(listeningPlaylistTrackLinks)
      .where(
        inArray(
          listeningPlaylistTrackLinks.playlistItemId,
          items.map((item) => item.id)
        )
      )
    const existingQueue = await context.db
      .select()
      .from(listeningQueueItems)
      .where(eq(listeningQueueItems.roomId, room.id))
      .orderBy(
        asc(listeningQueueItems.sortOrder),
        asc(listeningQueueItems.createdAt),
        asc(listeningQueueItems.id)
      )
    const existingLinks = await context.db
      .select({
        queueItemId: listeningTrackLinks.queueItemId,
        provider: listeningTrackLinks.provider,
        url: listeningTrackLinks.url,
      })
      .from(listeningTrackLinks)
      .innerJoin(
        listeningQueueItems,
        eq(listeningQueueItems.id, listeningTrackLinks.queueItemId)
      )
      .where(eq(listeningQueueItems.roomId, room.id))

    const playlistRunStart = selectedItem
      ? findMatchingPlaylistRun(
          existingQueue.map((item) => ({
            title: item.title,
            artist: item.artist,
            links: existingLinks.filter((link) => link.queueItemId === item.id),
          })),
          items.map((item) => ({
            title: item.title,
            artist: item.artist,
            links: links.filter((link) => link.playlistItemId === item.id),
          }))
        )
      : null
    const selectedPlaylistIndex = selectedItem
      ? items.findIndex((item) => item.id === selectedItem.id)
      : -1
    const matchingQueueItemId =
      selectedItem && playlistRunStart !== null && selectedPlaylistIndex >= 0
        ? existingQueue[playlistRunStart + selectedPlaylistIndex]?.id ?? null
        : null

    // Starting a playlist already present in the room should reuse its queue
    // entry instead of appending another duplicate copy.
    const shouldAppend = selectedItem === null || matchingQueueItemId === null
    const maxOrder = await context.db
      .select({ value: sql<number>`coalesce(max(${listeningQueueItems.sortOrder}), -1)` })
      .from(listeningQueueItems)
      .where(eq(listeningQueueItems.roomId, room.id))
      .get()
    const now = new Date().toISOString()
    const queueIds = new Map<string, string>()
    const queueValues = shouldAppend ? items.map((item, index) => {
      const id = crypto.randomUUID()
      queueIds.set(item.id, id)
      return {
        id,
        roomId: room.id,
        title: item.title,
        artist: item.artist,
        durationMs: item.durationMs,
        sortOrder: (maxOrder?.value ?? -1) + index + 1,
        addedBy: context.user.id,
        playedAt: null,
        createdAt: now,
      }
    }) : []
    if (queueValues.length > 0) {
      await context.db.insert(listeningQueueItems).values(queueValues)
    }
    const queueLinkValues = links.flatMap((link) => {
      const queueItemId = queueIds.get(link.playlistItemId)
      if (!queueItemId || !isMusicProvider(link.provider)) return []
      return [{
        id: crypto.randomUUID(),
        queueItemId,
        provider: link.provider,
        url: link.url,
        addedBy: context.user.id,
        createdAt: now,
      }]
    })
    if (queueLinkValues.length > 0) {
      await context.db.insert(listeningTrackLinks).values(queueLinkValues)
    }
    const selectedQueueItemId = selectedItem
      ? matchingQueueItemId ?? queueIds.get(selectedItem.id) ?? null
      : null
    if (selectedQueueItemId) {
      const orderedQueue = [...existingQueue, ...queueValues].sort((left, right) =>
        left.sortOrder - right.sortOrder ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
      )
      const selectedIndex = orderedQueue.findIndex(
        (item) => item.id === selectedQueueItemId
      )
      await context.db
        .update(listeningQueueItems)
        .set({ playedAt: null })
        .where(eq(listeningQueueItems.roomId, room.id))
      const precedingIds = orderedQueue
        .slice(0, Math.max(0, selectedIndex))
        .map((item) => item.id)
      if (precedingIds.length > 0) {
        await context.db
          .update(listeningQueueItems)
          .set({ playedAt: now })
          .where(inArray(listeningQueueItems.id, precedingIds))
      }
      const scheduledStart = new Date(
        Date.now() + LISTENING_ROOM_START_DELAY_MS
      ).toISOString()
      await context.db
        .update(listeningRooms)
        .set({
          currentTrackId: selectedQueueItemId,
          playbackState: "playing",
          anchorPositionMs: 0,
          playbackStartedAt: scheduledStart,
          updatedAt: now,
        })
        .where(eq(listeningRooms.id, room.id))
    } else if (!room.currentTrackId) {
      await context.db
        .update(listeningRooms)
        .set({ currentTrackId: queueValues[0]?.id ?? null, updatedAt: now })
        .where(eq(listeningRooms.id, room.id))
    }
    revalidatePlaylistPaths(context.channel.id)
    return {
      success: true,
      data: {
        addedCount: queueValues.length,
        started: selectedQueueItemId !== null,
      },
    }
  } catch (error) {
    return { success: false, error: actionError(error, "Failed to add playlist") }
  }
}
