import type {
  ScheduleTaskData,
  TaskDependencyData,
  WorkdayExceptionData,
} from "./types"
import {
  addBusinessDays,
  businessDayOffset,
  calculateEndDate,
  calculateStartDate,
} from "./business-days"

interface PropagationResult {
  updatedTasks: Map<string, { startDate: string; endDateCalculated: string }>
  cycleDetected: boolean
}

function requiredStartDate(
  predecessor: ScheduleTaskData,
  successor: ScheduleTaskData,
  dependency: TaskDependencyData,
  exceptions: WorkdayExceptionData[]
): string {
  if (dependency.type === "SS") {
    return addBusinessDays(
      predecessor.startDate,
      dependency.lagDays,
      exceptions
    )
  }

  if (dependency.type === "FF") {
    const requiredEnd = addBusinessDays(
      predecessor.endDateCalculated,
      dependency.lagDays,
      exceptions
    )
    return calculateStartDate(requiredEnd, successor.workdays, exceptions)
  }

  if (dependency.type === "SF") {
    const requiredEnd = addBusinessDays(
      predecessor.startDate,
      dependency.lagDays,
      exceptions
    )
    return calculateStartDate(requiredEnd, successor.workdays, exceptions)
  }

  return addBusinessDays(
    predecessor.endDateCalculated,
    1 + dependency.lagDays,
    exceptions
  )
}

export function lagDaysForStartDate(
  predecessor: ScheduleTaskData,
  successor: ScheduleTaskData,
  dependencyType: TaskDependencyData["type"],
  startDate: string,
  exceptions: WorkdayExceptionData[] = []
): number {
  if (dependencyType === "SS") {
    return businessDayOffset(predecessor.startDate, startDate, exceptions)
  }

  const successorEnd = calculateEndDate(
    startDate,
    successor.workdays,
    exceptions
  )

  if (dependencyType === "FF") {
    return businessDayOffset(
      predecessor.endDateCalculated,
      successorEnd,
      exceptions
    )
  }

  if (dependencyType === "SF") {
    return businessDayOffset(predecessor.startDate, successorEnd, exceptions)
  }

  return (
    businessDayOffset(
      predecessor.endDateCalculated,
      startDate,
      exceptions
    ) - 1
  )
}

function calculateDependencyDates(
  tasks: ScheduleTaskData[],
  dependencies: TaskDependencyData[],
  exceptions: WorkdayExceptionData[],
  tasksToEnforce: ReadonlySet<string> | null
): PropagationResult {
  const taskMap = new Map(tasks.map((task) => [task.id, { ...task }]))
  const incoming = new Map<string, TaskDependencyData[]>()
  const outgoing = new Map<string, string[]>()
  const inDegree = new Map<string, number>()

  for (const task of tasks) {
    incoming.set(task.id, [])
    outgoing.set(task.id, [])
    inDegree.set(task.id, 0)
  }

  for (const dependency of dependencies) {
    if (
      !taskMap.has(dependency.predecessorId) ||
      !taskMap.has(dependency.successorId)
    ) {
      continue
    }
    incoming.get(dependency.successorId)?.push(dependency)
    outgoing.get(dependency.predecessorId)?.push(dependency.successorId)
    inDegree.set(
      dependency.successorId,
      (inDegree.get(dependency.successorId) ?? 0) + 1
    )
  }

  const queue = tasks
    .filter((task) => inDegree.get(task.id) === 0)
    .map((task) => task.id)
  const orderedTaskIds: string[] = []

  while (queue.length > 0) {
    const taskId = queue.shift()
    if (!taskId) continue
    orderedTaskIds.push(taskId)
    for (const successorId of outgoing.get(taskId) ?? []) {
      const nextDegree = (inDegree.get(successorId) ?? 1) - 1
      inDegree.set(successorId, nextDegree)
      if (nextDegree === 0) queue.push(successorId)
    }
  }

  if (orderedTaskIds.length !== tasks.length) {
    return { updatedTasks: new Map(), cycleDetected: true }
  }

  const updates = new Map<
    string,
    { startDate: string; endDateCalculated: string }
  >()

  for (const taskId of orderedTaskIds) {
    if (tasksToEnforce && !tasksToEnforce.has(taskId)) continue
    const successor = taskMap.get(taskId)
    const predecessorLinks = incoming.get(taskId) ?? []
    if (!successor || predecessorLinks.length === 0) continue

    const requiredStarts = predecessorLinks.flatMap((dependency) => {
      const predecessor = taskMap.get(dependency.predecessorId)
      if (!predecessor) return []
      return [requiredStartDate(predecessor, successor, dependency, exceptions)]
    })
    if (requiredStarts.length === 0) continue

    const nextStart = requiredStarts.reduce((latest, candidate) =>
      candidate > latest ? candidate : latest
    )
    const nextEnd = calculateEndDate(
      nextStart,
      successor.workdays,
      exceptions
    )

    if (
      nextStart === successor.startDate &&
      nextEnd === successor.endDateCalculated
    ) {
      continue
    }

    successor.startDate = nextStart
    successor.endDateCalculated = nextEnd
    updates.set(successor.id, {
      startDate: nextStart,
      endDateCalculated: nextEnd,
    })
  }

  return { updatedTasks: updates, cycleDetected: false }
}

export function enforceDependencyDates(
  tasks: ScheduleTaskData[],
  dependencies: TaskDependencyData[],
  exceptions: WorkdayExceptionData[] = []
): PropagationResult {
  return calculateDependencyDates(tasks, dependencies, exceptions, null)
}

export function enforceDependencyDatesFrom(
  changedTaskId: string,
  tasks: ScheduleTaskData[],
  dependencies: TaskDependencyData[],
  exceptions: WorkdayExceptionData[] = [],
  includeChangedTask = false
): PropagationResult {
  const outgoing = new Map<string, string[]>()
  for (const dependency of dependencies) {
    const successors = outgoing.get(dependency.predecessorId) ?? []
    successors.push(dependency.successorId)
    outgoing.set(dependency.predecessorId, successors)
  }

  const affected = new Set<string>()
  const queue = includeChangedTask
    ? [changedTaskId]
    : [...(outgoing.get(changedTaskId) ?? [])]
  while (queue.length > 0) {
    const taskId = queue.shift()
    if (!taskId || affected.has(taskId)) continue
    affected.add(taskId)
    queue.push(...(outgoing.get(taskId) ?? []))
  }

  return calculateDependencyDates(tasks, dependencies, exceptions, affected)
}

export function propagateDates(
  changedTaskId: string,
  tasks: ScheduleTaskData[],
  dependencies: TaskDependencyData[],
  exceptions: WorkdayExceptionData[] = []
): PropagationResult {
  return enforceDependencyDatesFrom(
    changedTaskId,
    tasks,
    dependencies,
    exceptions
  )
}
