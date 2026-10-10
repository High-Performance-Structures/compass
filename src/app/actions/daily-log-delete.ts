"use server"

import { and, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import { dailyLogPhotos, dailyLogs, ownerProjectUpdates, projects } from "@/db/schema"
import { recordActivityEvent } from "@/lib/activity-log"
import { requireAuth } from "@/lib/auth"
import { dailyLogDeleteBlocker } from "@/lib/daily-logs/delete-rules"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { canFeature } from "@/lib/permission-enforcement"
import { isInternalStaffRole } from "@/lib/user-roles"

type DeleteDailyLogsResult =
  | { readonly success: true; readonly deletedCount: number }
  | { readonly success: false; readonly error: string }

/**
 * Deletes daily logs from a project. Staff with daily-log delete permission
 * may delete any log; the author may delete their own until it is approved or
 * shared with the owner. A log used by an owner update must be removed from
 * that update first. Files stay in the project's photos, and each deleted log
 * is copied into the activity log so it can be recovered.
 */
export async function deleteProjectDailyLogs(
  projectId: string,
  dailyLogIds: readonly string[],
): Promise<DeleteDailyLogsResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "Demo accounts are read-only." }
    if (!user.isActive || !isInternalStaffRole(user.role)) {
      return { success: false, error: "Staff access is required to delete daily logs." }
    }
    const organizationId = requireOrg(user)
    const ids = [...new Set(dailyLogIds.map((id) => id.trim()).filter((id) => id.length > 0))]
    if (ids.length === 0) return { success: false, error: "Choose at least one daily log." }
    if (ids.length > 200) return { success: false, error: "Delete at most 200 daily logs at a time." }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const project = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!project) return { success: false, error: "Project not found." }

    const logs = await db
      .select()
      .from(dailyLogs)
      .where(and(eq(dailyLogs.projectId, projectId), inArray(dailyLogs.id, ids)))
    if (logs.length !== ids.length) return { success: false, error: "Some of those daily logs no longer exist. Refresh and try again." }

    const canDeleteAny = await canFeature(user, "daily-logs", "delete")
    const canUpdate = await canFeature(user, "daily-logs", "update")
    const updates = await db
      .select({ title: ownerProjectUpdates.title, sourceDailyLogIds: ownerProjectUpdates.sourceDailyLogIds })
      .from(ownerProjectUpdates)
      .where(eq(ownerProjectUpdates.projectId, projectId))

    for (const log of logs) {
      const blocker = dailyLogDeleteBlocker(log, {
        viewerId: user.id,
        canDeleteAny,
        canUpdate,
        ownerUpdates: updates,
      })
      if (blocker) return { success: false, error: blocker }
    }

    const photoCounts = await db
      .select({ dailyLogId: dailyLogPhotos.dailyLogId })
      .from(dailyLogPhotos)
      .where(inArray(dailyLogPhotos.dailyLogId, ids))

    // Record first so a failed audit write never leaves an unrecorded delete.
    for (const log of logs) {
      await recordActivityEvent({
        db,
        organizationId,
        projectId,
        actor: user,
        category: "field",
        action: "daily_log.deleted",
        entityType: "daily_log",
        entityId: log.id,
        summary: `Deleted the daily log for ${log.logDate}.`,
        metadata: {
          // Full copy of the record for recovery.
          dailyLog: JSON.stringify(log),
          filesKept: photoCounts.filter((photo) => photo.dailyLogId === log.id).length,
        },
      })
    }
    // Files are kept: daily_log_photos.daily_log_id is set to null by the
    // foreign key, and task links are removed with the log.
    await db.update(dailyLogPhotos).set({ dailyLogId: null }).where(inArray(dailyLogPhotos.dailyLogId, ids))
    await db.delete(dailyLogs).where(and(eq(dailyLogs.projectId, projectId), inArray(dailyLogs.id, ids)))

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/daily-logs`)
    revalidatePath(`/dashboard/projects/${projectId}/photos`)
    return { success: true, deletedCount: logs.length }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to delete daily logs." }
  }
}
