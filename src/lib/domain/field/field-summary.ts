/**
 * The field summary on the project page and the owner update list: what
 * internal staff see, and the owner-safe projection for project owners.
 */
import { and, asc, desc, eq, gte, inArray, isNull, not, sql } from "drizzle-orm"

import {
  dailyLogPhotos,
  dailyLogs,
  organizations,
  ownerProjectUpdates,
  projectExternalLinks,
  projectExternalResourceGrants,
  projectMembers,
  projects,
  scheduleTasks,
  users,
} from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import { dailyLogAuthorName } from "@/lib/daily-logs/imported-author"
import {
  ownerUpdateExternalDailyLog,
  ownerUpdateExternalListItem,
  ownerUpdateExternalPhoto,
  safeCompassId,
} from "@/lib/owner-updates/external-projection"
import { ownerUpdateVisibleStatuses } from "@/lib/owner-updates/history"
import { dailyLogPhotoCollectionEligibility } from "@/lib/photos/collection-eligibility"
import type { Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

import { isInternalFieldViewer } from "./access"
import { latestPhotoOrder, personDisplayName, photoReviewPhotoCount } from "./rules"

type LatestDailyLog = {
  readonly id: string
  readonly sourceSystem: string
  readonly logDate: string
  readonly workCompleted: string
  readonly reviewStatus: string
  readonly isClientVisible: boolean
  readonly authorName: string | null
}

type LatestPhoto = {
  readonly id: string
  readonly sourceSystem: string
  readonly fileName: string
  readonly driveFileId: string | null
  readonly driveUrl: string | null
  readonly thumbnailUrl: string | null
  readonly caption: string | null
  readonly reviewStatus: string
  readonly ownerVisible: boolean
  readonly capturedAt: string | null
}

type LatestOwnerUpdate = {
  readonly id: string
  readonly title: string
  readonly updateDate: string
  readonly status: string
  readonly channel: string
  readonly summary: string
}

export type ProjectOwnerUpdateListItem = {
  readonly id: string
  readonly title: string
  readonly updateDate: string
  readonly status: string
  readonly channel: string
  readonly summary: string
  readonly publishedAt: string | null
  readonly sentAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

type PhotoReviewFolder = {
  readonly label: string
  readonly url: string
  readonly photoCount: number | null
}

export type ProjectFieldSummary = {
  readonly dailyLogCount: number
  readonly approvedDailyLogCount: number
  readonly clientVisibleDailyLogCount: number
  readonly latestDailyLog: LatestDailyLog | null
  readonly photoCount: number
  readonly photosAwaitingReviewCount: number
  readonly ownerVisiblePhotoCount: number
  readonly latestPhotos: readonly LatestPhoto[]
  readonly photoReviewFolder: PhotoReviewFolder | null
  readonly ownerUpdateCount: number
  readonly draftOwnerUpdateCount: number
  readonly latestOwnerUpdate: LatestOwnerUpdate | null
  readonly nextScheduleItem: {
    readonly title: string
    readonly startDate: string
    readonly endDate: string
    readonly assignedTo: string | null
  } | null
}

type FieldSummaryPhotoRow = LatestPhoto & {
  readonly mimeType: string | null
}

/** Staff see every collection photo; owners only the photos granted to them. */
async function fieldSummaryPhotos(
  db: Db,
  viewer: AuthUser,
  projectId: string,
  isInternalViewer: boolean
): Promise<readonly FieldSummaryPhotoRow[]> {
  const photoRows: readonly FieldSummaryPhotoRow[] = isInternalViewer
    ? await db
        .select({
          id: dailyLogPhotos.id,
          sourceSystem: dailyLogPhotos.sourceSystem,
          fileName: dailyLogPhotos.fileName,
          mimeType: dailyLogPhotos.mimeType,
          driveFileId: dailyLogPhotos.driveFileId,
          driveUrl: dailyLogPhotos.driveUrl,
          thumbnailUrl: dailyLogPhotos.thumbnailUrl,
          caption: dailyLogPhotos.caption,
          reviewStatus: dailyLogPhotos.reviewStatus,
          ownerVisible: dailyLogPhotos.ownerVisible,
          capturedAt: dailyLogPhotos.capturedAt,
        })
        .from(dailyLogPhotos)
        .where(
          and(
            eq(dailyLogPhotos.projectId, projectId),
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
            )`)
          )
        )
        .orderBy(desc(dailyLogPhotos.createdAt))
    : (
        await db
          .select({
            id: dailyLogPhotos.id,
            sourceSystem: dailyLogPhotos.sourceSystem,
            fileName: dailyLogPhotos.fileName,
            mimeType: dailyLogPhotos.mimeType,
            caption: dailyLogPhotos.caption,
            reviewStatus: dailyLogPhotos.reviewStatus,
            ownerVisible: dailyLogPhotos.ownerVisible,
            capturedAt: dailyLogPhotos.capturedAt,
          })
          .from(dailyLogPhotos)
          .innerJoin(
            projectExternalResourceGrants,
            and(
              eq(
                projectExternalResourceGrants.organizationId,
                viewer.organizationId ?? ""
              ),
              eq(projectExternalResourceGrants.projectId, projectId),
              eq(projectExternalResourceGrants.resourceType, "photo"),
              eq(projectExternalResourceGrants.resourceId, dailyLogPhotos.id),
              eq(projectExternalResourceGrants.audience, "owner"),
              eq(projectExternalResourceGrants.recipientUserId, viewer.id),
              isNull(projectExternalResourceGrants.revokedAt)
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
          .innerJoin(
            users,
            and(eq(users.id, viewer.id), eq(users.isActive, true))
          )
          .where(
            and(
              eq(dailyLogPhotos.projectId, projectId),
              eq(dailyLogPhotos.ownerVisible, true),
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
              )`)
            )
          )
          .groupBy(dailyLogPhotos.id)
          .orderBy(desc(dailyLogPhotos.createdAt))
      ).map((photo) => ({
        ...photo,
        driveFileId: null,
        driveUrl: null,
        thumbnailUrl: null,
      }))
  return photoRows
}

