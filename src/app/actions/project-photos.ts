"use server"

import { and, asc, desc, eq, not, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { dailyLogPhotos, dailyLogs, projectPhotoSourceDates, projects, scheduleTasks } from "@/db/schema"
import { errorMessage } from "@/lib/action-result"
import { recordActivityEvent } from "@/lib/activity-log"
import { normalizedPhotoKind, normalizedPhotoReviewStatus } from "@/lib/domain/field/rules"
import { planPhotoDelete } from "@/lib/domain/field/photo-delete"
import { deleteDailyLogPhotos, setPhotoPermissions, setPhotoPhaseOverride } from "@/lib/domain/field/store"
import { getOrganizationDriveContext } from "@/lib/google/organization-drive"
import { projectContext, type ProjectContext } from "@/lib/server/action-context"
import { dailyLogPhotoCollectionEligibility } from "@/lib/photos/collection-eligibility"
import { resolveProjectPhotoDate } from "@/lib/photos/date"
import { PHOTO_DELETE_BATCH_LIMIT, SELECTION_PHOTO_KIND } from "@/lib/photos/review"
import { isInternalStaffRole } from "@/lib/user-roles"

export type ProjectPhotoLibraryItem = {
  readonly id: string
  readonly projectId: string
  readonly dailyLogId: string | null
  readonly sourceSystem: string
  readonly fileName: string
  readonly mimeType: string | null
  readonly driveFileId: string | null
  readonly driveUrl: string | null
  readonly thumbnailUrl: string | null
  readonly caption: string | null
  readonly capturedAt: string | null
  readonly logDate: string | null
  readonly photoDate: string | null
  readonly reviewStatus: string
  readonly ownerVisible: boolean
  readonly subVendorVisible: boolean
  readonly publicShareable: boolean
  readonly photoKind: string
  readonly schedulePhase: string
  readonly schedulePhaseConfidence: number
  readonly schedulePhaseReason: string
}

type ProjectPhotoPhaseOption = {
  readonly value: string
  readonly label: string
  readonly count: number
}

export type ProjectPhotoLibrary = {
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
  }
  readonly photos: readonly ProjectPhotoLibraryItem[]
  readonly phases: readonly ProjectPhotoPhaseOption[]
}

type PhotoPermissionInput = {
  readonly photoIds: readonly string[]
  readonly reviewStatus: string
  readonly ownerVisible: boolean
  readonly subVendorVisible: boolean
  readonly publicShareable: boolean
  readonly photoKind: string
}

type UpdateResult =
  | { readonly success: true; readonly updatedCount: number }
  | { readonly success: false; readonly error: string }

type UpdatePhotoPhaseResult =
  | { readonly success: true; readonly phase: string }
  | { readonly success: false; readonly error: string }

/** Photo actions are staff work inside the project's own organization. */
async function photoContext(
  projectId: string,
  mutation: boolean
): Promise<ProjectContext> {
  const context = await projectContext(projectId, {
    scope: "organization",
    feature: "project-photos",
    mutation,
  })
  if (!context.success) throw new Error(context.error)
  return context.data
}

function isImage(value: {
  readonly mimeType: string | null
  readonly thumbnailUrl: string | null
}): boolean {
  return value.thumbnailUrl !== null || value.mimeType?.startsWith("image/") === true
}

function phaseOptions(
  photos: readonly ProjectPhotoLibraryItem[],
  phases: readonly string[]
): readonly ProjectPhotoPhaseOption[] {
  const counts = new Map<string, number>()
  for (const photo of photos) {
    if (photo.schedulePhase.length > 0) {
      counts.set(photo.schedulePhase, (counts.get(photo.schedulePhase) ?? 0) + 1)
    }
  }

  return [...new Set([...phases, ...counts.keys()])]
    .filter((phase) => phase.trim().length > 0)
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: value, count: counts.get(value) ?? 0 }))
}

