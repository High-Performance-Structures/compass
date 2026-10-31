/**
 * The only code that writes the field tables (architecture standard,
 * section 1): daily logs, daily log photos, daily log task links and owner
 * project updates. No auth logic here; callers resolve access first.
 */
import { and, eq, inArray, sql } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import {
  dailyLogPhotos,
  dailyLogs,
  dailyLogTaskLinks,
  ownerProjectUpdates,
} from "@/db/schema"
import { chunkD1Values } from "@/lib/d1-query"
import type { OwnerUpdateMutationVersion } from "@/lib/owner-updates/draft-publish"
import type { Db } from "@/lib/server/action-context"

type NewDailyLog = typeof dailyLogs.$inferInsert
type NewDailyLogPhoto = typeof dailyLogPhotos.$inferInsert
type NewOwnerProjectUpdate = typeof ownerProjectUpdates.$inferInsert

// ---------------------------------------------------------------------------
// Daily logs
// ---------------------------------------------------------------------------

export async function insertDailyLog(db: Db, values: NewDailyLog): Promise<void> {
  await db.insert(dailyLogs).values(values)
}

/** An insert to run inside a caller's `db.batch`. */
export function dailyLogInsertStatement(db: Db, values: NewDailyLog): BatchItem<"sqlite"> {
  return db.insert(dailyLogs).values(values)
}

/** An insert that leaves an existing log with the same id alone, for `db.batch`. */
export function dailyLogInsertIfAbsentStatement(
  db: Db,
  values: NewDailyLog
): BatchItem<"sqlite"> {
  return db.insert(dailyLogs).values(values).onConflictDoNothing({ target: dailyLogs.id })
}

/** Imports (email, Meet transcripts) are idempotent on the log id. */
export async function insertDailyLogIfAbsent(db: Db, values: NewDailyLog): Promise<void> {
  await db.insert(dailyLogs).values(values).onConflictDoNothing({ target: dailyLogs.id })
}

/** Rewrites a log's content, scoped to the project it is on now. */
export async function updateDailyLogContent(
  db: Db,
  input: {
    readonly dailyLogId: string
    readonly projectId: string
    readonly values: Partial<NewDailyLog>
  }
): Promise<void> {
  await db
    .update(dailyLogs)
    .set(input.values)
    .where(and(eq(dailyLogs.id, input.dailyLogId), eq(dailyLogs.projectId, input.projectId)))
}

export async function setDailyLogReview(
  db: Db,
  input: {
    readonly dailyLogId: string
    readonly projectId: string
    readonly reviewStatus: string
    readonly isClientVisible: boolean
    readonly now: string
  }
): Promise<void> {
  await db
    .update(dailyLogs)
    .set({
      reviewStatus: input.reviewStatus,
      isClientVisible: input.isClientVisible,
      updatedAt: input.now,
    })
    .where(and(eq(dailyLogs.id, input.dailyLogId), eq(dailyLogs.projectId, input.projectId)))
}

/** A published video's link and audience on the log it was filed with. */
export async function updateDailyLogFromVideo(
  db: Db,
  dailyLogId: string,
  values: Pick<NewDailyLog, "notes" | "isClientVisible" | "syncStatus" | "updatedAt">
): Promise<void> {
  await db.update(dailyLogs).set(values).where(eq(dailyLogs.id, dailyLogId)).run()
}

/** Deletes one log on a project, for a caller's `db.batch`. */
export function dailyLogDeleteStatement(
  db: Db,
  input: { readonly dailyLogId: string; readonly projectId: string }
): BatchItem<"sqlite"> {
  return db
    .delete(dailyLogs)
    .where(and(eq(dailyLogs.id, input.dailyLogId), eq(dailyLogs.projectId, input.projectId)))
}

export async function deleteDailyLogs(
  db: Db,
  projectId: string,
  dailyLogIds: readonly string[]
): Promise<void> {
  for (const ids of chunkD1Values(dailyLogIds)) {
    await db.delete(dailyLogs).where(and(eq(dailyLogs.projectId, projectId), inArray(dailyLogs.id, ids)))
  }
}

