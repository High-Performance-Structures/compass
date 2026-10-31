/**
 * The only code that writes the Listening Room tables (architecture
 * standard, section 1): rooms, participants, the room queue and its service
 * links, and saved playlists with their songs and links. No auth logic here;
 * callers resolve voice-channel and playlist access first. Realtime sync
 * (the Durable Object coordinator) does not write these tables.
 */
import { and, eq, inArray, isNull, lt } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import {
  listeningPlaylistItems,
  listeningPlaylists,
  listeningPlaylistTrackLinks,
  listeningQueueItems,
  listeningRoomParticipants,
  listeningRooms,
  listeningTrackLinks,
} from "@/db/schema-conversations"
import { chunkD1InsertRows, chunkD1Values } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

type NewListeningRoom = typeof listeningRooms.$inferInsert
type ListeningRoomChanges = Partial<Omit<NewListeningRoom, "id" | "channelId">>
type NewListeningParticipant = typeof listeningRoomParticipants.$inferInsert
type NewListeningQueueItem = typeof listeningQueueItems.$inferInsert
type NewListeningTrackLink = typeof listeningTrackLinks.$inferInsert
type NewListeningPlaylist = typeof listeningPlaylists.$inferInsert
type NewListeningPlaylistItem = typeof listeningPlaylistItems.$inferInsert
type NewListeningPlaylistTrackLink = typeof listeningPlaylistTrackLinks.$inferInsert