export async function getProjectPhotoLibrary(
  projectId: string
): Promise<ProjectPhotoLibrary> {
  const { db, user: viewer } = await photoContext(projectId, false)

  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) {
    throw new Error("Project not found")
  }

  const rows = await db
    .select({
      id: dailyLogPhotos.id,
      projectId: dailyLogPhotos.projectId,
      dailyLogId: dailyLogPhotos.dailyLogId,
      sourceSystem: dailyLogPhotos.sourceSystem,
      fileName: dailyLogPhotos.fileName,
      mimeType: dailyLogPhotos.mimeType,
      driveFileId: dailyLogPhotos.driveFileId,
      driveUrl: dailyLogPhotos.driveUrl,
      thumbnailUrl: dailyLogPhotos.thumbnailUrl,
      caption: dailyLogPhotos.caption,
      capturedAt: dailyLogPhotos.capturedAt,
      sourceDate: projectPhotoSourceDates.sourceDate,
      reviewStatus: dailyLogPhotos.reviewStatus,
      ownerVisible: dailyLogPhotos.ownerVisible,
      subVendorVisible: dailyLogPhotos.subVendorVisible,
      publicShareable: dailyLogPhotos.publicShareable,
      photoKind: dailyLogPhotos.photoKind,
      schedulePhaseOverride: dailyLogPhotos.schedulePhaseOverride,
      createdAt: dailyLogPhotos.createdAt,
      logDate: dailyLogs.logDate,
      logWorkCompleted: dailyLogs.workCompleted,
      logIssues: dailyLogs.issues,
      logNotes: dailyLogs.notes,
    })
    .from(dailyLogPhotos)
    .leftJoin(dailyLogs, eq(dailyLogPhotos.dailyLogId, dailyLogs.id))
    .leftJoin(projectPhotoSourceDates, and(
      eq(projectPhotoSourceDates.projectId, dailyLogPhotos.projectId),
      eq(projectPhotoSourceDates.sourceSystem, dailyLogPhotos.sourceSystem),
      eq(projectPhotoSourceDates.sourceExternalId, dailyLogPhotos.sourceExternalId),
    ))
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
        )`),
      ),
    )
    .orderBy(desc(dailyLogPhotos.capturedAt), desc(dailyLogPhotos.createdAt))

  const tasks = isInternalStaffRole(viewer.role) || viewer.role === "developer"
    ? await db
    .select({
      phase: scheduleTasks.phase,
      sortOrder: scheduleTasks.sortOrder,
    })
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))
    .orderBy(asc(scheduleTasks.sortOrder), asc(scheduleTasks.startDate))
    : []
  const phaseNames = [...new Set(tasks.map((task) => task.phase))]

  const photos = rows.filter(isImage).map((row) => {
    const resolvedPhotoDate = resolveProjectPhotoDate({
      sourceSystem: row.sourceSystem,
      capturedAt: row.capturedAt,
      sourceDate: row.sourceDate,
      logDate: row.logDate,
    })
    const schedulePhase = row.schedulePhaseOverride?.trim() ?? ""

    return {
      id: row.id,
      projectId: row.projectId,
      dailyLogId: row.dailyLogId,
      sourceSystem: row.sourceSystem,
      fileName: row.fileName,
      mimeType: row.mimeType,
      driveFileId: row.driveFileId,
      driveUrl: row.driveUrl,
      thumbnailUrl: row.thumbnailUrl,
      caption: row.caption,
      capturedAt: row.capturedAt,
      logDate: row.logDate,
      photoDate: resolvedPhotoDate,
      reviewStatus: row.reviewStatus,
      ownerVisible: row.ownerVisible,
      subVendorVisible: row.subVendorVisible,
      publicShareable: row.publicShareable,
      photoKind: row.photoKind,
      schedulePhase,
      schedulePhaseConfidence: schedulePhase.length > 0 ? 100 : 0,
      schedulePhaseReason:
        schedulePhase.length > 0
          ? "Phase was selected during upload or review."
          : "No phase assigned.",
    }
  })

  return {
    project,
    photos,
    phases: phaseOptions(photos, phaseNames),
  }
}

export async function updateProjectPhotoPhase(
  projectId: string,
  photoId: string,
  phase: string
): Promise<UpdatePhotoPhaseResult> {
  try {
    const context = await projectContext(projectId, {
      scope: "organization",
      feature: "project-photos",
      mutation: true,
    })
    if (!context.success) return context
    const { db } = context.data

    const normalizedPhase = phase.trim() === "unassigned" ? "" : phase.trim()

    await setPhotoPhaseOverride(db, {
      projectId,
      photoId,
      phase: normalizedPhase.length > 0 ? normalizedPhase : null,
      now: new Date().toISOString(),
    })

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/photos`)
    revalidatePath(`/dashboard/projects/${projectId}/preview/owner`)
    revalidatePath(`/dashboard/projects/${projectId}/preview/sub-vendor`)

    return { success: true, phase: normalizedPhase }
  } catch (error) {
    return {
      success: false,
      error: errorMessage(error, "Unable to update photo phase"),
    }
  }
}

