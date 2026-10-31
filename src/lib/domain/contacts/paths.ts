import { revalidatePath } from "next/cache"

/** Project pages that show project contacts. */
export function revalidateProjectContactPaths(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}`)
  revalidatePath(`/dashboard/projects/${projectId}/contacts`)
  revalidatePath(`/dashboard/projects/${projectId}/contacts/review`)
  revalidatePath(`/dashboard/projects/${projectId}/information`)
  revalidatePath(`/dashboard/projects/${projectId}/rfis`)
  revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
}
