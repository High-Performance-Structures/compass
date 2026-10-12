import type { WorkflowProgress } from "@/lib/job-workflows/engine"

/**
 * Where the job's status sits in this workflow: the first step that goes with
 * it, or -1 when no step does (custom statuses, sub-statuses like Follow-up).
 * Workflow order is used rather than the status list, which is not a pipeline.
 */
function statusStepIndex(progress: WorkflowProgress, jobStatusId: string): number {
  return progress.steps.findIndex((step) => step.jobStatusId === jobStatusId)
}

/**
 * The current step's usual job status, offered only when the job's status
 * belongs to an earlier step, so the suggestion always moves the job forward.
 */
export function forwardJobStatusSuggestion(progress: WorkflowProgress, jobStatusId: string): string | null {
  const current = progress.current
  if (!current?.jobStatusId || current.jobStatusId === jobStatusId) return null
  const currentIndex = progress.steps.findIndex((step) => step.id === current.id)
  const statusIndex = statusStepIndex(progress, jobStatusId)
  return statusIndex >= 0 && statusIndex < currentIndex ? current.jobStatusId : null
}

/**
 * For a job whose status is ahead of its checklist (a job already underway
 * when workflows arrived): the step its status matches and the open tickable
 * items before it. Offered as one click; nothing is ticked automatically.
 */
export function workflowCatchUp(
  progress: WorkflowProgress,
  jobStatusId: string,
): { readonly stepLabel: string; readonly itemKeys: readonly string[] } | null {
  if (!progress.current) return null
  const currentIndex = progress.steps.findIndex((step) => step.id === progress.current?.id)
  const targetIndex = statusStepIndex(progress, jobStatusId)
  const target = progress.steps[targetIndex]
  if (!target || targetIndex <= currentIndex) return null
  const itemKeys = progress.steps
    .slice(0, targetIndex)
    .flatMap((step) => step.items.filter((item) => item.tickable && !item.done).map((item) => item.key))
  return itemKeys.length > 0 ? { stepLabel: target.label, itemKeys } : null
}