export async function updateProjectPhotoPermissions(
  projectId: string,
  input: PhotoPermissionInput
): Promise<UpdateResult> {
  try {
    const context = await projectContext(projectId, {
      scope: "organization",
      feature: "project-photos",
      mutation: true,
    })
    if (!context.success) return context
    const { db } = context.data

    const photoIds = [...new Set(input.photoIds)].filter(
      (id) => id.trim().length > 0
    )
    if (photoIds.length === 0) {
      return { success: false, error: "Select at least one photo." }
    }
    const photoKind = normalizedPhotoKind(input.photoKind)
    // Photos never turns a photo into a selection photo: it would leave the
    // gallery without being attached to any selection.
    if (photoKind === SELECTION_PHOTO_KIND) {
      return { success: false, error: "Selection photos are in Selections. Pick another photo type." }
    }

    await setPhotoPermissions(db, {
      projectId,
      photoIds,
      values: {
        reviewStatus: normalizedPhotoReviewStatus(input.reviewStatus),
        ownerVisible: input.ownerVisible,
        subVendorVisible: input.subVendorVisible,
        publicShareable: input.publicShareable,
        photoKind,
        updatedAt: new Date().toISOString(),
      },
    })

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/photos`)

    return { success: true, updatedCount: photoIds.length }
  } catch (error) {
    return {
      success: false,
      error: errorMessage(error, "Unable to update photos"),
    }
  }
}

type DeletePhotosResult =
  | {
      readonly success: true
      readonly deletedIds: readonly string[]
      readonly deletedCount: number
      readonly keptInUse: number
      readonly driveTrashFailed: number
    }
  | { readonly success: false; readonly error: string }

/**
 * Deletes selected photos, with their hidden duplicate copies, for staff who
 * can change photo visibility. Projects whose records are held (imported
 * conversations staff-only, e.g. a legal hold) refuse. A full copy of every
 * row goes to Activity before anything is removed, and the Drive files go to
 * the Drive trash, so a delete can be undone.
 */
export async function deleteProjectPhotos(
  projectId: string,
  photoIds: readonly string[]
): Promise<DeletePhotosResult> {
  try {
    const context = await projectContext(projectId, {
      scope: "organization",
      feature: "project-photos",
      mutation: true,
    })
    if (!context.success) return context
    const { db, env, user } = context.data

    const ids = [...new Set(photoIds.map((id) => id.trim()).filter((id) => id.length > 0))]
    if (ids.length === 0) return { success: false, error: "Select at least one photo." }
    if (ids.length > PHOTO_DELETE_BATCH_LIMIT) {
      return { success: false, error: `Delete at most ${PHOTO_DELETE_BATCH_LIMIT} photos at a time.` }
    }

    const [project] = await db
      .select({ organizationId: projects.organizationId, held: projects.importedConversationsStaffOnly })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
    if (!project?.organizationId) return { success: false, error: "Project not found" }
    const { organizationId } = project
    if (project.held) {
      return { success: false, error: "This project's records are on hold, so its photos can't be deleted." }
    }

    const plan = await planPhotoDelete(db, { projectId, photoIds: ids })
    if (plan.rows.length > 0) {
      // Record first so a failed audit write never leaves an unrecorded delete.
      await recordActivityEvent({
        db,
        organizationId,
        projectId,
        actor: user,
        category: "file",
        action: "photos.deleted",
        entityType: "daily_log_photo",
        entityId: null,
        summary: `Deleted ${plan.selectedCount} photo${plan.selectedCount === 1 ? "" : "s"}.`,
        metadata: {
          selectedCount: plan.selectedCount,
          hiddenCopies: plan.aliasCount,
          driveFileIds: plan.driveFileIds,
          // Imports skip these, so a re-run never brings a deleted photo back.
          sourceRecords: plan.rows.flatMap((row) =>
            row.sourceExternalId ? [`${row.sourceSystem}:${row.sourceExternalId}`] : []
          ),
          // Full copy of the records for recovery.
          photos: JSON.stringify(plan.rows),
        },
      })
      await deleteDailyLogPhotos(db, projectId, plan.rows.map((row) => row.id))
    }

    let driveTrashFailed = 0
    if (plan.driveFileIds.length > 0) {
      const drive = await getOrganizationDriveContext({
        db,
        environment: env,
        organizationId,
        user,
      }).catch(() => null)
      for (const fileId of plan.driveFileIds) {
        try {
          if (!drive) throw new Error("Drive is not connected")
          await drive.client.trashFile(drive.userEmail, fileId)
        } catch {
          driveTrashFailed += 1
        }
      }
    }

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/photos`)
    revalidatePath(`/dashboard/projects/${projectId}/preview/owner`)
    revalidatePath(`/dashboard/projects/${projectId}/preview/sub-vendor`)

    const selectedDeleted = new Set(plan.rows.map((row) => row.id))
    return {
      success: true,
      deletedIds: ids.filter((id) => selectedDeleted.has(id)),
      deletedCount: plan.selectedCount,
      keptInUse: plan.keptInUse,
      driveTrashFailed,
    }
  } catch (error) {
    return {
      success: false,
      error: errorMessage(error, "Unable to delete photos"),
    }
  }
}
