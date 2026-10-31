"use server"

/**
 * Field server actions: daily logs, weather and owner updates. Each action
 * resolves access, calls the field domain module (src/lib/domain/field) and
 * revalidates the pages it changed.
 */
import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { projectOperations } from "@/db/schema"
import { internalDutyEntries } from "@/db/schema-internal-duties"
import { recordActivityEvent } from "@/lib/activity-log"
import { applyDailyLogFollowUps } from "@/lib/daily-logs/log-followups-server"
import {
  isInternalFieldViewer,
  verifyDailyLogStaffMutationAccess,
  verifyOwnerUpdateMutationAccess,
  verifyOwnerUpdateReadAccess,
  verifyProjectDailyLogWorkspaceAccess,
  verifyProjectMutationAccess,
} from "@/lib/domain/field/access"
import { loadProjectDailyLogWorkspace, type ProjectDailyLogWorkspace } from "@/lib/domain/field/daily-log-workspace"
import {
  checkDailyLogEdit,
  createDailyLog,
  dailyLogMoveBlocker,
  findProjectDailyLog,
  replaceEditedWorkLines,
  reviewDailyLog,
  type CreateDailyLogInput,
  type UpdateDailyLogInput,
} from "@/lib/domain/field/daily-logs"
import {
  loadOwnerUpdateProjectHeader,
  loadProjectFieldSummary,
  loadProjectOwnerUpdates,
  type ProjectFieldSummary,
  type ProjectOwnerUpdateListItem,
} from "@/lib/domain/field/field-summary"
import {
  loadOwnerProjectUpdateDocument,
  type OwnerProjectUpdateDocument,
} from "@/lib/domain/field/owner-update-document"
import {
  createBlankOwnerUpdateDraft,
  deleteOwnerUpdateDraft,
  draftOwnerUpdateFromLogs,
  draftOwnerUpdateSummary,
  saveOwnerUpdateDraft,
  type OwnerUpdateDraftResult,
} from "@/lib/domain/field/owner-update-drafts"
import { publishOwnerUpdate, recallOwnerUpdate } from "@/lib/domain/field/owner-update-publish"
import {
  deleteDailyLogTaskLinks,
  moveDailyLogPhotosToProject,
  updateDailyLogContent,
} from "@/lib/domain/field/store"
import { projectWeatherSnapshot, type ProjectWeatherSnapshotResult } from "@/lib/domain/field/weather"
import type { OwnerUpdateDraftWriteInput } from "@/lib/owner-updates/draft-recovery"
import type {
  OwnerUpdateMutationResult,
  OwnerUpdateMutationVersion,
} from "@/lib/owner-updates/draft-publish"
import { announceOwnerUpdatePublished } from "@/lib/owner-updates/publish-notice"
import { assertAudiencePreviewWriteAllowed } from "@/lib/project-audience-request-server"

export type {
  OwnerProjectUpdateDocument,
  ProjectFieldSummary,
  ProjectOwnerUpdateListItem,
}
export type {
  ProjectDailyLogItem,
  ProjectDailyLogPhoto,
  ProjectDailyLogWorkspace,
} from "@/lib/domain/field/daily-log-workspace"

type DailyLogMutationResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

type CreateDailyLogResult =
  | { readonly success: true; readonly dailyLogId: string }
  | { readonly success: false; readonly error: string }

type UpdateDailyLogResult =
  | { readonly success: true; readonly projectId: string }
  | { readonly success: false; readonly error: string }

function failure(error: unknown, fallback: string): { readonly success: false; readonly error: string } {
  return { success: false, error: error instanceof Error ? error.message : fallback }
}

