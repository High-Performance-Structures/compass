import type {
  ScheduleTaskData,
  TaskDependencyData,
  ConstructionPhase,
} from "./types"
import { PHASE_ORDER, PHASE_LABELS } from "./phase-colors"
import { normalizeDisplayColor } from "./appearance"
import { effectivePercentComplete } from "./progress"

export interface FrappeTask {
  id: string
  name: string
  start: string
  end: string
  progress: number
  dependencies: string
  custom_class: string
  displayColor: string | null
  projectColor?: string
  isCriticalPath: boolean
  isMilestone: boolean
}

function ganttSafeToken(value: string): string {
  const token = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return token.length > 0 ? token : "uncategorized"
}

function phaseTaskId(phase: string): string {
  return `phase-${ganttSafeToken(phase)}`
}

function phaseClassName(phase: string): string {
  return `phase-${ganttSafeToken(phase)}`
}

export function transformToFrappeTasks(
  tasks: ScheduleTaskData[],
  dependencies: TaskDependencyData[]
): FrappeTask[] {
  // Build a lookup for visual dependency lines. Frappe Gantt does not expose
  // dependency types, but every stored relationship should still be visible.
  const predMap = new Map<string, string[]>()
  for (const dep of dependencies) {
    if (!predMap.has(dep.successorId)) {
      predMap.set(dep.successorId, [])
    }
    predMap.get(dep.successorId)!.push(dep.predecessorId)
  }

  return tasks.map((task) => {
    const preds = predMap.get(task.id) || []
    const depString = preds.join(", ")

    const progress = effectivePercentComplete(
      task.status,
      task.percentComplete
    )

    // frappe-gantt uses classList.add() which throws on spaces,
    // so we can only pass a single class name
    const customClass = `display-color-${normalizeDisplayColor(task.displayColor)}`

    return {
      id: task.id,
      name: task.title,
      start: task.startDate,
      end: task.endDateCalculated,
      progress,
      dependencies: depString,
      custom_class: customClass,
      displayColor: task.displayColor,
      isCriticalPath: task.isCriticalPath,
      isMilestone: task.isMilestone,
    }
  })
}

export interface PhaseGroup {
  phase: string
  label: string
  tasks: ScheduleTaskData[]
  startDate: string
  endDate: string
  progress: number
  isComplete: boolean
}

export type DisplayItem =
  | { type: "phase-header"; phase: string; group: PhaseGroup; collapsed: boolean }
  | { type: "task"; task: ScheduleTaskData }

export function groupTasksByPhase(
  tasks: ScheduleTaskData[]
): PhaseGroup[] {
  const byPhase = new Map<string, ScheduleTaskData[]>()

  for (const task of tasks) {
    const phase = task.phase || "uncategorized"
    if (!byPhase.has(phase)) byPhase.set(phase, [])
    byPhase.get(phase)!.push(task)
  }

  const groups: PhaseGroup[] = []
  const orderedPhases: string[] = [
    ...PHASE_ORDER.filter((p) => byPhase.has(p)),
    ...Array.from(byPhase.keys()).filter(
      (p) => !PHASE_ORDER.includes(p as ConstructionPhase)
    ),
  ]

  for (const phase of orderedPhases) {
    const phaseTasks = byPhase.get(phase)!
    const starts = phaseTasks.map((t) => t.startDate).sort()
    const ends = phaseTasks.map((t) => t.endDateCalculated).sort()

    const avgProgress = Math.round(
      phaseTasks.reduce(
        (sum, task) =>
          sum + effectivePercentComplete(task.status, task.percentComplete),
        0
      ) /
        phaseTasks.length
    )

    groups.push({
      phase,
      label: PHASE_LABELS[phase as ConstructionPhase] ?? phase,
      tasks: phaseTasks,
      startDate: starts[0],
      endDate: ends[ends.length - 1],
      progress: avgProgress,
      isComplete: phaseTasks.every((t) => t.status === "COMPLETE"),
    })
  }

  return groups
}

function derivePhaseDeps(
  phase: string,
  groups: PhaseGroup[],
  dependencies: TaskDependencyData[],
  collapsedPhases: Set<string>
): string[] {
  const group = groups.find((g) => g.phase === phase)
  if (!group) return []

  const taskIds = new Set(group.tasks.map((t) => t.id))
  const predecessorPhases = new Set<string>()

  for (const dep of dependencies) {
    if (!taskIds.has(dep.successorId)) continue
    if (taskIds.has(dep.predecessorId)) continue

    const predGroup = groups.find((g) =>
      g.tasks.some((t) => t.id === dep.predecessorId)
    )
    if (predGroup && collapsedPhases.has(predGroup.phase)) {
      predecessorPhases.add(phaseTaskId(predGroup.phase))
    }
  }

  return Array.from(predecessorPhases)
}

export interface PhaseTransformResult {
  frappeTasks: FrappeTask[]
  displayItems: DisplayItem[]
}

export function transformWithPhaseGroups(
  tasks: ScheduleTaskData[],
  dependencies: TaskDependencyData[],
  collapsedPhases: Set<string>
): PhaseTransformResult {
  const groups = groupTasksByPhase(tasks)
  const frappeTasks: FrappeTask[] = []
  const displayItems: DisplayItem[] = []

  const predMap = new Map<string, string[]>()
  for (const dep of dependencies) {
    if (!predMap.has(dep.successorId)) predMap.set(dep.successorId, [])
    predMap.get(dep.successorId)!.push(dep.predecessorId)
  }

  for (const group of groups) {
    const collapsed = collapsedPhases.has(group.phase)
    displayItems.push({
      type: "phase-header",
      phase: group.phase,
      group,
      collapsed,
    })

    if (collapsed) {
      const phaseDeps = derivePhaseDeps(
        group.phase, groups, dependencies, collapsedPhases
      )
      frappeTasks.push({
        id: phaseTaskId(group.phase),
        name: group.label,
        start: group.startDate,
        end: group.endDate,
        progress: group.progress,
        dependencies: phaseDeps.join(", "),
        custom_class: phaseClassName(group.phase),
        displayColor: null,
        isCriticalPath: false,
        isMilestone: false,
      })
    } else {
      for (const task of group.tasks) {
        displayItems.push({ type: "task", task })

        const rawPreds = predMap.get(task.id) || []
        const resolvedPreds = rawPreds.map((predId) => {
          const predGroup = groups.find((g) =>
            g.tasks.some((t) => t.id === predId)
          )
          if (predGroup && collapsedPhases.has(predGroup.phase)) {
            return phaseTaskId(predGroup.phase)
          }
          return predId
        })
        const depString = [...new Set(resolvedPreds)].join(", ")

        const progress = effectivePercentComplete(
          task.status,
          task.percentComplete
        )

        const customClass = `display-color-${normalizeDisplayColor(task.displayColor)}`

        frappeTasks.push({
          id: task.id,
          name: task.title,
          start: task.startDate,
          end: task.endDateCalculated,
          progress,
          dependencies: depString,
          custom_class: customClass,
          displayColor: task.displayColor,
          isCriticalPath: task.isCriticalPath,
          isMilestone: task.isMilestone,
        })
      }
    }
  }

  return { frappeTasks, displayItems }
}