async function runBatch(db: Db, statements: readonly BatchItem<"sqlite">[]): Promise<void> {
  const [first, ...rest] = statements
  if (!first) return
  await db.batch([first, ...rest])
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

/** One room per voice channel; a room someone else just started is kept. */
export async function insertListeningRoomIfAbsent(db: Db, values: NewListeningRoom): Promise<void> {
  await db.insert(listeningRooms).values(values).onConflictDoNothing({ target: listeningRooms.channelId })
}

export async function updateListeningRoom(
  db: Db,
  roomId: string,
  values: ListeningRoomChanges
): Promise<void> {
  await db.update(listeningRooms).set(values).where(eq(listeningRooms.id, roomId))
}

/**
 * Moves the room on only while `expectedTrackId` is still the current song,
 * so two listeners finishing (or double-clicking Skip) skip one song.
 */
export async function updateListeningRoomIfCurrent(
  db: Db,
  input: {
    readonly roomId: string
    readonly expectedTrackId: string | null
    readonly values: ListeningRoomChanges
  }
): Promise<void> {
  await db
    .update(listeningRooms)
    .set(input.values)
    .where(
      and(
        eq(listeningRooms.id, input.roomId),
        input.expectedTrackId
          ? eq(listeningRooms.currentTrackId, input.expectedTrackId)
          : isNull(listeningRooms.currentTrackId)
      )
    )
}

export async function deleteListeningRoom(db: Db, roomId: string): Promise<void> {
  await db.delete(listeningRooms).where(eq(listeningRooms.id, roomId))
}

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

/** Joins a listener, or updates `onRejoin` on their existing row. */
export async function upsertListeningParticipant(
  db: Db,
  values: NewListeningParticipant,
  onRejoin: Partial<Pick<NewListeningParticipant, "preferredProvider" | "updatedAt">>
): Promise<void> {
  await db
    .insert(listeningRoomParticipants)
    .values(values)
    .onConflictDoUpdate({
      target: [listeningRoomParticipants.roomId, listeningRoomParticipants.userId],
      set: onRejoin,
    })
}

/** Joins a listener unless they are already in the room. */
export async function insertListeningParticipantIfAbsent(
  db: Db,
  values: NewListeningParticipant
): Promise<void> {
  await db.insert(listeningRoomParticipants).values(values).onConflictDoNothing()
}

/** Marks a listener present, at most once per `staleBefore` window. */
export async function touchListeningParticipant(
  db: Db,
  input: {
    readonly roomId: string
    readonly userId: string
    readonly now: string
    readonly staleBefore: string
  }
): Promise<void> {
  await db
    .update(listeningRoomParticipants)
    .set({ updatedAt: input.now })
    .where(
      and(
        eq(listeningRoomParticipants.roomId, input.roomId),
        eq(listeningRoomParticipants.userId, input.userId),
        lt(listeningRoomParticipants.updatedAt, input.staleBefore)
      )
    )
}

export async function deleteListeningParticipant(
  db: Db,
  input: { readonly roomId: string; readonly userId: string }
): Promise<void> {
  await db
    .delete(listeningRoomParticipants)
    .where(
      and(
        eq(listeningRoomParticipants.roomId, input.roomId),
        eq(listeningRoomParticipants.userId, input.userId)
      )
    )
}

// ---------------------------------------------------------------------------
// Room queue and service links
// ---------------------------------------------------------------------------

/** Adds songs to a room queue, in one batch sized for D1's parameter limit. */
export async function insertListeningQueueItems(
  db: Db,
  rows: readonly NewListeningQueueItem[]
): Promise<void> {
  await runBatch(db, chunkD1InsertRows(listeningQueueItems, rows).map((chunk) => db.insert(listeningQueueItems).values(chunk)))
}

export async function setListeningQueueItemPlayedAt(
  db: Db,
  queueItemId: string,
  playedAt: string | null
): Promise<void> {
  await db.update(listeningQueueItems).set({ playedAt }).where(eq(listeningQueueItems.id, queueItemId))
}

export async function markListeningQueueItemsPlayed(
  db: Db,
  queueItemIds: readonly string[],
  playedAt: string
): Promise<void> {
  await runBatch(
    db,
    chunkD1Values(queueItemIds).map((part) =>
      db.update(listeningQueueItems).set({ playedAt }).where(inArray(listeningQueueItems.id, part))
    )
  )
}

/** Clears every played marker in a room so its queue can play again. */
export async function resetListeningQueuePlayed(db: Db, roomId: string): Promise<void> {
  await db.update(listeningQueueItems).set({ playedAt: null }).where(eq(listeningQueueItems.roomId, roomId))
}

export async function deleteListeningQueueItem(db: Db, queueItemId: string): Promise<void> {
  await db.delete(listeningQueueItems).where(eq(listeningQueueItems.id, queueItemId))
}

/** Saves a whole room queue order in one batch. */
export async function reorderListeningQueueItems(
  db: Db,
  roomId: string,
  order: readonly { readonly id: string; readonly sortOrder: number; readonly replay: boolean }[]
): Promise<void> {
  await runBatch(
    db,
    order.map((entry) =>
      db
        .update(listeningQueueItems)
        .set(entry.replay ? { sortOrder: entry.sortOrder, playedAt: null } : { sortOrder: entry.sortOrder })
        .where(and(eq(listeningQueueItems.id, entry.id), eq(listeningQueueItems.roomId, roomId)))
    )
  )
}

export async function insertListeningTrackLinks(
  db: Db,
  rows: readonly NewListeningTrackLink[]
): Promise<void> {
  await runBatch(db, chunkD1InsertRows(listeningTrackLinks, rows).map((chunk) => db.insert(listeningTrackLinks).values(chunk)))
}

/** One link per song per service; a link another listener just added wins. */
export async function insertListeningTrackLinkIfAbsent(
  db: Db,
  values: NewListeningTrackLink
): Promise<void> {
  await db
    .insert(listeningTrackLinks)
    .values(values)
    .onConflictDoNothing({ target: [listeningTrackLinks.queueItemId, listeningTrackLinks.provider] })
}

export async function replaceListeningTrackLink(
  db: Db,
  linkId: string,
  values: { readonly url: string; readonly addedBy: string; readonly createdAt: string }
): Promise<void> {
  await db.update(listeningTrackLinks).set(values).where(eq(listeningTrackLinks.id, linkId))
}

// ---------------------------------------------------------------------------
// Playlists
// ---------------------------------------------------------------------------

export async function insertListeningPlaylist(db: Db, values: NewListeningPlaylist): Promise<void> {
  await db.insert(listeningPlaylists).values(values)
}

export async function updateListeningPlaylist(
  db: Db,
  playlistId: string,
  values: Partial<Omit<NewListeningPlaylist, "id" | "organizationId">>
): Promise<void> {
  await db.update(listeningPlaylists).set(values).where(eq(listeningPlaylists.id, playlistId))
}

/**
 * Retires `retiredId` and reveals its hidden replacement in one batch, so
 * the playlist never appears twice or not at all.
 */
export async function swapListeningPlaylist(
  db: Db,
  input: {
    readonly retiredId: string
    readonly replacementId: string
    readonly userId: string
    readonly now: string
  }
): Promise<void> {
  await db.batch([
    db
      .update(listeningPlaylists)
      .set({ deletedAt: input.now, deletedBy: input.userId, updatedAt: input.now })
      .where(eq(listeningPlaylists.id, input.retiredId)),
    db
      .update(listeningPlaylists)
      .set({ deletedAt: null, deletedBy: null })
      .where(eq(listeningPlaylists.id, input.replacementId)),
  ])
}

export async function insertListeningPlaylistItems(
  db: Db,
  rows: readonly NewListeningPlaylistItem[]
): Promise<void> {
  await runBatch(db, chunkD1InsertRows(listeningPlaylistItems, rows).map((chunk) => db.insert(listeningPlaylistItems).values(chunk)))
}

/** Moves a song to the end of another playlist. */
export async function moveListeningPlaylistItem(
  db: Db,
  playlistItemId: string,
  values: { readonly playlistId: string; readonly sortOrder: number }
): Promise<void> {
  await db.update(listeningPlaylistItems).set(values).where(eq(listeningPlaylistItems.id, playlistItemId))
}

export async function deleteListeningPlaylistItem(db: Db, playlistItemId: string): Promise<void> {
  await db.delete(listeningPlaylistItems).where(eq(listeningPlaylistItems.id, playlistItemId))
}

/** Saves a playlist's song order in one batch. */
export async function reorderListeningPlaylistItems(
  db: Db,
  playlistId: string,
  playlistItemIds: readonly string[]
): Promise<void> {
  await runBatch(
    db,
    playlistItemIds.map((id, index) =>
      db
        .update(listeningPlaylistItems)
        .set({ sortOrder: index })
        .where(and(eq(listeningPlaylistItems.id, id), eq(listeningPlaylistItems.playlistId, playlistId)))
    )
  )
}

export async function insertListeningPlaylistTrackLinks(
  db: Db,
  rows: readonly NewListeningPlaylistTrackLink[]
): Promise<void> {
  await runBatch(db, chunkD1InsertRows(listeningPlaylistTrackLinks, rows).map((chunk) => db.insert(listeningPlaylistTrackLinks).values(chunk)))
}
