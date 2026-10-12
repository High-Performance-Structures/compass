"use server"

import { revalidatePath } from "next/cache"
import { updateProjectJobStatus } from "@/app/actions/project-profile"

type BulkStatusResult =
  | { readonly success: true; readonly updated: number; readonly failed: readonly { readonly projectId: string; readonly error: string }[] }
  | { readonly success: false; readonly error: string }

const MAX_PROJECTS = 100

/**
 * Sets one status on several projects. Each project goes through the same
 * permission check and audit record as a single status change, so a project
 * the user can't edit is reported back rather than changed.
 */
export async function updateProjectJobStatuses(
  projectIds: readonly string[],
  jobStatusId: string,
): Promise<BulkStatusResult> {
  const ids = [...new Set(projectIds.map((id) => id.trim()).filter((id) => id.length > 0))]
  if (ids.length === 0) return { success: false, error: "Choose at least one project." }
  if (ids.length > MAX_PROJECTS) return { success: false, error: `Change at most ${MAX_PROJECTS} projects at a time.` }

  const failed: { projectId: string; error: string }[] = []
  let updated = 0
  // Sequential keeps D1 load and audit ordering predictable for a short list.
  for (const projectId of ids) {
    const result = await updateProjectJobStatus({ projectId, jobStatusId })
    if (result.success) updated += 1
    else failed.push({ projectId, error: result.error })
  }
  revalidatePath("/dashboard/projects")
  revalidatePath("/dashboard")
  return { success: true, updated, failed }
}
