"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { projectRecordDriveFiles, type PaperTrailRecordType } from "@/db/schema-paper-trail"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { requireOrg } from "@/lib/org-scope"
import { paperTrailAllows } from "@/lib/paper-trail/record-types"
import { requireFeaturePermission } from "@/lib/permission-enforcement"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

export type PaperTrailRecordView = {
  readonly status: "pending" | "synced" | "failed" | "held_private" | "removed"
  readonly lastSyncedAt: string | null
  readonly driveUrl: string | null
  readonly error: string | null
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
}

async function projectContext(projectId: string, recordType: PaperTrailRecordType, action: "read" | "update") {
  const user = await requireAuth()
  if (action === "update" && isDemoUser(user.id)) throw new Error("DEMO_READ_ONLY")
  await requireFeaturePermission(user, RECORD_FEATURES[recordType], action)
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1)
  if (!project) throw new Error("Project not found")
  return { db, organizationId }
}

/** Drive status for every record of one type in a project: one query. */
export async function getProjectPaperTrail(
  projectId: string,
  recordType: PaperTrailRecordType,
): Promise<PaperTrailProjectView> {
  try {
    const { db, organizationId } = await projectContext(projectId, recordType, "read")
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
            driveUrl: row.driveFileId ? `https://drive.google.com/file/d/${encodeURIComponent(row.driveFileId)}/view` : null,
            error: row.lastError,
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
    const { db } = await projectContext(projectId, recordType, "update")
    const now = new Date()
    // changedAt in the past makes the quiet period already over for this row.
    const longAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const updated = await db
      .update(projectRecordDriveFiles)
      .set({ status: "pending", dueAt: now.toISOString(), changedAt: longAgo, attempts: 0, lastError: null, updatedAt: now.toISOString() })
      .where(
        and(
          eq(projectRecordDriveFiles.projectId, projectId),
          eq(projectRecordDriveFiles.recordType, recordType),
          eq(projectRecordDriveFiles.recordId, recordId),
        ),
      )
      .returning({ id: projectRecordDriveFiles.id })
    if (updated.length === 0) {
      const [project] = await db.select({ organizationId: projects.organizationId }).from(projects).where(eq(projects.id, projectId)).limit(1)
      if (!project?.organizationId) return { success: false, error: "Project not found" }
      await db.insert(projectRecordDriveFiles).values({
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
