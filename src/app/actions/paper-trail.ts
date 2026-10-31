"use server"

import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { projects } from "@/db/schema"
import { projectRecordDriveFiles, type PaperTrailFileStatus, type PaperTrailRecordType } from "@/db/schema-paper-trail"
import { requireAuth } from "@/lib/auth"
import { isDemoUser } from "@/lib/demo"
import { insertRecordDriveFile, updateRecordDriveFile, updateRecordDriveFilesReturningIds } from "@/lib/domain/documents/store"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { PAPER_TRAIL_RECORDS, paperTrailAllows } from "@/lib/paper-trail/record-types"
import { requireOrg } from "@/lib/org-scope"
import { canEditFeatureSettings } from "@/lib/feature-settings/registry"
import { projectNumberAndName } from "@/lib/project-display-name"
import { projectContext, requireUserContext } from "@/lib/server/action-context"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

export type PaperTrailRecordView = {
  readonly status: PaperTrailFileStatus
  readonly lastSyncedAt: string | null
  readonly driveUrl: string | null
  readonly error: string | null
  /** The hand-saved file found in the folder, when the status is needs_choice or kept_existing. */
  readonly existingFile: { readonly name: string; readonly url: string } | null
}

export type PaperTrailDuplicateChoice = "replace" | "keep_both" | "keep_existing"

