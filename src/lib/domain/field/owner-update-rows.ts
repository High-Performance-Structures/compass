/**
 * The rows behind one owner update document. Staff read the update and
 * every file on the project; owners read only a published update and the
 * files granted to them for it.
 */
import { and, asc, eq, gte, inArray, isNull, not, or, sql } from "drizzle-orm"

import {
  dailyLogPhotos,
  dailyLogs,
  organizations,
  ownerProjectUpdates,
  projectExternalLinks,
  projectExternalResourceGrants,
  projectMembers,
  projects,
  users,
} from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import { dailyLogPhotoCollectionEligibility } from "@/lib/photos/collection-eligibility"
import type { Db } from "@/lib/server/action-context"

export type OwnerProjectUpdateReadRow = {
  readonly id: string
  readonly projectId: string
  readonly title: string
  readonly updateDate: string
  readonly summary: string
  readonly status: string
  readonly channel: string
  readonly sourceDailyLogIds: string | null
  readonly selectedPhotoIds: string | null
  readonly periodStart: string | null
  readonly periodEnd: string | null
  readonly scheduleSnapshot: string | null
  readonly publishedAt: string | null
  readonly sentAt: string | null
  readonly recalledAt: string | null
  readonly revision: number
  readonly updatedAt: string
}

export type OwnerUpdateLogRow = {
  readonly id: string
  readonly sourceSystem: string
  readonly logDate: string
  readonly workCompleted: string
  readonly weatherTempF: number | null
  readonly weatherConditions: string | null
  readonly crewPresent: string | null
  readonly safetyIncidents: string | null
  readonly issues: string | null
  readonly notes: string | null
  readonly reviewStatus: string
  readonly isClientVisible: boolean
  readonly tags: string | null
  readonly authorDisplayName: string | null
  readonly authorFirstName: string | null
  readonly authorLastName: string | null
  readonly authorEmail: string | null
}

/** `resourceType` is the owner's grant kind; null for staff, who see every file. */
export type OwnerUpdateAttachmentRow = {
  readonly id: string
  readonly dailyLogId: string | null
  readonly sourceSystem: string
  readonly fileName: string
  readonly driveFileId: string | null
  readonly driveUrl: string | null
  readonly thumbnailUrl: string | null
  readonly mimeType: string | null
  readonly caption: string | null
  readonly capturedAt: string | null
  readonly ownerVisible: boolean
  readonly reviewStatus: string
  readonly resourceType: string | null
}

export async function loadOwnerUpdateRow(
  db: Db,
  viewer: AuthUser,
  projectId: string,
  updateId: string,
  internalViewer: boolean
): Promise<OwnerProjectUpdateReadRow | undefined> {
  let update: OwnerProjectUpdateReadRow | undefined
  if (internalViewer) {
    const [internalUpdate] = await db
      .select({
        id: ownerProjectUpdates.id,
        projectId: ownerProjectUpdates.projectId,
        title: ownerProjectUpdates.title,
        updateDate: ownerProjectUpdates.updateDate,
        summary: ownerProjectUpdates.summary,
        status: ownerProjectUpdates.status,
        channel: ownerProjectUpdates.channel,
        sourceDailyLogIds: ownerProjectUpdates.sourceDailyLogIds,
        selectedPhotoIds: ownerProjectUpdates.selectedPhotoIds,
        periodStart: ownerProjectUpdates.periodStart,
        periodEnd: ownerProjectUpdates.periodEnd,
        scheduleSnapshot: ownerProjectUpdates.scheduleSnapshot,
        publishedAt: ownerProjectUpdates.publishedAt,
        sentAt: ownerProjectUpdates.sentAt,
        recalledAt: ownerProjectUpdates.recalledAt,
        revision: ownerProjectUpdates.revision,
        updatedAt: ownerProjectUpdates.updatedAt,
      })
      .from(ownerProjectUpdates)
      .where(
        and(
          eq(ownerProjectUpdates.id, updateId),
          eq(ownerProjectUpdates.projectId, projectId)
        )
      )
      .limit(1)
    update = internalUpdate
  } else {
    const [externalUpdate] = await db
      .select({
        id: ownerProjectUpdates.id,
        projectId: ownerProjectUpdates.projectId,
        title: ownerProjectUpdates.title,
        updateDate: ownerProjectUpdates.updateDate,
        summary: ownerProjectUpdates.summary,
        status: ownerProjectUpdates.status,
        channel: ownerProjectUpdates.channel,
        sourceDailyLogIds: ownerProjectUpdates.sourceDailyLogIds,
        selectedPhotoIds: sql<string>`'[]'`,
        periodStart: ownerProjectUpdates.periodStart,
        periodEnd: ownerProjectUpdates.periodEnd,
        // External readers get the published schedule projection but attachment
        // inventories are selected only through exact recipient grants below.
        scheduleSnapshot: sql<string | null>`
          CASE
            WHEN json_valid(${ownerProjectUpdates.scheduleSnapshot})
            THEN json_set(
              ${ownerProjectUpdates.scheduleSnapshot},
              '$.documents',
              json('[]')
            )
            ELSE NULL
          END
        `,
        publishedAt: ownerProjectUpdates.publishedAt,
        sentAt: ownerProjectUpdates.sentAt,
        recalledAt: ownerProjectUpdates.recalledAt,
        revision: ownerProjectUpdates.revision,
        updatedAt: ownerProjectUpdates.updatedAt,
      })
      .from(ownerProjectUpdates)
      .innerJoin(projects, eq(projects.id, ownerProjectUpdates.projectId))
      .innerJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, projects.id),
          eq(projectMembers.userId, viewer.id),
          inArray(projectMembers.role, ["client", "owner"])
        )
      )
      .innerJoin(
        organizations,
        and(
          eq(organizations.id, projects.organizationId),
          eq(organizations.id, viewer.organizationId ?? ""),
          eq(organizations.type, viewer.organizationType ?? ""),
          eq(organizations.isActive, true)
        )
      )
      .where(
        and(
          eq(ownerProjectUpdates.id, updateId),
          eq(ownerProjectUpdates.projectId, projectId),
          inArray(ownerProjectUpdates.status, ["published", "sent"])
        )
      )
      .limit(1)
    update = externalUpdate
  }
  return update
}

