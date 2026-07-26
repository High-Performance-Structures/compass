import type {
  ScheduleTaskData,
  TaskDependencyData,
  WorkdayExceptionData,
} from "./types"
import {
  addBusinessDays,
  calculateEndDate,
  calculateStartDate,
} from "./business-days"

interface TaskDates {
  readonly startDate: string
  readonly endDateCalculated: string
}

interface PropagationResult {
  readonly updatedTasks: Map<string, TaskDates>
}

function constrainedDates(
  successor: ScheduleTaskData,
  incomingDependencies: readonly TaskDependencyData[],
  taskMap: ReadonlyMap<string, ScheduleTaskData>,
  exceptions: readonly WorkdayExceptionData[]
): TaskDates | null {
  const candidateStarts: string[] = []

  for (const dependency of incomingDependencies) {
    const predecessor = taskMap.get(dependency.predecessorId)
    if (!predecessor) continue

    if (dependency.type === "FS") {
      candidateStarts.push(
        addBusinessDays(
          predecessor.endDateCalculated,
          1 + dependency.lagDays,
          exceptions
        )
      )
      continue
    }

    if (dependency.type === "SS") {
      candidateStarts.push(
        addBusinessDays(
          predecessor.startDate,
          dependency.lagDays,
          exceptions
        )
      )
      continue
    }

    const constrainedEnd =
      dependency.type === "FF"
        ? addBusinessDays(
            predecessor.endDateCalculated,
            dependency.lagDays,
            exceptions
          )
        : addBusinessDays(
            predecessor.startDate,
            dependency.lagDays,
            exceptions
          )

    candidateStarts.push(
      calculateStartDate(constrainedEnd, successor.workdays, exceptions)
    )
  }

  if (candidateStarts.length === 0) return null

  // A successor with multiple predecessors must satisfy the latest constraint.
  const startDate = candidateStarts.sort().at(-1)
  if (!startDate) return null

  return {
    startDate,
    endDateCalculated: calculateEndDate(
      startDate,
      successor.workdays,
      exceptions
    ),
  }
}

function incomingDependencyMap(
  dependencies: readonly TaskDependencyData[]
): Map<string, TaskDependencyData[]> {
  const incoming = new Map<string, TaskDependencyData[]>()
  for (const dependency of dependencies) {
    const current = incoming.get(dependency.successorId) ?? []
    current.push(dependency)
    incoming.set(dependency.successorId, current)
  }
  return incoming
}

function successorDependencyMap(
  dependencies: readonly TaskDependencyData[]
): Map<string, TaskDependencyData[]> {
  const successors = new Map<string, TaskDependencyData[]>()
  for (const dependency of dependencies) {
    const current = successors.get(dependency.predecessorId) ?? []
    current.push(dependency)
    successors.set(dependency.predecessorId, current)
  }
  return successors
}

export function propagateDates(
  changedTaskId: string,
  tasks: readonly ScheduleTaskData[],
  dependencies: readonly TaskDependencyData[],
  exceptions: readonly WorkdayExceptionData[] = []
): PropagationResult {
  const taskMap = new Map(tasks.map((task) => [task.id, { ...task }]))
  const updates = new Map<string, TaskDates>()
  const incoming = incomingDependencyMap(dependencies)
  const successors = successorDependencyMap(dependencies)
  const queue = [changedTaskId]
  const queued = new Set(queue)

  while (queue.length > 0) {
    const currentId = queue.shift()
    if (!currentId) continue
    queued.delete(currentId)

    const outgoing = successors.get(currentId) ?? []
    for (const dependency of outgoing) {
      const successor = taskMap.get(dependency.successorId)
      if (!successor) continue

      const dates = constrainedDates(
        successor,
        incoming.get(successor.id) ?? [],
        taskMap,
        exceptions
      )
      if (!dates) continue

      if (
        dates.startDate !== successor.startDate ||
        dates.endDateCalculated !== successor.endDateCalculated
      ) {
        const updatedSuccessor = { ...successor, ...dates }
        taskMap.set(successor.id, updatedSuccessor)
        updates.set(successor.id, dates)
        if (!queued.has(successor.id)) {
          queue.push(successor.id)
          queued.add(successor.id)
        }
      }
    }
  }

  return { updatedTasks: updates }
}

export function recalculateScheduleDates(
  tasks: readonly ScheduleTaskData[],
  dependencies: readonly TaskDependencyData[],
  exceptions: readonly WorkdayExceptionData[] = []
): PropagationResult {
  const originalById = new Map(tasks.map((task) => [task.id, task]))
  const taskMap = new Map(
    tasks.map((task) => [
      task.id,
      {
        ...task,
        endDateCalculated: calculateEndDate(
          task.startDate,
          task.workdays,
          exceptions
        ),
      },
    ])
  )
  const incoming = incomingDependencyMap(dependencies)
  const successors = successorDependencyMap(dependencies)
  const inDegree = new Map(tasks.map((task) => [task.id, 0]))

  for (const dependency of dependencies) {
    if (
      taskMap.has(dependency.predecessorId) &&
      taskMap.has(dependency.successorId)
    ) {
      inDegree.set(
        dependency.successorId,
        (inDegree.get(dependency.successorId) ?? 0) + 1
      )
    }
  }

  const queue = tasks
    .filter((task) => (inDegree.get(task.id) ?? 0) === 0)
    .map((task) => task.id)

  while (queue.length > 0) {
    const currentId = queue.shift()
    if (!currentId) continue

    for (const dependency of successors.get(currentId) ?? []) {
      const nextDegree = (inDegree.get(dependency.successorId) ?? 1) - 1
      inDegree.set(dependency.successorId, nextDegree)
      if (nextDegree !== 0) continue

      const successor = taskMap.get(dependency.successorId)
      if (!successor) continue
      const dates = constrainedDates(
        successor,
        incoming.get(successor.id) ?? [],
        taskMap,
        exceptions
      )
      if (dates) {
        taskMap.set(successor.id, { ...successor, ...dates })
      }
      queue.push(successor.id)
    }
  }

  const updates = new Map<string, TaskDates>()
  for (const [taskId, task] of taskMap) {
    const original = originalById.get(taskId)
    if (
      original &&
      (original.startDate !== task.startDate ||
        original.endDateCalculated !== task.endDateCalculated)
    ) {
      updates.set(taskId, {
        startDate: task.startDate,
        endDateCalculated: task.endDateCalculated,
      })
    }
  }

  return { updatedTasks: updates }
}