/** Staff see the statuses their role may; owners only published and sent updates. */
async function fieldSummaryUpdates(
  db: Db,
  viewer: AuthUser,
  projectId: string,
  isInternalViewer: boolean
): Promise<readonly LatestOwnerUpdate[]> {
  const visibleStatuses = ownerUpdateVisibleStatuses(
    viewer.role,
    viewer.organizationType
  )
  return isInternalViewer
    ? await db
        .select({
          id: ownerProjectUpdates.id,
          title: ownerProjectUpdates.title,
          updateDate: ownerProjectUpdates.updateDate,
          status: ownerProjectUpdates.status,
          channel: ownerProjectUpdates.channel,
          summary: ownerProjectUpdates.summary,
        })
        .from(ownerProjectUpdates)
        .where(
          and(
            eq(ownerProjectUpdates.projectId, projectId),
            visibleStatuses === null
              ? undefined
              : inArray(ownerProjectUpdates.status, visibleStatuses)
          )
        )
        .orderBy(
          desc(ownerProjectUpdates.updateDate),
          desc(ownerProjectUpdates.createdAt)
        )
    : await db
        .select({
          id: ownerProjectUpdates.id,
          title: ownerProjectUpdates.title,
          updateDate: ownerProjectUpdates.updateDate,
          status: ownerProjectUpdates.status,
          channel: ownerProjectUpdates.channel,
          summary: ownerProjectUpdates.summary,
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
            eq(ownerProjectUpdates.projectId, projectId),
            inArray(ownerProjectUpdates.status, ["published", "sent"])
          )
        )
        .orderBy(
          desc(ownerProjectUpdates.updateDate),
          desc(ownerProjectUpdates.createdAt)
        )
}