export async function loadOwnerUpdateLogRows(
  db: Db,
  input: {
    readonly projectId: string
    readonly update: OwnerProjectUpdateReadRow
    readonly selectedDailyLogIds: readonly string[]
    readonly internalViewer: boolean
  }
): Promise<readonly OwnerUpdateLogRow[]> {
  const { projectId, update, selectedDailyLogIds, internalViewer } = input
  return db
    .select({
      id: dailyLogs.id,
      sourceSystem: dailyLogs.sourceSystem,
      logDate: dailyLogs.logDate,
      workCompleted: dailyLogs.workCompleted,
      weatherTempF: dailyLogs.weatherTempF,
      weatherConditions: dailyLogs.weatherConditions,
      crewPresent: dailyLogs.crewPresent,
      safetyIncidents: dailyLogs.safetyIncidents,
      issues: dailyLogs.issues,
      notes: dailyLogs.notes,
      reviewStatus: dailyLogs.reviewStatus,
      isClientVisible: dailyLogs.isClientVisible,
      tags: dailyLogs.tags,
      authorDisplayName: users.displayName,
      authorFirstName: users.firstName,
      authorLastName: users.lastName,
      authorEmail: users.email,
    })
    .from(dailyLogs)
    .leftJoin(users, eq(dailyLogs.authorId, users.id))
    .where(
      and(
        eq(dailyLogs.projectId, projectId),
        internalViewer
          ? undefined
          : and(
              inArray(dailyLogs.id, selectedDailyLogIds),
              eq(dailyLogs.reviewStatus, "approved"),
              eq(dailyLogs.isClientVisible, true),
              update.periodStart === null
                ? undefined
                : gte(dailyLogs.logDate, update.periodStart),
              update.periodEnd === null
                ? undefined
                : sql`${dailyLogs.logDate} <= ${update.periodEnd}`
            )
      )
    )
    .orderBy(asc(dailyLogs.logDate), asc(dailyLogs.createdAt))
}