// ---------------------------------------------------------------------------
// Daily log photos
// ---------------------------------------------------------------------------

export async function insertDailyLogPhoto(db: Db, values: NewDailyLogPhoto): Promise<void> {
  await db.insert(dailyLogPhotos).values(values)
}

/** Files are kept when their logs are deleted; they just lose the link. */
export async function detachPhotosFromDailyLogs(
  db: Db,
  dailyLogIds: readonly string[]
): Promise<void> {
  for (const ids of chunkD1Values(dailyLogIds)) {
    await db.update(dailyLogPhotos).set({ dailyLogId: null }).where(inArray(dailyLogPhotos.dailyLogId, ids))
  }
}

/** A log's files follow it to another project and go back to review. */
export async function moveDailyLogPhotosToProject(
  db: Db,
  input: {
    readonly dailyLogId: string
    readonly fromProjectId: string
    readonly toProjectId: string
    readonly now: string
  }
): Promise<void> {
  await db
    .update(dailyLogPhotos)
    .set({
      projectId: input.toProjectId,
      reviewStatus: "needs_review",
      ownerVisible: false,
      subVendorVisible: false,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(dailyLogPhotos.projectId, input.fromProjectId),
        eq(dailyLogPhotos.dailyLogId, input.dailyLogId)
      )
    )
}

export async function setPhotoPhaseOverride(
  db: Db,
  input: {
    readonly projectId: string
    readonly photoId: string
    readonly phase: string | null
    readonly now: string
  }
): Promise<void> {
  await db
    .update(dailyLogPhotos)
    .set({ schedulePhaseOverride: input.phase, updatedAt: input.now })
    .where(and(eq(dailyLogPhotos.projectId, input.projectId), eq(dailyLogPhotos.id, input.photoId)))
}

export async function setPhotoPermissions(
  db: Db,
  input: {
    readonly projectId: string
    readonly photoIds: readonly string[]
    readonly values: Pick<
      NewDailyLogPhoto,
      "reviewStatus" | "ownerVisible" | "subVendorVisible" | "publicShareable" | "photoKind" | "updatedAt"
    >
  }
): Promise<void> {
  for (const ids of chunkD1Values(input.photoIds)) {
    await db
      .update(dailyLogPhotos)
      .set(input.values)
      .where(and(eq(dailyLogPhotos.projectId, input.projectId), inArray(dailyLogPhotos.id, ids)))
  }
}

// ---------------------------------------------------------------------------
// Daily log task links
// ---------------------------------------------------------------------------

export async function deleteDailyLogTaskLinks(db: Db, dailyLogId: string): Promise<void> {
  await db.delete(dailyLogTaskLinks).where(eq(dailyLogTaskLinks.dailyLogId, dailyLogId))
}

// ---------------------------------------------------------------------------
// Owner project updates
//
// Every change after creation is a compare-and-set on (status, revision,
// updatedAt), so a stale editor can never overwrite a newer version. A null
// result means the row changed underneath the caller.
// ---------------------------------------------------------------------------

export async function insertOwnerUpdateDraft(
  db: Db,
  values: NewOwnerProjectUpdate & { readonly status: "draft" }
): Promise<void> {
  await db.insert(ownerProjectUpdates).values(values)
}

type OwnerUpdateTarget = {
  readonly projectId: string
  readonly updateId: string
  readonly version: OwnerUpdateMutationVersion
}

function atVersion(target: OwnerUpdateTarget, status: "draft" | "published") {
  return and(
    eq(ownerProjectUpdates.id, target.updateId),
    eq(ownerProjectUpdates.projectId, target.projectId),
    eq(ownerProjectUpdates.status, status),
    eq(ownerProjectUpdates.revision, target.version.revision),
    eq(ownerProjectUpdates.updatedAt, target.version.updatedAt)
  )
}

const NEW_VERSION = {
  revision: ownerProjectUpdates.revision,
  updatedAt: ownerProjectUpdates.updatedAt,
} as const

