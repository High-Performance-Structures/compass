"use server"

import { and, eq, sql } from "drizzle-orm"
import { z } from "zod/v4"

import {
  listeningPlaylistItems,
  listeningPlaylists,
  listeningPlaylistTrackLinks,
  listeningQueueItems,
  listeningRooms,
  listeningTrackLinks,
} from "@/db/schema-conversations"
import {
  activePlaylist,
  canEditPlaylist,
  playlistContext,
  revalidatePlaylistPaths,
  type PlaylistContext,
} from "@/lib/listening-playlist-context"
import {
  isMusicProvider,
  musicProviderFromUrl,
  normalizeMusicUrl,
  type MusicProvider,
} from "@/lib/listening-room"

type PlaylistItemResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string }

const idSchema = z.string().trim().min(1).max(200)

const songSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("queue"), queueItemId: idSchema }),
  z.object({
    kind: z.literal("link"),
    url: z.string().trim().min(1).max(2_048),
    title: z.string().trim().min(1).max(160),
    artist: z.string().trim().max(160),
  }),
])

export type ListeningPlaylistSongSource = z.infer<typeof songSourceSchema>

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

async function editablePlaylist(context: PlaylistContext, playlistId: string) {
  const playlist = await activePlaylist(context, playlistId)
  if (!playlist) throw new Error("Playlist not found")
  if (!canEditPlaylist(context, playlist.createdBy)) {
    throw new Error("Only the person who made this playlist (or a moderator) can change it")
  }
  return playlist
}

async function nextSortOrder(context: PlaylistContext, playlistId: string): Promise<number> {
  const row = await context.db
    .select({ max: sql<number>`coalesce(max(${listeningPlaylistItems.sortOrder}), -1)` })
    .from(listeningPlaylistItems)
    .where(eq(listeningPlaylistItems.playlistId, playlistId))
    .get()
  return (row?.max ?? -1) + 1
}

async function touchPlaylist(context: PlaylistContext, playlistId: string, now: string): Promise<void> {
  await context.db
    .update(listeningPlaylists)
    .set({ updatedBy: context.user.id, updatedAt: now })
    .where(eq(listeningPlaylists.id, playlistId))
}

/** An empty playlist that songs can be added to one at a time. */
export async function createEmptyListeningPlaylist(input: {
  readonly channelId: string
  readonly name: string
}): Promise<PlaylistItemResult<{ readonly playlistId: string }>> {
  try {
    const channelId = idSchema.safeParse(input.channelId)
    const name = z.string().trim().min(1).max(120).safeParse(input.name)
    if (!channelId.success || !name.success) {
      return { success: false, error: "Enter a playlist name" }
    }
    const context = await playlistContext(channelId.data, true)
    const now = new Date().toISOString()
    const playlistId = crypto.randomUUID()
    await context.db.insert(listeningPlaylists).values({
      id: playlistId,
      organizationId: context.channel.organizationId,
      name: name.data,
      createdBy: context.user.id,
      updatedBy: context.user.id,
      createdAt: now,
      updatedAt: now,
    })
    revalidatePlaylistPaths(context.channel.id)
    return { success: true, data: { playlistId } }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to create playlist") }
  }
}

