import { createDependency, updateDependency } from "@/app/actions/schedule-dependencies"
import type { TaskDependencyData } from "@/lib/schedule/types"
import { predecessorEditChanged, type PendingPredecessor } from "./form-model"

/**
 * Saves changed saved predecessors, then new ones with an item chosen, one at
 * a time. Returns the error of each change that could not be saved.
 */
export async function savePredecessorChanges(input: {
  readonly projectId: string
  readonly savedTaskId: string
  readonly shiftReason: string
  readonly existingPredecessors: readonly TaskDependencyData[]
  readonly existingPredecessorEdits: Readonly<Record<string, PendingPredecessor>>
  readonly pendingPredecessors: readonly PendingPredecessor[]
}): Promise<readonly string[]> {
  const dependencyErrors: string[] = []
  for (const dependency of input.existingPredecessors) {
    const edit = input.existingPredecessorEdits[dependency.id]
    if (!edit || !predecessorEditChanged(dependency, edit)) {
      continue
    }

    const dependencyResult = await updateDependency({
      dependencyId: dependency.id,
      predecessorId: edit.taskId,
      successorId: input.savedTaskId,
      type: edit.type,
      lagDays: edit.lagDays,
      projectId: input.projectId,
      shiftReason: input.shiftReason
    })
    if (!dependencyResult.success) {
      dependencyErrors.push(dependencyResult.error)
    }
  }

  for (const predecessor of input.pendingPredecessors) {
    if (predecessor.taskId) {
      const dependencyResult = await createDependency({
        predecessorId: predecessor.taskId,
        successorId: input.savedTaskId,
        type: predecessor.type,
        lagDays: predecessor.lagDays,
        projectId: input.projectId,
        shiftReason: input.shiftReason
      })
      if (!dependencyResult.success) {
        dependencyErrors.push(dependencyResult.error)
      }
    }
  }
  return dependencyErrors
}
