/**
 * One owner update as a document: what staff edit (with the logs, files,
 * schedule items and to-dos they may add) and the owner-safe projection a
 * project owner reads once it is published.
 */
import { eq } from "drizzle-orm"

import { projects } from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import { dailyLogAuthorName } from "@/lib/daily-logs/imported-author"
import { normalizeDailyLogNotes } from "@/lib/daily-logs/notes"
import {
  ownerUpdateExternalDailyLog,
  ownerUpdateExternalDocument,
  ownerUpdateExternalPhoto,
  ownerUpdateExternalProject,
  ownerUpdateExternalSchedule,
  ownerUpdateExternalUpdate,
  selectCurrentOwnerVisibleDocuments,
} from "@/lib/owner-updates/external-projection"
import { isOwnerUpdateVisibleToRole, ownerUpdateVisibleStatuses } from "@/lib/owner-updates/history"
import { retainSelectedAndScopedRows } from "@/lib/owner-updates/photo-selection"
import {
  isDateWithinOwnerUpdatePeriod,
  parseOwnerUpdateComposerSnapshot,
  selectRowsByIdOrder,
  type OwnerUpdateComposerSnapshot,
  type OwnerUpdateDocumentSelection,
  type OwnerUpdateScheduleSelection,
  type OwnerUpdateTodoSelection,
} from "@/lib/owner-updates/snapshot"
import { can } from "@/lib/permissions"
import type { Db } from "@/lib/server/action-context"

import {
  getOwnerUpdateComposerCandidates,
  getOwnerUpdatePublishedScheduleItems,
} from "./owner-update-candidates"
import {
  loadOwnerUpdateAttachmentRows,
  loadOwnerUpdateLogRows,
  loadOwnerUpdatePhotoFolder,
  loadOwnerUpdateRow,
  type OwnerProjectUpdateReadRow,
  type OwnerUpdateAttachmentRow,
  type OwnerUpdateLogRow,
} from "./owner-update-rows"
import {
  dailyLogIdsInPeriod,
  isPhotoInOwnerUpdateScope,
  ownerFacingDailyLogNotes,
  ownerUpdateDocumentSelection,
  ownerUpdateWeatherLabel,
  parseIdList,
  personDisplayName,
  reconciledScheduleItems,
} from "./rules"

type OwnerUpdateProject = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly address: string | null
  readonly clientName: string | null
  readonly projectManager: string | null
}

type OwnerUpdateDailyLog = {
  readonly id: string
  readonly sourceSystem: string
  readonly logDate: string
  readonly workCompleted: string
  readonly weather: string | null
  readonly manpower: string | null
  readonly safetyNotes: string | null
  readonly issues: string | null
  readonly nextSteps: string | null
  readonly authorName: string | null
  readonly reviewStatus: string
  readonly isClientVisible: boolean
}

type OwnerUpdatePhoto = {
  readonly id: string
  readonly sourceSystem: string
  readonly fileName: string
  readonly mimeType: string | null
  readonly driveFileId: string | null
  readonly driveUrl: string | null
  readonly thumbnailUrl: string | null
  readonly caption: string | null
  readonly capturedAt: string | null
  readonly reviewStatus: string
  readonly ownerVisible: boolean
}

type OwnerUpdatePhotoFolder = {
  readonly label: string
}

type OwnerUpdateDocumentView = OwnerUpdateDocumentSelection & {
  readonly compassUrl: string | null
}