function driveFileUrl(id: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`
}

export type PaperTrailProjectView = {
  /** False when the company has the paper trail off, or this project is not a test project. */
  readonly enabled: boolean
  readonly records: Readonly<Record<string, PaperTrailRecordView>>
}

/** Feature whose permissions govern each record type's Drive status. */
const RECORD_FEATURES: Readonly<Record<PaperTrailRecordType, string>> = {
  purchase_order: "purchase-orders",
  estimate: "budget",
  rfi: "rfis",
  change_order: "change-orders",
  shop_ticket: "shop-tickets",
}

/** Staff of the project's own organization, with the record type's feature permission. */
async function paperTrailContext(projectId: string, recordType: PaperTrailRecordType, action: "read" | "update") {
  const user = await requireAuth()
  // Only the demo account is read-only here (not the whole demo company), as before.
  if (action === "update" && isDemoUser(user.id)) throw new Error("DEMO_READ_ONLY")
  const context = await projectContext(projectId, { scope: "organization", feature: RECORD_FEATURES[recordType], action })
  // Callers catch and report the message, as they did before the shared context.
  if (!context.success) throw new Error(context.error)
  const { db, organizationId } = context.data
  return { db, organizationId: organizationId ?? "" }
}

/** Drive status for every record of one type in a project: one query. */
export async function getProjectPaperTrail(
  projectId: string,
  recordType: PaperTrailRecordType,
): Promise<PaperTrailProjectView> {
  try {
    const { db, organizationId } = await paperTrailContext(projectId, recordType, "read")
    const settings = await readFeatureSettings(db, organizationId, "paper-trail")
    if (!paperTrailAllows(settings, recordType, projectId)) return { enabled: false, records: {} }
    const rows = await db
      .select()
      .from(projectRecordDriveFiles)
      .where(and(eq(projectRecordDriveFiles.projectId, projectId), eq(projectRecordDriveFiles.recordType, recordType)))
    return {
      enabled: true,
      records: Object.fromEntries(
        rows.map((row) => [
          row.recordId,
          {
            status: row.status,
            lastSyncedAt: row.lastSyncedAt,
            driveUrl: row.driveFileId ? driveFileUrl(row.driveFileId) : null,
            error: row.lastError,
            existingFile:
              row.existingFileId && row.existingFileName
                ? { name: row.existingFileName, url: driveFileUrl(row.existingFileId) }
                : null,
          },
        ]),
      ),
    }
  } catch {
    // Status is a convenience; never break the page that shows it.
    return { enabled: false, records: {} }
  }
}

/** "Save to Drive now": skips the quiet period so the next scheduled run writes it. */
export async function requestPaperTrailSave(
  projectId: string,
  recordType: PaperTrailRecordType,
  recordId: string,
): Promise<Result<null>> {
  try {
    const { db } = await paperTrailContext(projectId, recordType, "update")
    const now = new Date()
    // changedAt in the past makes the quiet period already over for this row.
    const longAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const updated = await updateRecordDriveFilesReturningIds(
      db,
      and(
        eq(projectRecordDriveFiles.projectId, projectId),
        eq(projectRecordDriveFiles.recordType, recordType),
        eq(projectRecordDriveFiles.recordId, recordId),
      ),
      { status: "pending", dueAt: now.toISOString(), changedAt: longAgo, attempts: 0, lastError: null, updatedAt: now.toISOString() },
    )
    if (updated.length === 0) {
      const [project] = await db.select({ organizationId: projects.organizationId }).from(projects).where(eq(projects.id, projectId)).limit(1)
      if (!project?.organizationId) return { success: false, error: "Project not found" }
      await insertRecordDriveFile(db, {
        id: crypto.randomUUID(),
        organizationId: project.organizationId,
        projectId,
        recordType,
        recordId,
        status: "pending",
        dueAt: now.toISOString(),
        changedAt: longAgo,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      })
    }
    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to queue the Drive copy." }
  }
}

/**
 * What to do when a record's file was already saved by hand:
 * replace — Compass takes over that file and updates it (Drive keeps the
 *   hand-saved version in its history);
 * keep_both — save Compass's copy beside it;
 * keep_existing — keep the hand-saved file and stop saving this record.
 */
export async function resolvePaperTrailDuplicate(
  projectId: string,
  recordType: PaperTrailRecordType,
  recordId: string,
  choice: PaperTrailDuplicateChoice,
): Promise<Result<null>> {
  try {
    const { db } = await paperTrailContext(projectId, recordType, "update")
    const [row] = await db
      .select()
      .from(projectRecordDriveFiles)
      .where(
        and(
          eq(projectRecordDriveFiles.projectId, projectId),
          eq(projectRecordDriveFiles.recordType, recordType),
          eq(projectRecordDriveFiles.recordId, recordId),
        ),
      )
      .limit(1)
    if (!row || (row.status !== "needs_choice" && row.status !== "kept_existing")) {
      return { success: false, error: "This record isn't waiting for a choice." }
    }
    const now = new Date()
    const longAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const due = { dueAt: now.toISOString(), changedAt: longAgo, attempts: 0, lastError: null, updatedAt: now.toISOString() }
    if (choice === "keep_existing") {
      await updateRecordDriveFile(db, row.id, { status: "kept_existing", updatedAt: now.toISOString() })
    } else if (choice === "replace") {
      if (!row.existingFileId) return { success: false, error: "The existing file is no longer known. Save to Drive again." }
      // The job updates this file in place, so its link and sharing stay the same.
      await updateRecordDriveFile(db, row.id, { status: "pending", driveFileId: row.existingFileId, fileName: row.existingFileName, ...due })
    } else {
      await updateRecordDriveFile(db, row.id, { status: "pending", allowDuplicate: true, ...due })
    }
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath("/dashboard/settings")
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to save that choice." }
  }
}

export type PaperTrailChoiceItem = {
  readonly projectId: string
  readonly projectLabel: string
  readonly recordType: PaperTrailRecordType
  readonly recordTypeLabel: string
  readonly recordId: string
  readonly existingFile: { readonly name: string; readonly url: string } | null
}

/** Every record across the company waiting for a duplicate choice, for Settings. */
export async function getPaperTrailChoices(): Promise<Result<readonly PaperTrailChoiceItem[]>> {
  try {
    const { user, db } = await requireUserContext()
    if (!canEditFeatureSettings(user.role, "paper-trail")) return { success: true, data: [] }
    const organizationId = requireOrg(user)
    const rows = await db
      .select({
        projectId: projectRecordDriveFiles.projectId,
        recordType: projectRecordDriveFiles.recordType,
        recordId: projectRecordDriveFiles.recordId,
        existingFileId: projectRecordDriveFiles.existingFileId,
        existingFileName: projectRecordDriveFiles.existingFileName,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
      })
      .from(projectRecordDriveFiles)
      .innerJoin(projects, eq(projects.id, projectRecordDriveFiles.projectId))
      .where(and(eq(projectRecordDriveFiles.organizationId, organizationId), eq(projectRecordDriveFiles.status, "needs_choice")))
      .orderBy(desc(projectRecordDriveFiles.updatedAt))
      .limit(500)
    return {
      success: true,
      data: rows.map((row) => ({
        projectId: row.projectId,
        projectLabel: projectNumberAndName({ name: row.projectName, projectNumber: row.projectNumber }),
        recordType: row.recordType,
        recordTypeLabel: PAPER_TRAIL_RECORDS[row.recordType].label,
        recordId: row.recordId,
        existingFile:
          row.existingFileId && row.existingFileName ? { name: row.existingFileName, url: driveFileUrl(row.existingFileId) } : null,
      })),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to load records waiting for a choice." }
  }
}
