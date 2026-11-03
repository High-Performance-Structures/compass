/**
 * Publishing and recalling owner updates. Both are compare-and-set on the
 * version the user saw; the publish statement also re-checks that every
 * selected file still belongs to the project (see store.ts), and the
 * database triggers grant or revoke the owner's file access atomically.
 */
import { and, eq, inArray } from "drizzle-orm"

import { dailyLogPhotos, ownerProjectUpdates, projects } from "@/db/schema"
import type { OwnerUpdateMutationVersion } from "@/lib/owner-updates/draft-publish"
import { ownerUpdateIdBatches } from "@/lib/owner-updates/query-batches"
import {
  dateRangeFromDates,
  isDateWithinOwnerUpdatePeriod,
  isValidOwnerUpdatePeriod,
  parseOwnerUpdateComposerSnapshot,
  serializeOwnerUpdateComposerSnapshot,
} from "@/lib/owner-updates/snapshot"
import type { Db } from "@/lib/server/action-context"

import { projectDailyLogDates, projectDailyLogIdsInPeriod } from "./owner-update-drafts"
import { isPhotoInOwnerUpdateScope, parseIdList } from "./rules"
import { publishOwnerUpdateAtVersion, recallOwnerUpdateAtVersion } from "./store"

type OwnerUpdateTarget = {
  readonly organizationId: string
  readonly projectId: string
  readonly updateId: string
  readonly version: OwnerUpdateMutationVersion
}

/**
 * `published` carries the title to announce; an update that was already
 * published succeeds without a new announcement.
 */
type PublishOutcome =
  | ({ readonly success: true; readonly published: { readonly title: string } | null } & OwnerUpdateMutationVersion)
  | { readonly success: false; readonly error: string }