export async function loadProjectFieldSummary(
  db: Db,
  viewer: AuthUser,
  projectId: string
): Promise<ProjectFieldSummary> {
  const today = new Date().toISOString().slice(0, 10)
  const isInternalViewer = isInternalFieldViewer(viewer)

  const logRows = await db
    .select({
      id: dailyLogs.id,
      sourceSystem: dailyLogs.sourceSystem,
      logDate: dailyLogs.logDate,
      workCompleted: dailyLogs.workCompleted,
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
        isInternalViewer ? undefined : eq(dailyLogs.isClientVisible, true)
      )
    )
    .orderBy(desc(dailyLogs.logDate), desc(dailyLogs.createdAt))

  const photoRows = await fieldSummaryPhotos(db, viewer, projectId, isInternalViewer)
  const updateRows = await fieldSummaryUpdates(db, viewer, projectId, isInternalViewer)

  const [nextTask] = isInternalViewer
    ? await db
        .select({
          title: scheduleTasks.title,
          startDate: scheduleTasks.startDate,
          endDate: scheduleTasks.endDateCalculated,
          assignedTo: scheduleTasks.assignedTo,
        })
        .from(scheduleTasks)
        .where(
          and(
            eq(scheduleTasks.projectId, projectId),
            gte(scheduleTasks.endDateCalculated, today)
          )
        )
        .orderBy(asc(scheduleTasks.startDate), asc(scheduleTasks.sortOrder))
        .limit(1)
    : []

  const [photoReviewFolder] = isInternalViewer
    ? await db
        .select({
          label: projectExternalLinks.label,
          url: projectExternalLinks.externalUrl,
          metadata: projectExternalLinks.metadata,
        })
        .from(projectExternalLinks)
        .where(
          and(
            eq(projectExternalLinks.projectId, projectId),
            eq(projectExternalLinks.system, "google_buildertrend_review_photos")
          )
        )
        .limit(1)
    : []

  const latestLog = logRows[0]
  const visibleUpdateRows = updateRows
  const latestUpdate = visibleUpdateRows[0]
  const latestAuthorName = latestLog
    ? dailyLogAuthorName({
        compassAuthorName: personDisplayName({
          displayName: latestLog.authorDisplayName,
          firstName: latestLog.authorFirstName,
          lastName: latestLog.authorLastName,
          email: latestLog.authorEmail,
        }),
        tags: latestLog.tags,
      })
    : null
  const latestPhotoRows = latestPhotoOrder(photoRows)
  const externalLatestLog = latestLog
    ? ownerUpdateExternalDailyLog({
        id: latestLog.id,
        sourceSystem: latestLog.sourceSystem,
        logDate: latestLog.logDate,
        workCompleted: latestLog.workCompleted,
        weather: null,
        manpower: null,
        safetyNotes: null,
        issues: null,
        nextSteps: null,
        authorName: latestAuthorName,
        reviewStatus: latestLog.reviewStatus,
        isClientVisible: latestLog.isClientVisible,
      })
    : null

  return {
    dailyLogCount: logRows.length,
    approvedDailyLogCount: logRows.filter(
      (log) => log.reviewStatus === "approved"
    ).length,
    clientVisibleDailyLogCount: logRows.filter((log) => log.isClientVisible)
      .length,
    latestDailyLog: latestLog
      ? {
          id: isInternalViewer
            ? latestLog.id
            : safeCompassId(latestLog.id),
          sourceSystem: isInternalViewer
            ? latestLog.sourceSystem
            : externalLatestLog?.sourceSystem ?? "Compass",
          logDate: isInternalViewer
            ? latestLog.logDate
            : externalLatestLog?.logDate ?? "1970-01-01",
          workCompleted: isInternalViewer
            ? latestLog.workCompleted
            : externalLatestLog?.workCompleted ?? "No work details provided.",
          reviewStatus: isInternalViewer
            ? latestLog.reviewStatus
            : externalLatestLog?.reviewStatus ?? "approved",
          isClientVisible: isInternalViewer
            ? latestLog.isClientVisible
            : true,
          authorName: isInternalViewer
            ? latestAuthorName
            : externalLatestLog?.authorName ?? null,
        }
      : null,
    photoCount: photoRows.length,
    photosAwaitingReviewCount: photoRows.filter(
      (photo) => photo.reviewStatus === "needs_review"
    ).length,
    ownerVisiblePhotoCount: photoRows.filter((photo) => photo.ownerVisible)
      .length,
    latestPhotos: latestPhotoRows.slice(0, 4).map((photo) =>
      isInternalViewer
        ? {
            id: photo.id,
            sourceSystem: photo.sourceSystem,
            fileName: photo.fileName,
            driveFileId: photo.driveFileId,
            driveUrl: photo.driveUrl,
            thumbnailUrl: photo.thumbnailUrl,
            caption: photo.caption,
            reviewStatus: photo.reviewStatus,
            ownerVisible: photo.ownerVisible,
            capturedAt: photo.capturedAt,
          }
        : ownerUpdateExternalPhoto(projectId, photo)
    ),
    photoReviewFolder:
      photoReviewFolder?.url !== null && photoReviewFolder?.url !== undefined
        ? {
            label: photoReviewFolder.label,
            url: photoReviewFolder.url,
            photoCount: photoReviewPhotoCount(photoReviewFolder.metadata),
          }
        : null,
    ownerUpdateCount: visibleUpdateRows.length,
    draftOwnerUpdateCount: visibleUpdateRows.filter(
      (update) => update.status === "draft"
    ).length,
    latestOwnerUpdate: latestUpdate
      ? isInternalViewer
        ? {
            id: latestUpdate.id,
            title: latestUpdate.title,
            updateDate: latestUpdate.updateDate,
            status: latestUpdate.status,
            channel: latestUpdate.channel,
            summary: latestUpdate.summary,
          }
        : (() => {
            const safeUpdate = ownerUpdateExternalListItem({
              id: latestUpdate.id,
              title: latestUpdate.title,
              updateDate: latestUpdate.updateDate,
              status: latestUpdate.status,
              channel: latestUpdate.channel,
              summary: latestUpdate.summary,
              publishedAt: null,
              sentAt: null,
              createdAt: "",
              updatedAt: "",
            })
            return {
              id: safeUpdate.id,
              title: safeUpdate.title,
              updateDate: safeUpdate.updateDate,
              status: safeUpdate.status,
              channel: safeUpdate.channel,
              summary: safeUpdate.summary,
            }
          })()
      : null,
    nextScheduleItem:
      viewer.organizationType === "internal" &&
      (isInternalStaffRole(viewer.role) || viewer.role === "developer")
        ? nextTask ?? null
        : null,
  }
}

