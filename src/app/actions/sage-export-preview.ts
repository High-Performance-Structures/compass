"use server"

import { actionFailure, type ActionResult } from "@/lib/action-result"
import { loadSageExportPreview, type SageExportPreview } from "@/lib/financials/sage-export-preview-server"
import { can } from "@/lib/permissions"
import { projectContext } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

/**
 * The read-only Sage export preview for an owner pay application: office
 * staff with finance access only. It never writes to Sage or queues a write.
 */
export async function getSageExportPreview(projectId: string, applicationId: string): Promise<ActionResult<SageExportPreview>> {
  const context = await projectContext(projectId, { scope: "organization" })
  if (!context.success) return context
  const { db, user, project } = context.data
  if (!isInternalStaffRole(user.role ?? "") || !can(user, "finance", "read")) {
    return actionFailure("Only office staff with finance access can see the Sage export preview.")
  }
  const organizationId = project.organizationId
  if (!organizationId) return actionFailure("Project not found")
  const preview = await loadSageExportPreview(db, { organizationId, projectId, applicationId })
  return preview ? { success: true, data: preview } : actionFailure("Pay application not found")
}