export async function publishOwnerUpdate(
  db: Db,
  target: OwnerUpdateTarget
): Promise<PublishOutcome> {
  const { organizationId, projectId, updateId, version } = target
  const [update] = await db
    .select({
      id: ownerProjectUpdates.id,
      projectId: ownerProjectUpdates.projectId,
      status: ownerProjectUpdates.status,
      revision: ownerProjectUpdates.revision,
      updatedAt: ownerProjectUpdates.updatedAt,
      title: ownerProjectUpdates.title,
      updateDate: ownerProjectUpdates.updateDate,
      summary: ownerProjectUpdates.summary,
      sourceDailyLogIds: ownerProjectUpdates.sourceDailyLogIds,
      selectedPhotoIds: ownerProjectUpdates.selectedPhotoIds,
      periodStart: ownerProjectUpdates.periodStart,
      periodEnd: ownerProjectUpdates.periodEnd,
      scheduleSnapshot: ownerProjectUpdates.scheduleSnapshot,
    })
    .from(ownerProjectUpdates)
    .innerJoin(projects, eq(ownerProjectUpdates.projectId, projects.id))
    .where(
      and(
        eq(ownerProjectUpdates.id, updateId),
        eq(ownerProjectUpdates.projectId, projectId),
        eq(projects.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!update) {
    return { success: false, error: "Owner update not found" }
  }

  if (update.status === "published") {
    return {
      success: true,
      published: null,
      revision: update.revision,
      updatedAt: update.updatedAt,
    }
  }

  if (
    update.title.trim().length === 0 ||
    update.summary.trim().length === 0 ||
    !isValidOwnerUpdatePeriod(update.updateDate, update.updateDate)
  ) {
    return {
      success: false,
      error: "Complete the title, update date, and summary before publishing.",
    }
  }

  const sourceDailyLogIds = parseIdList(update.sourceDailyLogIds)
  const selectedPhotoIds = parseIdList(update.selectedPhotoIds)
  const composerSnapshot = parseOwnerUpdateComposerSnapshot(
    update.scheduleSnapshot
  )
  const selectedDocumentIds = composerSnapshot.documents.map(
    (document) => document.id
  )
  const selectedLogs = await projectDailyLogDates(db, projectId, sourceDailyLogIds)

  if (selectedLogs.length !== sourceDailyLogIds.length) {
    return {
      success: false,
      error: "One or more source daily logs could not be found.",
    }
  }

  const derivedPeriod = dateRangeFromDates(
    selectedLogs.map((log) => log.logDate)
  )
  const periodStart =
    update.periodStart ?? derivedPeriod?.startDate ?? update.updateDate
  const periodEnd =
    update.periodEnd ?? derivedPeriod?.endDate ?? update.updateDate

  if (!isValidOwnerUpdatePeriod(periodStart, periodEnd)) {
    return {
      success: false,
      error: "Set a valid reporting period before publishing.",
    }
  }

  if (
    selectedLogs.some(
      (log) => !isDateWithinOwnerUpdatePeriod(log.logDate, periodStart, periodEnd)
    )
  ) {
    return {
      success: false,
      error: "The reporting period must include every source daily log.",
    }
  }

  const selectedAttachmentIds = [
    ...selectedPhotoIds,
    ...selectedDocumentIds,
  ]
  if (selectedAttachmentIds.length > 0) {
    const selectedAttachments = (
      await Promise.all(
        ownerUpdateIdBatches(selectedAttachmentIds).map((idBatch) =>
          db
            .select({
              id: dailyLogPhotos.id,
              dailyLogId: dailyLogPhotos.dailyLogId,
              capturedAt: dailyLogPhotos.capturedAt,
            })
            .from(dailyLogPhotos)
            .where(
              and(
                eq(dailyLogPhotos.projectId, projectId),
                inArray(dailyLogPhotos.id, idBatch)
              )
            )
        )
      )
    ).flat()

    if (selectedAttachments.length !== selectedAttachmentIds.length) {
      return {
        success: false,
        error:
          "Every selected photo and document must still belong to this project before publishing.",
      }
    }

    const sourceDailyLogIdSet = await projectDailyLogIdsInPeriod(db, projectId, periodStart, periodEnd)
    if (
      selectedAttachments.some(
        (attachment) =>
          !isPhotoInOwnerUpdateScope(
            attachment,
            sourceDailyLogIdSet,
            periodStart,
            periodEnd
          )
      )
    ) {
      return {
        success: false,
        error:
          "Selected files must be tied to a source log or captured during the reporting period.",
      }
    }
  }

  const updated = await publishOwnerUpdateAtVersion(
    db,
    { projectId, updateId, version },
    {
      periodStart,
      periodEnd,
      sourceDailyLogIds: JSON.stringify(sourceDailyLogIds),
      selectedPhotoIds: JSON.stringify(selectedPhotoIds),
      scheduleSnapshot: serializeOwnerUpdateComposerSnapshot(composerSnapshot),
      selectedAttachmentIds,
      now: new Date().toISOString(),
    }
  )
  if (!updated) {
    return {
      success: false,
      error:
        "This owner update changed while you were publishing. Refresh and review the latest version.",
    }
  }

  return { success: true, published: { title: update.title.trim() }, ...updated }
}

/**
 * `recalled` is false when the update was already a draft at that version
 * (nothing changed, nothing to record).
 */
type RecallOutcome =
  | ({ readonly success: true; readonly recalled: boolean } & OwnerUpdateMutationVersion)
  | { readonly success: false; readonly error: string }

export async function recallOwnerUpdate(
  db: Db,
  target: OwnerUpdateTarget & { readonly recalledBy: string }
): Promise<RecallOutcome> {
  const { organizationId, projectId, updateId, version } = target
  const [update] = await db
    .select({
      status: ownerProjectUpdates.status,
      revision: ownerProjectUpdates.revision,
      updatedAt: ownerProjectUpdates.updatedAt,
    })
    .from(ownerProjectUpdates)
    .innerJoin(projects, eq(ownerProjectUpdates.projectId, projects.id))
    .where(
      and(
        eq(ownerProjectUpdates.id, updateId),
        eq(ownerProjectUpdates.projectId, projectId),
        eq(projects.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!update) {
    return { success: false, error: "Owner update not found." }
  }
  if (
    update.revision !== version.revision ||
    update.updatedAt !== version.updatedAt
  ) {
    return {
      success: false,
      error:
        "This owner update changed while you were recalling. Refresh and review the latest version.",
    }
  }
  if (update.status === "draft") {
    return {
      success: true,
      recalled: false,
      revision: update.revision,
      updatedAt: update.updatedAt,
    }
  }
  if (update.status !== "published") {
    return {
      success: false,
      error: "Only a published owner update can be recalled.",
    }
  }

  const updated = await recallOwnerUpdateAtVersion(
    db,
    { projectId, updateId, version },
    { recalledBy: target.recalledBy, now: new Date().toISOString() }
  )
  if (!updated) {
    return {
      success: false,
      error:
        "This owner update changed while you were recalling. Refresh and review the latest version.",
    }
  }

  return { success: true, recalled: true, ...updated }
}