export type OwnerProjectUpdateDocument = {
  readonly canManage: boolean
  readonly viewerId: string
  readonly project: OwnerUpdateProject
  readonly update: {
    readonly id: string
    readonly title: string
    readonly updateDate: string
    readonly summary: string
    readonly status: string
    readonly channel: string
    readonly publishedAt: string | null
    readonly sentAt: string | null
    readonly recalledAt: string | null
    readonly revision: number
    readonly updatedAt: string
    readonly sourceDailyLogIds: readonly string[]
    readonly selectedPhotoIds: readonly string[]
    readonly selectedDocumentIds: readonly string[]
    readonly periodStart: string | null
    readonly periodEnd: string | null
  }
  readonly dailyLogs: readonly OwnerUpdateDailyLog[]
  readonly availableDailyLogs: readonly OwnerUpdateDailyLog[]
  readonly photos: readonly OwnerUpdatePhoto[]
  readonly availablePhotos: readonly OwnerUpdatePhoto[]
  readonly documents: readonly OwnerUpdateDocumentView[]
  readonly availableDocuments: readonly OwnerUpdateDocumentSelection[]
  readonly photoFolder: OwnerUpdatePhotoFolder | null
  readonly nextScheduleItem: {
    readonly title: string
    readonly startDate: string
    readonly endDate: string
    readonly assignedTo: string | null
  } | null
  readonly lookAheadScheduleItems: readonly {
    readonly id: string
    readonly title: string
    readonly startDate: string
    readonly endDate: string
    readonly assignedTo: string | null
    readonly status: string
    readonly percentComplete: number
    readonly notes: string
  }[]
  readonly completedScheduleItems: readonly OwnerUpdateScheduleSelection[]
  readonly availableCompletedScheduleItems: readonly OwnerUpdateScheduleSelection[]
  readonly availableLookAheadScheduleItems: readonly OwnerUpdateScheduleSelection[]
  readonly todos: readonly OwnerUpdateTodoSelection[]
  readonly availableTodos: readonly OwnerUpdateTodoSelection[]
}

function mapDailyLog(row: OwnerUpdateLogRow): OwnerUpdateDailyLog {
  return {
    id: row.id,
    sourceSystem: row.sourceSystem,
    logDate: row.logDate,
    workCompleted: row.workCompleted,
    weather: ownerUpdateWeatherLabel(row),
    manpower: row.crewPresent,
    safetyNotes: row.safetyIncidents,
    issues: row.issues,
    nextSteps: ownerFacingDailyLogNotes(
      normalizeDailyLogNotes(row.workCompleted, row.notes)
    ),
    authorName: dailyLogAuthorName({
      compassAuthorName: personDisplayName({
        displayName: row.authorDisplayName,
        firstName: row.authorFirstName,
        lastName: row.authorLastName,
        email: row.authorEmail,
      }),
      tags: row.tags,
    }),
    reviewStatus: row.reviewStatus,
    isClientVisible: row.isClientVisible,
  }
}

function internalPhoto(row: OwnerUpdateAttachmentRow): OwnerUpdatePhoto {
  return {
    id: row.id,
    sourceSystem: row.sourceSystem,
    fileName: row.fileName,
    mimeType: row.mimeType,
    driveUrl: row.driveUrl,
    driveFileId: row.driveFileId,
    thumbnailUrl: row.thumbnailUrl,
    caption: row.caption,
    capturedAt: row.capturedAt,
    reviewStatus: row.reviewStatus,
    ownerVisible: row.ownerVisible,
  }
}

/** The update's own logs (approved, shared, in period) and the logs staff may add. */
function documentDailyLogs(
  allLogRows: readonly OwnerUpdateLogRow[],
  update: OwnerProjectUpdateReadRow,
  selectedDailyLogIds: readonly string[],
  canManage: boolean
): {
  readonly dailyLogsForUpdate: readonly OwnerUpdateDailyLog[]
  readonly availableDailyLogs: readonly OwnerUpdateDailyLog[]
} {
  const inPeriod = (row: OwnerUpdateLogRow): boolean =>
    isDateWithinOwnerUpdatePeriod(row.logDate, update.periodStart, update.periodEnd)
  const dailyLogsForUpdate = selectRowsByIdOrder(allLogRows, selectedDailyLogIds)
    .filter((row) => row.reviewStatus === "approved" && row.isClientVisible && inPeriod(row))
    .map(mapDailyLog)
  const availableDailyLogs = canManage
    ? allLogRows.filter(inPeriod).slice(0, 100).map(mapDailyLog)
    : []
  return { dailyLogsForUpdate, availableDailyLogs }
}