/** Adds one song, from the room's queue or a pasted link, to the end of a playlist. */
export async function addSongToListeningPlaylist(input: {
  readonly channelId: string
  readonly playlistId: string
  readonly source: ListeningPlaylistSongSource
}): Promise<PlaylistItemResult<{ readonly playlistItemId: string }>> {
  try {
    const channelId = idSchema.safeParse(input.channelId)
    const playlistId = idSchema.safeParse(input.playlistId)
    const source = songSourceSchema.safeParse(input.source)
    if (!channelId.success || !playlistId.success || !source.success) {
      return { success: false, error: "Choose a song and a playlist" }
    }
    const context = await playlistContext(channelId.data, true)
    const playlist = await editablePlaylist(context, playlistId.data)

    let song: {
      readonly title: string
      readonly artist: string | null
      readonly durationMs: number | null
      readonly links: readonly { readonly provider: MusicProvider; readonly url: string }[]
    }
    if (source.data.kind === "queue") {
      const item = await context.db
        .select({
          id: listeningQueueItems.id,
          title: listeningQueueItems.title,
          artist: listeningQueueItems.artist,
          durationMs: listeningQueueItems.durationMs,
        })
        .from(listeningQueueItems)
        .innerJoin(listeningRooms, eq(listeningRooms.id, listeningQueueItems.roomId))
        .where(
          and(
            eq(listeningQueueItems.id, source.data.queueItemId),
            eq(listeningRooms.channelId, context.channel.id)
          )
        )
        .get()
      if (!item) return { success: false, error: "Song not found in the queue" }
      const links = await context.db
        .select({ provider: listeningTrackLinks.provider, url: listeningTrackLinks.url })
        .from(listeningTrackLinks)
        .where(eq(listeningTrackLinks.queueItemId, item.id))
      song = {
        title: item.title,
        artist: item.artist,
        durationMs: item.durationMs,
        links: links.flatMap((link) =>
          isMusicProvider(link.provider) ? [{ provider: link.provider, url: link.url }] : []
        ),
      }
    } else {
      const url = normalizeMusicUrl(source.data.url)
      const provider = url ? musicProviderFromUrl(url) : null
      if (!url || !provider) return { success: false, error: "Use an http or https music link" }
      song = {
        title: source.data.title,
        artist: source.data.artist || null,
        durationMs: null,
        links: [{ provider, url }],
      }
    }

    const now = new Date().toISOString()
    const playlistItemId = crypto.randomUUID()
    await context.db.insert(listeningPlaylistItems).values({
      id: playlistItemId,
      playlistId: playlist.id,
      title: song.title,
      artist: song.artist,
      durationMs: song.durationMs,
      sortOrder: await nextSortOrder(context, playlist.id),
      addedBy: context.user.id,
      createdAt: now,
    })
    if (song.links.length > 0) {
      await context.db.insert(listeningPlaylistTrackLinks).values(
        song.links.map((link) => ({
          id: crypto.randomUUID(),
          playlistItemId,
          provider: link.provider,
          url: link.url,
          addedBy: context.user.id,
          createdAt: now,
        }))
      )
    }
    await touchPlaylist(context, playlist.id, now)
    revalidatePlaylistPaths(context.channel.id)
    return { success: true, data: { playlistItemId } }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to add the song") }
  }
}

async function playlistItemInOrganization(context: PlaylistContext, playlistItemId: string) {
  return context.db
    .select({
      id: listeningPlaylistItems.id,
      playlistId: listeningPlaylistItems.playlistId,
    })
    .from(listeningPlaylistItems)
    .innerJoin(listeningPlaylists, eq(listeningPlaylists.id, listeningPlaylistItems.playlistId))
    .where(
      and(
        eq(listeningPlaylistItems.id, playlistItemId),
        eq(listeningPlaylists.organizationId, context.channel.organizationId)
      )
    )
    .get()
}

/** Moves a song, with its service links, to the end of another playlist. */
export async function moveListeningPlaylistSong(input: {
  readonly channelId: string
  readonly playlistItemId: string
  readonly toPlaylistId: string
}): Promise<PlaylistItemResult<{ readonly moved: true }>> {
  try {
    const channelId = idSchema.safeParse(input.channelId)
    const itemId = idSchema.safeParse(input.playlistItemId)
    const toPlaylistId = idSchema.safeParse(input.toPlaylistId)
    if (!channelId.success || !itemId.success || !toPlaylistId.success) {
      return { success: false, error: "Choose a song and a playlist" }
    }
    const context = await playlistContext(channelId.data, true)
    const item = await playlistItemInOrganization(context, itemId.data)
    if (!item) return { success: false, error: "Song not found" }
    if (item.playlistId === toPlaylistId.data) return { success: true, data: { moved: true } }
    await editablePlaylist(context, item.playlistId)
    const target = await editablePlaylist(context, toPlaylistId.data)
    const now = new Date().toISOString()
    await context.db
      .update(listeningPlaylistItems)
      .set({ playlistId: target.id, sortOrder: await nextSortOrder(context, target.id) })
      .where(eq(listeningPlaylistItems.id, item.id))
    await touchPlaylist(context, item.playlistId, now)
    await touchPlaylist(context, target.id, now)
    revalidatePlaylistPaths(context.channel.id)
    return { success: true, data: { moved: true } }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to move the song") }
  }
}

export async function removeListeningPlaylistSong(input: {
  readonly channelId: string
  readonly playlistItemId: string
}): Promise<PlaylistItemResult<{ readonly removed: true }>> {
  try {
    const channelId = idSchema.safeParse(input.channelId)
    const itemId = idSchema.safeParse(input.playlistItemId)
    if (!channelId.success || !itemId.success) return { success: false, error: "Song not found" }
    const context = await playlistContext(channelId.data, true)
    const item = await playlistItemInOrganization(context, itemId.data)
    if (!item) return { success: false, error: "Song not found" }
    await editablePlaylist(context, item.playlistId)
    await context.db.delete(listeningPlaylistItems).where(eq(listeningPlaylistItems.id, item.id))
    await touchPlaylist(context, item.playlistId, new Date().toISOString())
    revalidatePlaylistPaths(context.channel.id)
    return { success: true, data: { removed: true } }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to remove the song") }
  }
}
