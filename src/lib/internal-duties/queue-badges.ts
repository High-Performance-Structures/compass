import type { InternalWorkspaceSummary } from "@/lib/internal-duties/model"
import type { InternalQueueId } from "@/lib/internal-duties/queues"

/** Counts shown on internal work queues, from the workspace summary. */
export function internalQueueBadges(
  summary: InternalWorkspaceSummary,
): Readonly<Partial<Record<InternalQueueId, { readonly text: string; readonly urgent: boolean }>>> {
  const behind = summary.attention.filter((duty) => duty.status.kind === "behind").length
  const dueSoon = summary.attention.filter((duty) => duty.status.kind === "due_soon").length
  const recurring =
    behind > 0
      ? { text: `${behind} behind`, urgent: true }
      : dueSoon > 0
        ? { text: `${dueSoon} due soon`, urgent: false }
        : undefined
  const logs = summary.waitingLogs > 0 ? { text: `${summary.waitingLogs} logs need a duty`, urgent: false } : undefined
  return {
    ...(recurring ? { "recurring-duties": recurring } : {}),
    ...(logs ? { "duty-log": logs, "crew-log": logs } : {}),
  }
}
