import { PROJECT_JOB_STATUS_DEFINITIONS } from "@/lib/project-profile"

/**
 * The step's usual job status, offered only when it moves the job forward.
 * Built-in statuses are listed in pipeline order; a job already at or past
 * the step's status (for example under construction while scheduling items
 * are still open), or in a custom status, gets no suggestion.
 */
export function forwardJobStatusSuggestion(currentJobStatusId: string, stepJobStatusId: string | null): string | null {
  if (!stepJobStatusId || stepJobStatusId === currentJobStatusId) return null
  const rank = (id: string): number => PROJECT_JOB_STATUS_DEFINITIONS.findIndex((status) => status.id === id)
  const current = rank(currentJobStatusId)
  const suggested = rank(stepJobStatusId)
  if (current < 0 || suggested < 0) return null
  return suggested > current ? stepJobStatusId : null
}