/** Photos and documents on the update, and the ones staff may add. */
function documentAttachments(input: {
  readonly projectId: string
  readonly update: OwnerProjectUpdateReadRow
  readonly allPhotoRows: readonly OwnerUpdateAttachmentRow[]
  readonly attachmentScopeDailyLogIds: ReadonlySet<string>
  readonly selectedPhotoIds: readonly string[]
  readonly composerSnapshot: OwnerUpdateComposerSnapshot
  readonly internalViewer: boolean
  readonly canManage: boolean
}): {
  readonly photosForUpdate: readonly OwnerUpdatePhoto[]
  readonly availablePhotos: readonly OwnerUpdatePhoto[]
  readonly documentRows: readonly OwnerUpdateAttachmentRow[]
  readonly selectedDocumentIds: readonly string[]
  readonly availableDocuments: readonly OwnerUpdateDocumentSelection[]
} {
  const { projectId, update, allPhotoRows, attachmentScopeDailyLogIds, selectedPhotoIds, composerSnapshot, internalViewer, canManage } = input
  const selectedPhotoIdSet = new Set(selectedPhotoIds)
  const composerDocumentIds = composerSnapshot.documents.map((document) => document.id)
  const composerDocumentIdSet = new Set(composerDocumentIds)
  const inScope = (row: OwnerUpdateAttachmentRow): boolean =>
    update.periodStart !== null &&
    update.periodEnd !== null &&
    isPhotoInOwnerUpdateScope(
      row,
      attachmentScopeDailyLogIds,
      update.periodStart,
      update.periodEnd
    )

  const imageRows = allPhotoRows.filter((row) =>
    internalViewer
      ? row.mimeType?.startsWith("image/") === true ||
        selectedPhotoIdSet.has(row.id)
      : row.resourceType === "photo"
  )
  const documentRows = allPhotoRows.filter((row) =>
    internalViewer
      ? row.mimeType?.startsWith("image/") !== true ||
        composerDocumentIdSet.has(row.id)
      : row.resourceType === "owner_update_document"
  )

  const selectedPhotoIdsForViewer = internalViewer
    ? selectedPhotoIds
    : imageRows.map((row) => row.id)
  const photosForUpdate = selectRowsByIdOrder(imageRows, selectedPhotoIdsForViewer)
    .filter(
      (row) =>
        update.status !== "published" ||
        (row.reviewStatus === "approved" && row.ownerVisible)
    )
    .map((row) =>
      internalViewer ? internalPhoto(row) : ownerUpdateExternalPhoto(projectId, row)
    )

  const availablePhotos = canManage
    ? retainSelectedAndScopedRows(imageRows, selectedPhotoIds, inScope).map(internalPhoto)
    : []

  const selectedDocumentIds = internalViewer
    ? composerDocumentIds
    : documentRows.map((row) => row.id)
  const selectedDocumentIdSet = new Set(selectedDocumentIds)
  const scopedDocumentRows = documentRows.filter(
    (row) => !selectedDocumentIdSet.has(row.id) && inScope(row)
  )
  const availableDocuments = canManage
    ? [
        ...composerSnapshot.documents,
        ...scopedDocumentRows.map(ownerUpdateDocumentSelection),
      ].slice(0, 120)
    : []

  return { photosForUpdate, availablePhotos, documentRows, selectedDocumentIds, availableDocuments }
}

/**
 * Schedule items on the update. Staff see their saved picks refreshed from
 * the live schedule plus the current candidates; owners see the published
 * picks read back from the schedule.
 */