/** Deletes a draft at the given version; false when it changed first. */
export async function deleteOwnerUpdateDraftAtVersion(
  db: Db,
  target: OwnerUpdateTarget
): Promise<boolean> {
  const deletedRows = await db
    .delete(ownerProjectUpdates)
    .where(atVersion(target, "draft"))
    .returning({ id: ownerProjectUpdates.id })
  return deletedRows[0] !== undefined
}

export async function saveOwnerUpdateDraftAtVersion(
  db: Db,
  target: OwnerUpdateTarget,
  values: Pick<
    NewOwnerProjectUpdate,
    | "title"
    | "updateDate"
    | "periodStart"
    | "periodEnd"
    | "summary"
    | "sourceDailyLogIds"
    | "selectedPhotoIds"
    | "scheduleSnapshot"
  >,
  now: string
): Promise<OwnerUpdateMutationVersion | null> {
  const updatedRows = await db
    .update(ownerProjectUpdates)
    .set({
      ...values,
      revision: sql`${ownerProjectUpdates.revision} + 1`,
      updatedAt: now,
    })
    .where(atVersion(target, "draft"))
    .returning(NEW_VERSION)
  return updatedRows[0] ?? null
}

export async function saveOwnerUpdateSummaryAtVersion(
  db: Db,
  target: OwnerUpdateTarget,
  summary: string,
  now: string
): Promise<OwnerUpdateMutationVersion | null> {
  const updatedRows = await db
    .update(ownerProjectUpdates)
    .set({
      summary,
      revision: sql`${ownerProjectUpdates.revision} + 1`,
      updatedAt: now,
    })
    .where(atVersion(target, "draft"))
    .returning(NEW_VERSION)
  return updatedRows[0] ?? null
}

/**
 * Publishes a draft at the given version.
 *
 * Keep the final attachment ownership check inside the publish CAS while
 * binding the selection as one JSON value instead of one value per ID.
 * D1 rejects statements that exceed its bound-variable limit. The
 * owner_update_publish_attachment_approval trigger applies the selected
 * attachment approval from this same CAS statement, so a stale revision
 * cannot leave attachments approved.
 */
export async function publishOwnerUpdateAtVersion(
  db: Db,
  target: OwnerUpdateTarget,
  input: {
    readonly periodStart: string
    readonly periodEnd: string
    readonly sourceDailyLogIds: string
    readonly selectedPhotoIds: string
    readonly scheduleSnapshot: string
    readonly selectedAttachmentIds: readonly string[]
    readonly now: string
  }
): Promise<OwnerUpdateMutationVersion | null> {
  const selectedAttachmentsBelongToProject = sql<boolean>`NOT EXISTS (
    SELECT 1
    FROM json_each(${JSON.stringify(input.selectedAttachmentIds)}) AS selected_attachment
    WHERE NOT EXISTS (
      SELECT 1
      FROM daily_log_photos AS publish_photo
      WHERE publish_photo.project_id = ${target.projectId}
        AND publish_photo.id = selected_attachment.value
    )
  )`
  const updatedRows = await db
    .update(ownerProjectUpdates)
    .set({
      status: "published",
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      sourceDailyLogIds: input.sourceDailyLogIds,
      selectedPhotoIds: input.selectedPhotoIds,
      scheduleSnapshot: input.scheduleSnapshot,
      revision: sql`${ownerProjectUpdates.revision} + 1`,
      publishedAt: input.now,
      updatedAt: input.now,
    })
    .where(and(atVersion(target, "draft"), selectedAttachmentsBelongToProject))
    .returning(NEW_VERSION)
  return updatedRows[0] ?? null
}

/** Returns a published update to draft at the given version. */
export async function recallOwnerUpdateAtVersion(
  db: Db,
  target: OwnerUpdateTarget,
  input: { readonly recalledBy: string; readonly now: string }
): Promise<OwnerUpdateMutationVersion | null> {
  const updatedRows = await db
    .update(ownerProjectUpdates)
    .set({
      status: "draft",
      publishedAt: null,
      recalledAt: input.now,
      recalledBy: input.recalledBy,
      revision: sql`${ownerProjectUpdates.revision} + 1`,
      updatedAt: input.now,
    })
    .where(atVersion(target, "published"))
    .returning(NEW_VERSION)
  return updatedRows[0] ?? null
}