export async function loadOwnerUpdateAttachmentRows(
  db: Db,
  input: {
    readonly viewer: AuthUser
    readonly projectId: string
    readonly updateId: string
    readonly selectedPhotoIds: readonly string[]
    readonly internalViewer: boolean
  }
): Promise<readonly OwnerUpdateAttachmentRow[]> {
  const { viewer, projectId, updateId, selectedPhotoIds, internalViewer } = input
  const attachmentSelection = {
    id: dailyLogPhotos.id,
    dailyLogId: dailyLogPhotos.dailyLogId,
    sourceSystem: dailyLogPhotos.sourceSystem,
    fileName: dailyLogPhotos.fileName,
    driveFileId: dailyLogPhotos.driveFileId,
    driveUrl: dailyLogPhotos.driveUrl,
    thumbnailUrl: dailyLogPhotos.thumbnailUrl,
    mimeType: dailyLogPhotos.mimeType,
    caption: dailyLogPhotos.caption,
    capturedAt: dailyLogPhotos.capturedAt,
    ownerVisible: dailyLogPhotos.ownerVisible,
    reviewStatus: dailyLogPhotos.reviewStatus,
  }
  const internalAttachmentSelection = {
    ...attachmentSelection,
    resourceType: sql<"photo" | "owner_update_document" | null>`NULL`,
  }
  const externalAttachmentSelection = {
    ...attachmentSelection,
    resourceType: projectExternalResourceGrants.resourceType,
  }
  return internalViewer
    ? await db
        .select(internalAttachmentSelection)
        .from(dailyLogPhotos)
        .where(
          and(
            eq(dailyLogPhotos.projectId, projectId),
            or(
              inArray(dailyLogPhotos.id, selectedPhotoIds),
              // The owner-update picker shares this query with the photo picker.
              // Keep non-image attachments available for document selection; the
              // alias read model is only relevant to image collection rows.
              sql<boolean>`
                ${dailyLogPhotos.mimeType} IS NULL
                OR ${dailyLogPhotos.mimeType} NOT LIKE 'image/%'
              `,
              and(
                dailyLogPhotoCollectionEligibility(),
                not(sql<boolean>`EXISTS (
                  SELECT 1
                  FROM daily_log_photo_aliases AS alias
                  JOIN daily_log_photos AS canonical
                    ON canonical.id IS alias.canonical_photo_id
                  WHERE alias.source_photo_id IS ${dailyLogPhotos.id}
                    AND alias.project_id IS ${dailyLogPhotos.projectId}
                    AND canonical.project_id IS ${dailyLogPhotos.projectId}
                    AND canonical.mime_type LIKE 'image/%'
                    AND canonical.drive_file_id IS NOT NULL
                    AND (
                      canonical.drive_file_id IS NOT NULL
                      OR canonical.thumbnail_url IS NOT NULL
                    )
                    AND ${dailyLogPhotos.dailyLogId} IS canonical.daily_log_id
                    AND canonical.review_status IS 'approved'
                    AND canonical.owner_visible IS 1
                )`),
              ),
            )
          )
        )
        .orderBy(asc(dailyLogPhotos.sortOrder), asc(dailyLogPhotos.createdAt))
    : await db
        .select(externalAttachmentSelection)
        .from(dailyLogPhotos)
        .innerJoin(
          ownerProjectUpdates,
          and(
            eq(ownerProjectUpdates.id, updateId),
            eq(ownerProjectUpdates.projectId, projectId)
          )
        )
        .innerJoin(
          projectExternalResourceGrants,
          and(
            eq(
              projectExternalResourceGrants.organizationId,
              viewer.organizationId ?? ""
            ),
            eq(projectExternalResourceGrants.projectId, projectId),
            eq(projectExternalResourceGrants.sourceOwnerUpdateId, updateId),
            eq(projectExternalResourceGrants.resourceId, dailyLogPhotos.id),
            eq(projectExternalResourceGrants.audience, "owner"),
            eq(projectExternalResourceGrants.recipientUserId, viewer.id),
            isNull(projectExternalResourceGrants.revokedAt),
            or(
              and(
                eq(projectExternalResourceGrants.resourceType, "photo"),
                sql<boolean>`${dailyLogPhotos.id} IN (
                  SELECT value
                  FROM json_each(
                    CASE
                      WHEN json_valid(${ownerProjectUpdates.selectedPhotoIds})
                        AND json_type(${ownerProjectUpdates.selectedPhotoIds}) = 'array'
                      THEN ${ownerProjectUpdates.selectedPhotoIds}
                      ELSE '[]'
                    END
                  )
                  WHERE type = 'text'
                    AND length(trim(value)) > 0
                )`
              ),
              and(
                eq(
                  projectExternalResourceGrants.resourceType,
                  "owner_update_document"
                ),
                sql<boolean>`${dailyLogPhotos.id} IN (
                  SELECT resource_id
                  FROM owner_update_valid_snapshot_documents
                  WHERE owner_update_id = ${ownerProjectUpdates.id}
                )`
              )
            )
          )
        )
        .innerJoin(
          projects,
          and(
            eq(projects.id, dailyLogPhotos.projectId),
            eq(projects.organizationId, projectExternalResourceGrants.organizationId)
          )
        )
        .innerJoin(
          organizations,
          and(
            eq(organizations.id, projects.organizationId),
            eq(organizations.id, viewer.organizationId ?? ""),
            eq(organizations.type, viewer.organizationType ?? ""),
            eq(organizations.isActive, true)
          )
        )
        .innerJoin(
          projectMembers,
          and(
            eq(projectMembers.projectId, projects.id),
            eq(projectMembers.userId, viewer.id),
            inArray(projectMembers.role, ["client", "owner"])
          )
        )
        .innerJoin(users, and(eq(users.id, viewer.id), eq(users.isActive, true)))
        .where(
          and(
            eq(dailyLogPhotos.projectId, projectId),
            eq(dailyLogPhotos.reviewStatus, "approved"),
            eq(dailyLogPhotos.ownerVisible, true)
          )
        )
        .orderBy(asc(dailyLogPhotos.sortOrder), asc(dailyLogPhotos.createdAt))
}

export async function loadOwnerUpdatePhotoFolder(
  db: Db,
  projectId: string
): Promise<{ readonly label: string } | undefined> {
  const [photoFolder] = await db
    .select({
      label: projectExternalLinks.label,
    })
    .from(projectExternalLinks)
    .where(
      and(
        eq(projectExternalLinks.projectId, projectId),
        eq(projectExternalLinks.system, "google_progress_photos_folder")
      )
    )
    .limit(1)
  return photoFolder
}