async function documentSchedule(
  db: Db,
  input: {
    readonly projectId: string
    readonly update: OwnerProjectUpdateReadRow
    readonly composerSnapshot: OwnerUpdateComposerSnapshot
    readonly internalViewer: boolean
    readonly canManage: boolean
  }
): Promise<{
  readonly currentCandidates: Awaited<ReturnType<typeof getOwnerUpdateComposerCandidates>>
  readonly completedScheduleItems: readonly OwnerUpdateScheduleSelection[]
  readonly lookAheadScheduleItems: readonly OwnerUpdateScheduleSelection[]
}> {
  const { projectId, update, composerSnapshot, internalViewer, canManage } = input
  const selectedScheduleIds = [
    ...new Set([
      ...composerSnapshot.completedScheduleItems.map((item) => item.id),
      ...composerSnapshot.lookAheadScheduleItems.map((item) => item.id),
    ]),
  ]
  const currentCandidates =
    canManage &&
    update.status !== "published" &&
    update.periodStart !== null &&
    update.periodEnd !== null
      ? await getOwnerUpdateComposerCandidates(
          db,
          projectId,
          update.periodStart,
          update.periodEnd
        )
      : {
          completedScheduleItems: [],
          lookAheadScheduleItems: [],
          todos: [],
        }
  const externalPublishedCandidates =
    !internalViewer && (update.status === "published" || update.status === "sent")
      ? await getOwnerUpdatePublishedScheduleItems(
          db,
          projectId,
          selectedScheduleIds,
          update.periodStart,
          update.periodEnd
        )
      : {
          completedScheduleItems: [],
          lookAheadScheduleItems: [],
        }
  const completedScheduleItems = internalViewer
    ? reconciledScheduleItems(
        composerSnapshot.completedScheduleItems,
        currentCandidates.completedScheduleItems
      )
    : externalPublishedCandidates.completedScheduleItems
  const lookAheadScheduleItems = internalViewer
    ? reconciledScheduleItems(
        composerSnapshot.lookAheadScheduleItems,
        currentCandidates.lookAheadScheduleItems
      )
    : externalPublishedCandidates.lookAheadScheduleItems
  return { currentCandidates, completedScheduleItems, lookAheadScheduleItems }
}

