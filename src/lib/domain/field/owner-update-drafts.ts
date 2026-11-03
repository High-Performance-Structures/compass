/**
 * Owner update drafts: create (from daily logs or blank), edit, delete and
 * draft the summary with the company's AI provider. Every change after
 * creation is fenced on the draft's revision (see store.ts).
 */
import { and, asc, eq, inArray, not, sql } from "drizzle-orm"

import { dailyLogPhotos, dailyLogs, ownerProjectUpdates, projects } from "@/db/schema"
import { generateOrganizationText } from "@/lib/agent/one-shot"
import type { AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { ownerUpdateAttachmentKind } from "@/lib/owner-updates/attachment-taxonomy"
import {
  buildOwnerUpdateDraftPrompt,
  cleanOwnerUpdateDraft,
  defaultOwnerUpdatePeriod,
} from "@/lib/owner-updates/composer"
import type { OwnerUpdateDraftWriteInput } from "@/lib/owner-updates/draft-recovery"
import type { OwnerUpdateMutationResult, OwnerUpdateMutationVersion } from "@/lib/owner-updates/draft-publish"
import { ownerUpdateIdBatches } from "@/lib/owner-updates/query-batches"
import {
  isDateWithinOwnerUpdatePeriod,
  isValidOwnerUpdatePeriod,
  parseOwnerUpdateComposerSnapshot,
  reconcileSubmittedScheduleSelections,
  serializeOwnerUpdateComposerSnapshot,
  type OwnerUpdateComposerSnapshot,
  type OwnerUpdateDocumentSelection,
} from "@/lib/owner-updates/snapshot"
import { dailyLogPhotoCollectionEligibility } from "@/lib/photos/collection-eligibility"
import type { Db } from "@/lib/server/action-context"

import { getOwnerUpdateComposerCandidates } from "./owner-update-candidates"
import {
  dailyLogIdsInPeriod,
  isPhotoInOwnerUpdateScope,
  ownerUpdateDocumentSelection,
  ownerUpdateSummaryFromLogs,
  ownerUpdateTitleFromLogs,
  parseIdList,
  reconcileSubmittedTodos,
  submittedIdList,
} from "./rules"
import {
  deleteOwnerUpdateDraftAtVersion,
  insertOwnerUpdateDraft,
  saveOwnerUpdateDraftAtVersion,
  saveOwnerUpdateSummaryAtVersion,
} from "./store"

// The drafting prompt is built from the selected logs, schedule items and
// to-dos; long reporting periods can run past the old relay's 3,950 limit.
const OWNER_UPDATE_PROMPT_MAX_CHARACTERS = 24_000

export type OwnerUpdateDraftResult =
  | { readonly success: true; readonly updateId: string }
  | { readonly success: false; readonly error: string }

type Failure = { readonly success: false; readonly error: string }

async function projectLabel(
  db: Db,
  projectId: string
): Promise<string | null> {
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  return project ? project.projectNumber ?? project.name : null
}

/** {id, logDate} of the given logs on the project, read in D1-sized batches. */
export async function projectDailyLogDates(
  db: Db,
  projectId: string,
  dailyLogIds: readonly string[]
): Promise<readonly { readonly id: string; readonly logDate: string }[]> {
  return (
    await Promise.all(
      ownerUpdateIdBatches(dailyLogIds).map((idBatch) =>
        db
          .select({
            id: dailyLogs.id,
            logDate: dailyLogs.logDate,
          })
          .from(dailyLogs)
          .where(
            and(
              eq(dailyLogs.projectId, projectId),
              inArray(dailyLogs.id, idBatch)
            )
          )
      )
    )
  ).flat()
}

/** Ids of the project's logs dated inside the period. */
export async function projectDailyLogIdsInPeriod(
  db: Db,
  projectId: string,
  periodStart: string,
  periodEnd: string
): Promise<Set<string>> {
  const attachmentScopeRows = await db
    .select({
      id: dailyLogs.id,
      logDate: dailyLogs.logDate,
    })
    .from(dailyLogs)
    .where(eq(dailyLogs.projectId, projectId))
  return dailyLogIdsInPeriod(attachmentScopeRows, periodStart, periodEnd)
}

/** A draft from the chosen logs, with their approved owner-visible photos. */
export async function draftOwnerUpdateFromLogs(
  db: Db,
  user: AuthUser,
  projectId: string,
  requestedDailyLogIds: readonly string[]
): Promise<OwnerUpdateDraftResult> {
  const userId = user.id
  const dailyLogIds = [...new Set(requestedDailyLogIds)].filter(
    (id) => id.trim().length > 0
  )

  if (dailyLogIds.length === 0) {
    return { success: false, error: "Select at least one daily log." }
  }

  const label = await projectLabel(db, projectId)
  if (label === null) {
    return { success: false, error: "Project not found." }
  }

  const selectedLogs = await db
    .select({
      id: dailyLogs.id,
      logDate: dailyLogs.logDate,
      workCompleted: dailyLogs.workCompleted,
      notes: dailyLogs.notes,
    })
    .from(dailyLogs)
    .where(
      and(
        eq(dailyLogs.projectId, projectId),
        inArray(dailyLogs.id, dailyLogIds)
      )
    )
    .orderBy(asc(dailyLogs.logDate), asc(dailyLogs.createdAt))

  if (selectedLogs.length !== dailyLogIds.length) {
    return {
      success: false,
      error: "One or more selected daily logs could not be found.",
    }
  }

  const ownerPhotos = await db
    .select({ id: dailyLogPhotos.id })
    .from(dailyLogPhotos)
    .where(
      and(
        eq(dailyLogPhotos.projectId, projectId),
        inArray(dailyLogPhotos.dailyLogId, selectedLogs.map((log) => log.id)),
        eq(dailyLogPhotos.reviewStatus, "approved"),
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
            AND ${dailyLogPhotos.dailyLogId} IS canonical.daily_log_id
            AND canonical.review_status IS 'approved'
            AND canonical.owner_visible IS 1
        )`),
      )
    )
    .orderBy(asc(dailyLogPhotos.sortOrder), asc(dailyLogPhotos.createdAt))

  const firstLog = selectedLogs[0]
  const lastLog = selectedLogs[selectedLogs.length - 1]
  if (firstLog === undefined || lastLog === undefined) {
    return { success: false, error: "Selected daily logs were not found." }
  }
  const updateId = crypto.randomUUID()
  const now = new Date().toISOString()
  const composerCandidates = await getOwnerUpdateComposerCandidates(
    db,
    projectId,
    firstLog.logDate,
    lastLog.logDate
  )

  await insertOwnerUpdateDraft(db, {
    id: updateId,
    projectId,
    createdBy: userId,
    title: ownerUpdateTitleFromLogs(label, firstLog.logDate, lastLog.logDate),
    updateDate: lastLog.logDate,
    summary: ownerUpdateSummaryFromLogs(selectedLogs),
    status: "draft",
    channel: "compass",
    sourceDailyLogIds: JSON.stringify(selectedLogs.map((log) => log.id)),
    selectedPhotoIds: JSON.stringify(ownerPhotos.map((photo) => photo.id)),
    periodStart: firstLog.logDate,
    periodEnd: lastLog.logDate,
    scheduleSnapshot: serializeOwnerUpdateComposerSnapshot({
      version: 2,
      ...composerCandidates,
      documents: [],
    }),
    createdAt: now,
    updatedAt: now,
  })

  return { success: true, updateId }
}

/** A blank draft for the date, covering the default reporting period before it. */
export async function createBlankOwnerUpdateDraft(
  db: Db,
  user: AuthUser,
  projectId: string,
  updateDate: string
): Promise<OwnerUpdateDraftResult> {
  const userId = user.id
  const normalizedDate = updateDate.trim()
  if (!isValidOwnerUpdatePeriod(normalizedDate, normalizedDate)) {
    return { success: false, error: "Enter a valid update date." }
  }

  const label = await projectLabel(db, projectId)
  if (label === null) {
    return { success: false, error: "Project not found." }
  }

  const updateId = crypto.randomUUID()
  const now = new Date().toISOString()
  const defaultPeriod = defaultOwnerUpdatePeriod(normalizedDate)
  const composerCandidates = await getOwnerUpdateComposerCandidates(
    db,
    projectId,
    defaultPeriod.startDate,
    normalizedDate
  )

  await insertOwnerUpdateDraft(db, {
    id: updateId,
    projectId,
    createdBy: userId,
    title: `${label} Owner Update - ${normalizedDate}`,
    updateDate: normalizedDate,
    summary: "",
    status: "draft",
    channel: "compass",
    sourceDailyLogIds: "[]",
    selectedPhotoIds: "[]",
    periodStart: defaultPeriod.startDate,
    periodEnd: normalizedDate,
    scheduleSnapshot: serializeOwnerUpdateComposerSnapshot({
      version: 2,
      ...composerCandidates,
      documents: [],
    }),
    createdAt: now,
    updatedAt: now,
  })

  return { success: true, updateId }
}

async function ownerUpdateVersion(
  db: Db,
  projectId: string,
  updateId: string
): Promise<{ readonly status: string; readonly revision: number; readonly updatedAt: string } | null> {
  const [update] = await db
    .select({
      id: ownerProjectUpdates.id,
      status: ownerProjectUpdates.status,
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
  return update ?? null
}

/** Only drafts are deleted, and only at the version the user saw. */
export async function deleteOwnerUpdateDraft(
  db: Db,
  projectId: string,
  updateId: string,
  version: OwnerUpdateMutationVersion
): Promise<OwnerUpdateMutationResult> {
  const update = await ownerUpdateVersion(db, projectId, updateId)

  if (!update) {
    return { success: false, error: "Owner update not found." }
  }
  if (update.status !== "draft") {
    return {
      success: false,
      error: "Only draft owner updates can be deleted.",
    }
  }

  const deleted = await deleteOwnerUpdateDraftAtVersion(db, { projectId, updateId, version })
  if (!deleted) {
    return {
      success: false,
      error:
        "This owner update changed while you were deleting. Refresh and review the latest version.",
    }
  }

  return { success: true, revision: update.revision, updatedAt: update.updatedAt }
}

/**
 * The files picked for a draft must be on the project, tied to a source log
 * or captured in the period, and in the right section. Returns the picked
 * documents in order.
 */
async function checkDraftAttachments(
  db: Db,
  input: {
    readonly projectId: string
    readonly periodStart: string
    readonly periodEnd: string
    readonly selectedPhotoIds: readonly string[]
    readonly selectedDocumentIds: readonly string[]
  }
): Promise<{ readonly success: true; readonly documents: readonly OwnerUpdateDocumentSelection[] } | Failure> {
  const { projectId, periodStart, periodEnd, selectedPhotoIds, selectedDocumentIds } = input
  const selectedAttachmentIds = [...selectedPhotoIds, ...selectedDocumentIds]
  if (selectedAttachmentIds.length === 0) return { success: true, documents: [] }

  const selectedAttachments = (
    await Promise.all(
      ownerUpdateIdBatches(selectedAttachmentIds).map((idBatch) =>
        db
          .select({
            id: dailyLogPhotos.id,
            dailyLogId: dailyLogPhotos.dailyLogId,
            sourceSystem: dailyLogPhotos.sourceSystem,
            fileName: dailyLogPhotos.fileName,
            mimeType: dailyLogPhotos.mimeType,
            driveFileId: dailyLogPhotos.driveFileId,
            driveUrl: dailyLogPhotos.driveUrl,
            thumbnailUrl: dailyLogPhotos.thumbnailUrl,
            caption: dailyLogPhotos.caption,
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
      error: "One or more selected files could not be found.",
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

  const selectedPhotoIdSet = new Set(selectedPhotoIds)
  const selectedDocumentIdSet = new Set(selectedDocumentIds)
  if (
    selectedAttachments.some(
      (attachment) =>
        ownerUpdateAttachmentKind(
          attachment.id,
          selectedPhotoIdSet,
          selectedDocumentIdSet
        ) === null
    )
  ) {
    return {
      success: false,
      error: "Photos and documents must be selected in the correct section.",
    }
  }

  const attachmentsById = new Map(
    selectedAttachments.map((attachment) => [attachment.id, attachment])
  )
  return {
    success: true,
    documents: selectedDocumentIds.flatMap((id) => {
      const attachment = attachmentsById.get(id)
      return attachment === undefined
        ? []
        : [ownerUpdateDocumentSelection(attachment)]
    }),
  }
}

/** Saves the editor's draft at the version it was opened at. */
export async function saveOwnerUpdateDraft(
  db: Db,
  projectId: string,
  updateId: string,
  input: OwnerUpdateDraftWriteInput
): Promise<OwnerUpdateMutationResult> {
  const title = input.title.trim()
  const updateDate = input.updateDate.trim()
  const periodStart = input.periodStart.trim()
  const periodEnd = input.periodEnd.trim()
  const summary = input.summary.trim()
  const sourceDailyLogIds = submittedIdList(input.sourceDailyLogIds)
  const selectedPhotoIds = submittedIdList(input.selectedPhotoIds)
  const selectedDocumentIds = submittedIdList(input.selectedDocumentIds)

  if (title.length === 0) {
    return { success: false, error: "Title is required." }
  }
  if (!isValidOwnerUpdatePeriod(updateDate, updateDate)) {
    return { success: false, error: "Enter a valid update date." }
  }
  if (!isValidOwnerUpdatePeriod(periodStart, periodEnd)) {
    return {
      success: false,
      error: "The reporting period must have valid start and end dates.",
    }
  }

  const update = await ownerUpdateVersion(db, projectId, updateId)
  if (!update) {
    return { success: false, error: "Owner update not found." }
  }
  if (update.status === "published") {
    return {
      success: false,
      error: "Published owner updates cannot be edited here.",
    }
  }

  if (sourceDailyLogIds.length > 0) {
    const selectedLogs = await projectDailyLogDates(db, projectId, sourceDailyLogIds)

    if (selectedLogs.length !== sourceDailyLogIds.length) {
      return {
        success: false,
        error: "One or more source daily logs could not be found.",
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
  }

  const attachments = await checkDraftAttachments(db, {
    projectId,
    periodStart,
    periodEnd,
    selectedPhotoIds,
    selectedDocumentIds,
  })
  if (!attachments.success) return attachments

  const candidates = await getOwnerUpdateComposerCandidates(
    db,
    projectId,
    periodStart,
    periodEnd
  )
  // Keyed by id, as the candidates may repeat an item.
  const completedById = new Map(
    candidates.completedScheduleItems.map((item) => [item.id, item])
  )
  const lookAheadById = new Map(
    candidates.lookAheadScheduleItems.map((item) => [item.id, item])
  )
  const todosById = new Map(candidates.todos.map((item) => [item.id, item]))

  const composerSnapshot: OwnerUpdateComposerSnapshot = {
    version: 2,
    completedScheduleItems: reconcileSubmittedScheduleSelections(
      input.completedScheduleItems,
      [...completedById.values()]
    ),
    lookAheadScheduleItems: reconcileSubmittedScheduleSelections(
      input.lookAheadScheduleItems,
      [...lookAheadById.values()]
    ),
    todos: reconcileSubmittedTodos(input.todos, [...todosById.values()]),
    documents: attachments.documents,
  }

  const updated = await saveOwnerUpdateDraftAtVersion(
    db,
    {
      projectId,
      updateId,
      version: { revision: input.expectedRevision, updatedAt: input.expectedUpdatedAt },
    },
    {
      title,
      updateDate,
      periodStart,
      periodEnd,
      summary,
      sourceDailyLogIds: JSON.stringify(sourceDailyLogIds),
      selectedPhotoIds: JSON.stringify(selectedPhotoIds),
      scheduleSnapshot: serializeOwnerUpdateComposerSnapshot(composerSnapshot),
    },
    new Date().toISOString()
  )
  if (!updated) {
    return {
      success: false,
      error:
        "This owner update changed while you were saving. Refresh and review the latest version.",
    }
  }

  return { success: true, ...updated }
}

/** Writes the draft's summary with the company's AI provider. */
export async function draftOwnerUpdateSummary(
  db: Db,
  projectId: string,
  updateId: string
): Promise<
  | ({ readonly success: true; readonly summary: string } & OwnerUpdateMutationVersion)
  | Failure
> {
  const [update] = await db
    .select({
      id: ownerProjectUpdates.id,
      title: ownerProjectUpdates.title,
      status: ownerProjectUpdates.status,
      revision: ownerProjectUpdates.revision,
      updatedAt: ownerProjectUpdates.updatedAt,
      periodStart: ownerProjectUpdates.periodStart,
      periodEnd: ownerProjectUpdates.periodEnd,
      sourceDailyLogIds: ownerProjectUpdates.sourceDailyLogIds,
      selectedPhotoIds: ownerProjectUpdates.selectedPhotoIds,
      scheduleSnapshot: ownerProjectUpdates.scheduleSnapshot,
      projectName: projects.name,
      projectNumber: projects.projectNumber,
    })
    .from(ownerProjectUpdates)
    .innerJoin(projects, eq(ownerProjectUpdates.projectId, projects.id))
    .where(
      and(
        eq(ownerProjectUpdates.id, updateId),
        eq(ownerProjectUpdates.projectId, projectId)
      )
    )
    .limit(1)

  if (!update || update.status === "published") {
    return {
      success: false,
      error: "Only an owner update draft can be drafted with Jarvis.",
    }
  }
  if (
    update.periodStart === null ||
    update.periodEnd === null ||
    !isValidOwnerUpdatePeriod(update.periodStart, update.periodEnd)
  ) {
    return {
      success: false,
      error: "Save a valid reporting period before asking Jarvis.",
    }
  }

  const sourceDailyLogIds = parseIdList(update.sourceDailyLogIds)
  const selectedLogs = (
    await Promise.all(
      ownerUpdateIdBatches(sourceDailyLogIds).map((idBatch) =>
        db
          .select({
            id: dailyLogs.id,
            logDate: dailyLogs.logDate,
            workCompleted: dailyLogs.workCompleted,
            issues: dailyLogs.issues,
            notes: dailyLogs.notes,
          })
          .from(dailyLogs)
          .where(
            and(
              eq(dailyLogs.projectId, projectId),
              inArray(dailyLogs.id, idBatch)
            )
          )
          .orderBy(asc(dailyLogs.logDate), asc(dailyLogs.createdAt))
      )
    )
  ).flat()
  const selectedLogById = new Map(selectedLogs.map((log) => [log.id, log]))
  const orderedLogs = sourceDailyLogIds.flatMap((id) => {
    const log = selectedLogById.get(id)
    return log === undefined ? [] : [log]
  })
  const composerSnapshot = parseOwnerUpdateComposerSnapshot(
    update.scheduleSnapshot
  )
  const selectedPhotoIds = parseIdList(update.selectedPhotoIds)
  const selectedDocumentIds = composerSnapshot.documents.map(
    (document) => document.id
  )
  const selectedPhotoIdSet = new Set(selectedPhotoIds)
  const selectedDocumentIdSet = new Set(selectedDocumentIds)
  const selectedAttachmentIds = [...selectedPhotoIds, ...selectedDocumentIds]
  const selectedAttachments = (
    await Promise.all(
      ownerUpdateIdBatches(selectedAttachmentIds).map((idBatch) =>
        db
          .select({
            id: dailyLogPhotos.id,
            fileName: dailyLogPhotos.fileName,
            mimeType: dailyLogPhotos.mimeType,
            thumbnailUrl: dailyLogPhotos.thumbnailUrl,
            caption: dailyLogPhotos.caption,
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
  const selectedAttachmentById = new Map(
    selectedAttachments.map((attachment) => [attachment.id, attachment])
  )
  const orderedAttachments = selectedAttachmentIds.flatMap((id) => {
    const attachment = selectedAttachmentById.get(id)
    if (attachment === undefined) return []
    const kind = ownerUpdateAttachmentKind(
      attachment.id,
      selectedPhotoIdSet,
      selectedDocumentIdSet
    )
    if (kind === null) return []
    return [
      {
        fileName: attachment.fileName,
        caption: attachment.caption,
        kind,
      },
    ]
  })
  const prompt = buildOwnerUpdateDraftPrompt({
    projectLabel: update.projectNumber ?? update.projectName,
    periodStart: update.periodStart,
    periodEnd: update.periodEnd,
    dailyLogs: orderedLogs,
    attachments: orderedAttachments,
    completedScheduleItems: composerSnapshot.completedScheduleItems,
    lookAheadScheduleItems: composerSnapshot.lookAheadScheduleItems,
    todos: composerSnapshot.todos,
  }).slice(0, OWNER_UPDATE_PROMPT_MAX_CHARACTERS)

  // Drafting runs on the organization's AI provider directly, not the
  // private Jarvis relay, so owner-update content never reaches Signet.
  const { env } = await getCloudflareContext()
  const result = await generateOrganizationText({
    db,
    env: Object.fromEntries(
      Object.entries(env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    ),
    systemPrompt:
      "You write owner-facing construction project updates for Compass.",
    prompt,
  })
  if (!result.success) {
    return { success: false, error: result.error }
  }

  const summary = cleanOwnerUpdateDraft(result.text)
  if (summary.length === 0) {
    return { success: false, error: "Jarvis returned an empty draft." }
  }

  const updated = await saveOwnerUpdateSummaryAtVersion(
    db,
    {
      projectId,
      updateId,
      version: { revision: update.revision, updatedAt: update.updatedAt },
    },
    summary,
    new Date().toISOString()
  )
  if (!updated) {
    return {
      success: false,
      error:
        "This owner update changed while Jarvis was drafting. Refresh and review the latest version.",
    }
  }

  return { success: true, summary, ...updated }
}
