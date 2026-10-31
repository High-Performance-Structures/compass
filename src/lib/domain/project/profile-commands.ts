import { revalidatePath } from "next/cache"

import { changeProjectJobStatus } from "@/lib/domain/project/job-status"
import type { ProjectProfileResult } from "@/lib/domain/project/profile-rules"

/** Refreshes every page that shows a project's profile fields. */
export function revalidateProjectProfile(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}`)
  revalidatePath(`/dashboard/projects/${projectId}/information`)
  revalidatePath("/dashboard/projects")
  revalidatePath("/dashboard/projects/follow-up")
}

/** Strips the internal `changed` flag so callers see the same result as before. */
export function plainResult(result: ProjectProfileResult): ProjectProfileResult {
  return result.success ? { success: true } : { success: false, error: result.error }
}

/**
 * Changes one project's job status with the same access check and audit as
 * the Information page, then refreshes the project pages. Shared by the
 * single and bulk status actions.
 */
export async function updateProjectJobStatusCommand(input: {
  readonly projectId: string
  readonly jobStatusId: string
}): Promise<ProjectProfileResult> {
  try {
    const result = await changeProjectJobStatus(input)
    if (result.success && result.changed) revalidateProjectProfile(input.projectId)
    return plainResult(result)
  } catch (error) {
    console.error("Unable to update project job status", error)
    return { success: false, error: "Unable to update project status." }
  }
}