function revalidateProjectField(projectId: string, sections: readonly string[]): void {
  revalidatePath(`/dashboard/projects/${projectId}`)
  for (const section of sections) {
    revalidatePath(`/dashboard/projects/${projectId}/${section}`)
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getOwnerUpdatePageCapabilities(
  projectId: string
): Promise<{ readonly canManage: boolean }> {
  const { viewer } = await verifyOwnerUpdateReadAccess(projectId)
  return { canManage: isInternalFieldViewer(viewer) }
}

export async function getProjectFieldSummary(
  projectId: string
): Promise<ProjectFieldSummary> {
  const { db, viewer } = await verifyOwnerUpdateReadAccess(projectId)
  return loadProjectFieldSummary(db, viewer, projectId)
}

export async function getProjectOwnerUpdates(
  projectId: string
): Promise<readonly ProjectOwnerUpdateListItem[]> {
  const { db, viewer } = await verifyOwnerUpdateReadAccess(projectId)
  return loadProjectOwnerUpdates(db, viewer, projectId)
}

export async function getOwnerUpdateProjectHeader(projectId: string): Promise<{
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
}> {
  const { db, viewer } = await verifyOwnerUpdateReadAccess(projectId)
  return loadOwnerUpdateProjectHeader(db, viewer, projectId)
}

export async function getProjectDailyLogWorkspace(
  projectId: string
): Promise<ProjectDailyLogWorkspace> {
  const { db, viewer } = await verifyProjectDailyLogWorkspaceAccess(projectId)
  return loadProjectDailyLogWorkspace(db, viewer, projectId)
}

export async function getOwnerProjectUpdateDocument(
  projectId: string,
  updateId: string
): Promise<OwnerProjectUpdateDocument> {
  const { db, viewer } = await verifyOwnerUpdateReadAccess(projectId)
  return loadOwnerProjectUpdateDocument(db, viewer, projectId, updateId)
}

export async function getProjectWeatherSnapshot(
  projectId: string,
  input?: { readonly logDate?: string }
): Promise<ProjectWeatherSnapshotResult> {
  try {
    const { db } = await verifyProjectDailyLogWorkspaceAccess(projectId)
    return await projectWeatherSnapshot(db, projectId, input?.logDate)
  } catch (error) {
    return failure(error, "Unable to pull project weather.")
  }
}

// ---------------------------------------------------------------------------
// Daily logs
// ---------------------------------------------------------------------------

export async function createProjectDailyLog(
  projectId: string,
  input: CreateDailyLogInput
): Promise<CreateDailyLogResult> {
  try {
    await assertAudiencePreviewWriteAllowed()
    const { db, orgId, user } = await verifyDailyLogStaffMutationAccess(projectId)
    const created = await createDailyLog(db, { user, orgId }, projectId, input)
    if (!created.success) return created
    if (created.existing) return { success: true, dailyLogId: created.dailyLogId }

    if (created.followUpsApplied) {
      revalidatePath(`/dashboard/projects/${projectId}/todos`)
      revalidatePath(`/dashboard/projects/${projectId}/information`)
    }
    revalidateProjectField(projectId, ["daily-logs", "owner-updates"])

    return { success: true, dailyLogId: created.dailyLogId }
  } catch (error) {
    return failure(error, "Unable to create daily log.")
  }
}

/**
 * Edits a log, optionally moving it to another project. The to-do and cost
 * code line moves stay here until the operations and internal-duty modules
 * own those tables.
 */
export async function updateProjectDailyLog(
  projectId: string,
  input: UpdateDailyLogInput
): Promise<UpdateDailyLogResult> {
  try {
    await assertAudiencePreviewWriteAllowed()
    const { db, orgId, user } = await verifyDailyLogStaffMutationAccess(projectId)
    const userId = user.id
    const dailyLogId = input.dailyLogId.trim()
    const targetProjectId = input.targetProjectId.trim()

    if (dailyLogId.length === 0) {
      return { success: false, error: "Daily log is required." }
    }
    if (targetProjectId.length === 0) {
      return { success: false, error: "Project is required." }
    }

    const existing = await findProjectDailyLog(db, projectId, dailyLogId)
    if (!existing) {
      return { success: false, error: "Daily log not found." }
    }

    const edit = await checkDailyLogEdit(db, orgId, dailyLogId, targetProjectId, input)
    if (!edit.success) return edit
    const { logDate, workCompleted, now, checked, lineTodos } = edit
    const moving = targetProjectId !== projectId

    if (moving) {
      await verifyDailyLogStaffMutationAccess(targetProjectId)

      const blocker = await dailyLogMoveBlocker(db, projectId, dailyLogId)
      if (blocker) return { success: false, error: blocker }

      await moveDailyLogPhotosToProject(db, {
        dailyLogId,
        fromProjectId: projectId,
        toProjectId: targetProjectId,
        now,
      })

      await db
        .update(projectOperations)
        .set({
          projectId: targetProjectId,
          updatedAt: now,
        })
        .where(
          and(
            eq(projectOperations.projectId, projectId),
            eq(projectOperations.sourceRecordId, dailyLogId)
          )
        )

      // Schedule items belong to a specific project, so their association
      // cannot safely follow a daily log that moves to another project.
      await deleteDailyLogTaskLinks(db, dailyLogId)
    }

    await updateDailyLogContent(db, { dailyLogId, projectId, values: edit.values })

    if (checked) {
      await replaceEditedWorkLines(db, {
        orgId,
        projectId: targetProjectId,
        dailyLogId,
        logDate,
        userId: existing.authorId ?? userId,
        createdBy: userId,
        checked,
      })
    } else if (moving) {
      await db
        .update(internalDutyEntries)
        .set({ projectId: targetProjectId, updatedAt: now })
        .where(eq(internalDutyEntries.dailyLogId, dailyLogId))
    }
    if (lineTodos) {
      await applyDailyLogFollowUps(db, {
        organizationId: orgId,
        projectId: targetProjectId,
        dailyLogId,
        logDate,
        creator: user,
        workCompleted,
        lines: [],
        checked: lineTodos,
      })
      revalidatePath(`/dashboard/projects/${targetProjectId}/todos`)
    }

    revalidateProjectField(projectId, ["daily-logs", "owner-updates"])
    if (moving) {
      revalidateProjectField(targetProjectId, ["daily-logs", "owner-updates"])
    }

    return { success: true, projectId: targetProjectId }
  } catch (error) {
    return failure(error, "Unable to update daily log.")
  }
}

export async function updateDailyLogReview(
  projectId: string,
  input: {
    readonly dailyLogId: string
    readonly reviewStatus: string
    readonly isClientVisible: boolean
  }
): Promise<DailyLogMutationResult> {
  try {
    await assertAudiencePreviewWriteAllowed()
    const { db } = await verifyProjectMutationAccess(projectId)
    const reviewed = await reviewDailyLog(db, projectId, input)
    if (!reviewed.success) return reviewed

    revalidateProjectField(projectId, ["daily-logs"])

    return { success: true }
  } catch (error) {
    return failure(error, "Unable to update daily log.")
  }
}

// ---------------------------------------------------------------------------
// Owner update drafts
// ---------------------------------------------------------------------------

export async function draftOwnerUpdateFromDailyLogs(
  projectId: string,
  input: { readonly dailyLogIds: readonly string[] }
): Promise<OwnerUpdateDraftResult> {
  try {
    await assertAudiencePreviewWriteAllowed()
    const { db, user } = await verifyOwnerUpdateMutationAccess(projectId)
    const drafted = await draftOwnerUpdateFromLogs(db, user, projectId, input.dailyLogIds)
    if (!drafted.success) return drafted

    revalidateProjectField(projectId, ["daily-logs", "owner-updates", `owner-updates/${drafted.updateId}`])

    return drafted
  } catch (error) {
    return failure(error, "Unable to draft owner update.")
  }
}

export async function createManualOwnerProjectUpdateDraft(
  projectId: string,
  updateDate: string
): Promise<OwnerUpdateDraftResult> {
  try {
    await assertAudiencePreviewWriteAllowed()
    const { db, user } = await verifyOwnerUpdateMutationAccess(projectId)
    const created = await createBlankOwnerUpdateDraft(db, user, projectId, updateDate)
    if (!created.success) return created

    revalidateProjectField(projectId, ["owner-updates", `owner-updates/${created.updateId}`])

    return created
  } catch (error) {
    return failure(error, "Unable to create owner update.")
  }
}

export async function deleteOwnerProjectUpdateDraft(
  projectId: string,
  updateId: string,
  version: OwnerUpdateMutationVersion
): Promise<OwnerUpdateMutationResult> {
  try {
    await assertAudiencePreviewWriteAllowed()
    const { db } = await verifyOwnerUpdateMutationAccess(projectId)
    const deleted = await deleteOwnerUpdateDraft(db, projectId, updateId, version)
    if (!deleted.success) return deleted

    revalidateProjectField(projectId, ["owner-updates"])

    return deleted
  } catch (error) {
    return failure(error, "Unable to delete owner update.")
  }
}

export async function updateOwnerProjectUpdateDraft(
  projectId: string,
  updateId: string,
  input: OwnerUpdateDraftWriteInput
): Promise<OwnerUpdateMutationResult> {
  try {
    await assertAudiencePreviewWriteAllowed()
    const { db } = await verifyOwnerUpdateMutationAccess(projectId)
    const saved = await saveOwnerUpdateDraft(db, projectId, updateId, input)
    if (!saved.success) return saved

    revalidateProjectField(projectId, ["owner-updates", `owner-updates/${updateId}`])

    return saved
  } catch (error) {
    return failure(error, "Unable to update owner draft.")
  }
}

export async function draftOwnerProjectUpdateWithJarvis(
  projectId: string,
  updateId: string
): Promise<
  | ({ readonly success: true; readonly summary: string } & OwnerUpdateMutationVersion)
  | { readonly success: false; readonly error: string }
> {
  try {
    await assertAudiencePreviewWriteAllowed()
    const { db } = await verifyOwnerUpdateMutationAccess(projectId)
    const drafted = await draftOwnerUpdateSummary(db, projectId, updateId)
    if (!drafted.success) return drafted

    revalidatePath(`/dashboard/projects/${projectId}/owner-updates`)
    revalidatePath(`/dashboard/projects/${projectId}/owner-updates/${updateId}`)

    return drafted
  } catch (error) {
    return failure(error, "Jarvis could not draft this owner update.")
  }
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

/** Access failures throw here (no try/catch), as the draft route expects. */
export async function publishOwnerProjectUpdate(
  projectId: string,
  updateId: string,
  version: OwnerUpdateMutationVersion
): Promise<OwnerUpdateMutationResult> {
  const { db, user } = await verifyOwnerUpdateMutationAccess(projectId)
  const orgId = user.organizationId
  if (!orgId) {
    return { success: false, error: "Active organization is required" }
  }

  const published = await publishOwnerUpdate(db, {
    organizationId: orgId,
    projectId,
    updateId,
    version,
  })
  if (!published.success) return published
  const result = { success: true, revision: published.revision, updatedAt: published.updatedAt } as const
  if (published.published === null) return result

  await announceOwnerUpdatePublished({
    db,
    organizationId: orgId,
    projectId,
    updateId,
    title: published.published.title,
    actor: user,
  })

  revalidatePath(`/dashboard/projects/${projectId}`)
  revalidatePath(`/dashboard/projects/${projectId}/owner-updates/${updateId}`)

  return result
}

export async function recallOwnerProjectUpdate(
  projectId: string,
  updateId: string,
  version: OwnerUpdateMutationVersion
): Promise<OwnerUpdateMutationResult> {
  try {
    await assertAudiencePreviewWriteAllowed()
    const { db, user } = await verifyOwnerUpdateMutationAccess(projectId)
    const orgId = user.organizationId
    if (!orgId) {
      return { success: false, error: "Active organization is required" }
    }

    const recalled = await recallOwnerUpdate(db, {
      organizationId: orgId,
      projectId,
      updateId,
      version,
      recalledBy: user.id,
    })
    if (!recalled.success) return recalled
    const result = { success: true, revision: recalled.revision, updatedAt: recalled.updatedAt } as const
    if (!recalled.recalled) return result

    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId,
      actor: user,
      category: "field",
      action: "owner_update_recalled",
      entityType: "owner_project_update",
      entityId: updateId,
      summary: "Recalled a published owner update to draft.",
    })

    revalidateProjectField(projectId, ["owner-updates", `owner-updates/${updateId}`, "preview/owner"])

    return result
  } catch (error) {
    return failure(error, "Unable to recall this owner update.")
  }
}
