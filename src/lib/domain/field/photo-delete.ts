/**
 * Planning a bulk photo delete: which selected photos may go, which hidden
 * duplicate copies (aliases) go with them, and which Drive files nothing else
 * uses afterwards. Reads only; store.ts does the deleting.
 */
import { and, eq, inArray } from "drizzle-orm"

import { dailyLogPhotoAliases, dailyLogPhotos, ownerProjectUpdates } from "@/db/schema"
import { socialPostMedia } from "@/db/schema-social"
import { chunkD1Values } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

type DeletedPhotoRow = typeof dailyLogPhotos.$inferSelect

export type PhotoDeletePlan = {
  /** Selected photos plus their hidden copies, full rows for the recovery copy in Activity. */
  readonly rows: readonly DeletedPhotoRow[]
  readonly selectedCount: number
  readonly aliasCount: number
  /** Selected photos left alone because a client update or social post shows them. */
  readonly keptInUse: number
  /** Drive files no remaining photo points at. */
  readonly driveFileIds: readonly string[]
}

function parseIdList(value: string | null): readonly string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

async function selectInChunks<T>(ids: readonly string[], query: (chunk: string[]) => Promise<readonly T[]>): Promise<T[]> {
  const rows: T[] = []
  for (const chunk of chunkD1Values(ids)) rows.push(...(await query(chunk)))
  return rows
}

export async function planPhotoDelete(
  db: Db,
  input: { readonly projectId: string; readonly photoIds: readonly string[] }
): Promise<PhotoDeletePlan> {
  const { projectId } = input
  const selected = await selectInChunks(input.photoIds, (chunk) =>
    db.select().from(dailyLogPhotos).where(and(eq(dailyLogPhotos.projectId, projectId), inArray(dailyLogPhotos.id, chunk)))
  )
  const selectedIds = selected.map((row) => row.id)

  // Client updates (any status) and social posts address photos by id, so a
  // photo they show stays until it is taken out of them.
  const updates = await db
    .select({ selectedPhotoIds: ownerProjectUpdates.selectedPhotoIds })
    .from(ownerProjectUpdates)
    .where(eq(ownerProjectUpdates.projectId, projectId))
  const inUse = new Set(updates.flatMap((update) => parseIdList(update.selectedPhotoIds)))
  const posted = await selectInChunks(selectedIds, (chunk) =>
    db.select({ photoId: socialPostMedia.photoId }).from(socialPostMedia).where(inArray(socialPostMedia.photoId, chunk))
  )
  for (const row of posted) inUse.add(row.photoId)
  const deletable = selected.filter((row) => !inUse.has(row.id))
  const deletableIds = deletable.map((row) => row.id)

  // Hidden duplicate copies point at the photo the gallery shows.
  const aliasIds = (
    await selectInChunks(deletableIds, (chunk) =>
      db
        .select({ id: dailyLogPhotoAliases.sourcePhotoId })
        .from(dailyLogPhotoAliases)
        .where(and(eq(dailyLogPhotoAliases.projectId, projectId), inArray(dailyLogPhotoAliases.canonicalPhotoId, chunk)))
    )
  )
    .map((row) => row.id)
    .filter((id) => !inUse.has(id) && !deletableIds.includes(id))
  const aliases = await selectInChunks(aliasIds, (chunk) =>
    db.select().from(dailyLogPhotos).where(and(eq(dailyLogPhotos.projectId, projectId), inArray(dailyLogPhotos.id, chunk)))
  )
  const rows = [...deletable, ...aliases]
  const deletedIds = new Set(rows.map((row) => row.id))

  // A Drive file can back several photo rows (the same file on several logs of
  // this project); trash it only when every row using it is being deleted.
  const candidateFiles = [...new Set(rows.flatMap((row) => (row.driveFileId ? [row.driveFileId] : [])))]
  const stillUsed = new Set(
    (
      await selectInChunks(candidateFiles, (chunk) =>
        db
          .select({ id: dailyLogPhotos.id, driveFileId: dailyLogPhotos.driveFileId })
          .from(dailyLogPhotos)
          .where(and(eq(dailyLogPhotos.projectId, projectId), inArray(dailyLogPhotos.driveFileId, chunk)))
      )
    )
      .filter((row) => !deletedIds.has(row.id))
      .flatMap((row) => (row.driveFileId ? [row.driveFileId] : []))
  )

  return {
    rows,
    selectedCount: deletable.length,
    aliasCount: aliases.length,
    keptInUse: selected.length - deletable.length,
    driveFileIds: candidateFiles.filter((id) => !stillUsed.has(id)),
  }
}