export async function loadProjectOwnerUpdates(
  db: Db,
  viewer: AuthUser,
  projectId: string
): Promise<readonly ProjectOwnerUpdateListItem[]> {
  const visibleStatuses = ownerUpdateVisibleStatuses(viewer.role, viewer.organizationType)
  const internalViewer = visibleStatuses === null

  const updateRows = internalViewer
    ? await db
        .select({
          id: ownerProjectUpdates.id,
          title: ownerProjectUpdates.title,
          updateDate: ownerProjectUpdates.updateDate,
          status: ownerProjectUpdates.status,
          channel: ownerProjectUpdates.channel,
          summary: ownerProjectUpdates.summary,
          publishedAt: ownerProjectUpdates.publishedAt,
          sentAt: ownerProjectUpdates.sentAt,
          createdAt: ownerProjectUpdates.createdAt,
          updatedAt: ownerProjectUpdates.updatedAt,
        })
        .from(ownerProjectUpdates)
        .where(eq(ownerProjectUpdates.projectId, projectId))
        .orderBy(
          desc(ownerProjectUpdates.updateDate),
          desc(ownerProjectUpdates.createdAt)
        )
    : await db
        .select({
          id: ownerProjectUpdates.id,
          title: ownerProjectUpdates.title,
          updateDate: ownerProjectUpdates.updateDate,
          status: ownerProjectUpdates.status,
          channel: ownerProjectUpdates.channel,
          summary: ownerProjectUpdates.summary,
          publishedAt: ownerProjectUpdates.publishedAt,
          sentAt: ownerProjectUpdates.sentAt,
          createdAt: ownerProjectUpdates.createdAt,
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
            eq(ownerProjectUpdates.projectId, projectId),
            inArray(ownerProjectUpdates.status, ["published", "sent"])
          )
        )
        .orderBy(
          desc(ownerProjectUpdates.updateDate),
          desc(ownerProjectUpdates.createdAt)
        )

  return internalViewer
    ? updateRows
    : updateRows.map((update) => ownerUpdateExternalListItem(update))
}

export async function loadOwnerUpdateProjectHeader(
  db: Db,
  viewer: AuthUser,
  projectId: string
): Promise<{
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
}> {
  const internalViewer = isInternalFieldViewer(viewer)
  const project = internalViewer
    ? await db
        .select({
          id: projects.id,
          name: projects.name,
          projectNumber: projects.projectNumber,
        })
        .from(projects)
        .innerJoin(
          organizations,
          and(
            eq(organizations.id, projects.organizationId),
            eq(organizations.id, viewer.organizationId ?? ""),
            eq(organizations.type, "internal"),
            eq(organizations.isActive, true)
          )
        )
        .where(eq(projects.id, projectId))
        .limit(1)
        .get()
    : await db
        .select({
          id: projects.id,
          name: projects.name,
          projectNumber: projects.projectNumber,
        })
        .from(projects)
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
        .where(eq(projects.id, projectId))
        .limit(1)
        .get()
  if (!project) throw new Error("Project not found")
  return project
}