/** Throws "Owner update not found" when the viewer may not read the update. */
export async function loadOwnerProjectUpdateDocument(
  db: Db,
  viewer: AuthUser,
  projectId: string,
  updateId: string
): Promise<OwnerProjectUpdateDocument> {
  const visibleStatuses = ownerUpdateVisibleStatuses(viewer.role, viewer.organizationType)
  const internalViewer = visibleStatuses === null

  const update = await loadOwnerUpdateRow(db, viewer, projectId, updateId, internalViewer)

  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      address: projects.address,
      clientName: projects.clientName,
      projectManager: projects.projectManager,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project || !update) {
    throw new Error("Owner update not found")
  }
  if (!isOwnerUpdateVisibleToRole(
    update.status,
    viewer.role,
    viewer.organizationType
  )) {
    throw new Error("Owner update not found")
  }

  const selectedDailyLogIds = parseIdList(update.sourceDailyLogIds)
  const selectedPhotoIds = parseIdList(update.selectedPhotoIds)
  const composerSnapshot = parseOwnerUpdateComposerSnapshot(
    update.scheduleSnapshot
  )
  const canManage = can(viewer, "project", "update")

  const allLogRows = await loadOwnerUpdateLogRows(db, {
    projectId,
    update,
    selectedDailyLogIds,
    internalViewer,
  })
  const allPhotoRows = await loadOwnerUpdateAttachmentRows(db, {
    viewer,
    projectId,
    updateId,
    selectedPhotoIds,
    internalViewer,
  })
  const photoFolder = await loadOwnerUpdatePhotoFolder(db, projectId)

  const { dailyLogsForUpdate, availableDailyLogs } = documentDailyLogs(
    allLogRows,
    update,
    selectedDailyLogIds,
    canManage
  )
  const { photosForUpdate, availablePhotos, documentRows, selectedDocumentIds, availableDocuments } =
    documentAttachments({
      projectId,
      update,
      allPhotoRows,
      attachmentScopeDailyLogIds: dailyLogIdsInPeriod(allLogRows, update.periodStart, update.periodEnd),
      selectedPhotoIds,
      composerSnapshot,
      internalViewer,
      canManage,
    })
  const { currentCandidates, completedScheduleItems, lookAheadScheduleItems } =
    await documentSchedule(db, { projectId, update, composerSnapshot, internalViewer, canManage })

  const currentPublishedDocuments = selectCurrentOwnerVisibleDocuments(
    selectedDocumentIds,
    documentRows
  )
  const selectedDocumentIdsForViewer = internalViewer
    ? selectedDocumentIds
    : currentPublishedDocuments.map((document) => document.id)
  const externalDailyLogs = dailyLogsForUpdate.map((log) =>
    ownerUpdateExternalDailyLog(log)
  )
  const externalCompletedScheduleItems = completedScheduleItems.map(
    (item, index) => ownerUpdateExternalSchedule(item, index, true)
  )
  const externalLookAheadScheduleItems = lookAheadScheduleItems.map(
    (item, index) => ownerUpdateExternalSchedule(item, index, false)
  )
  const externalProject = ownerUpdateExternalProject(project)
  const externalUpdate = ownerUpdateExternalUpdate({
    id: update.id,
    title: update.title,
    updateDate: update.updateDate,
    status: update.status,
    channel: update.channel,
    summary: update.summary,
    publishedAt: update.publishedAt,
    sentAt: update.sentAt,
    createdAt: "",
    updatedAt: update.updatedAt,
    recalledAt: update.recalledAt,
    revision: update.revision,
    periodStart: update.periodStart,
    periodEnd: update.periodEnd,
  })
  const documentsForViewer: readonly OwnerUpdateDocumentView[] = internalViewer
    ? composerSnapshot.documents.map((document) => ({
        ...document,
        compassUrl: null,
      }))
    : currentPublishedDocuments.map((document) =>
        ownerUpdateExternalDocument(projectId, document)
      )

  return {
    canManage: internalViewer && canManage,
    viewerId: internalViewer ? viewer.id : "",
    project: internalViewer ? project : externalProject,
    update: internalViewer
      ? {
          id: update.id,
          title: update.title,
          updateDate: update.updateDate,
          summary: update.summary,
          status: update.status,
          channel: update.channel,
          publishedAt: update.publishedAt,
          sentAt: update.sentAt,
          recalledAt: update.recalledAt,
          revision: update.revision,
          updatedAt: update.updatedAt,
          sourceDailyLogIds: selectedDailyLogIds,
          selectedPhotoIds,
          selectedDocumentIds: selectedDocumentIdsForViewer,
          periodStart: update.periodStart,
          periodEnd: update.periodEnd,
        }
      : {
          id: externalUpdate.id,
          title: externalUpdate.title,
          updateDate: externalUpdate.updateDate,
          summary: externalUpdate.summary,
          status: externalUpdate.status,
          channel: externalUpdate.channel,
          publishedAt: externalUpdate.publishedAt,
          sentAt: null,
          recalledAt: null,
          revision: 0,
          updatedAt: "",
          sourceDailyLogIds: [],
          selectedPhotoIds: [],
          selectedDocumentIds: [],
          periodStart: externalUpdate.periodStart,
          periodEnd: externalUpdate.periodEnd,
        },
    dailyLogs: internalViewer ? dailyLogsForUpdate : externalDailyLogs,
    availableDailyLogs: internalViewer ? availableDailyLogs : [],
    photos: photosForUpdate,
    availablePhotos: internalViewer ? availablePhotos : [],
    documents: documentsForViewer,
    availableDocuments: internalViewer ? availableDocuments : [],
    photoFolder: internalViewer && photoFolder ? { label: photoFolder.label } : null,
    nextScheduleItem: internalViewer
      ? lookAheadScheduleItems[0] ?? null
      : externalLookAheadScheduleItems[0] ?? null,
    completedScheduleItems: internalViewer
      ? completedScheduleItems
      : externalCompletedScheduleItems,
    lookAheadScheduleItems: internalViewer
      ? lookAheadScheduleItems
      : externalLookAheadScheduleItems,
    availableCompletedScheduleItems: internalViewer
      ? currentCandidates.completedScheduleItems
      : [],
    availableLookAheadScheduleItems: internalViewer
      ? currentCandidates.lookAheadScheduleItems
      : [],
    todos: internalViewer ? composerSnapshot.todos : [],
    availableTodos: internalViewer ? currentCandidates.todos : [],
  }
}
