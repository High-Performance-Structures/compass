import { addBusinessDays, calculateEndDate } from "@/lib/schedule/business-days"
import type {
  DependencyType,
  WorkdayExceptionData,
} from "@/lib/schedule/types"

export type ScheduleTemplateItemDefinition = {
  readonly id: string
  readonly title: string
  readonly startOffsetWorkdays: number
  readonly workdays: number
  readonly phase: string
  readonly displayColor: string
  readonly isMilestone: boolean
  readonly assigneePlaceholder: string | null
  readonly ownerVisible: boolean
  readonly subVendorVisible: boolean
  readonly sortOrder: number
}

export type ScheduleTemplateDependencyDefinition = {
  readonly id: string
  readonly predecessorItemId: string
  readonly successorItemId: string
  readonly type: string
  readonly lagDays: number
}

export type InstantiatedScheduleTask = {
  readonly id: string
  readonly templateItemId: string
  readonly title: string
  readonly startDate: string
  readonly workdays: number
  readonly endDateCalculated: string
  readonly phase: string
  readonly displayColor: string
  readonly isMilestone: boolean
  readonly assignedTo: string | null
  readonly ownerVisible: boolean
  readonly subVendorVisible: boolean
  readonly sortOrder: number
}

export type InstantiatedScheduleDependency = {
  readonly id: string
  readonly predecessorId: string
  readonly successorId: string
  readonly type: DependencyType
  readonly lagDays: number
}

export type ScheduleTemplateApplicationBuild = {
  readonly tasks: readonly InstantiatedScheduleTask[]
  readonly dependencies: readonly InstantiatedScheduleDependency[]
}

export type ScheduleTemplateApplicationResult =
  | { readonly success: true; readonly data: ScheduleTemplateApplicationBuild }
  | { readonly success: false; readonly error: string }

function dependencyType(value: string): DependencyType | null {
  switch (value.toUpperCase()) {
    case "FS":
    case "SS":
    case "FF":
    case "SF":
      return value.toUpperCase() === "FS"
        ? "FS"
        : value.toUpperCase() === "SS"
          ? "SS"
          : value.toUpperCase() === "FF"
            ? "FF"
            : "SF"
    default:
      return null
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function containsDependencyCycle(
  itemIds: ReadonlySet<string>,
  dependencies: readonly ScheduleTemplateDependencyDefinition[]
): boolean {
  const successors = new Map<string, string[]>()
  for (const itemId of itemIds) successors.set(itemId, [])
  for (const dependency of dependencies) {
    successors.get(dependency.predecessorItemId)?.push(
      dependency.successorItemId
    )
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (itemId: string): boolean => {
    if (visiting.has(itemId)) return true
    if (visited.has(itemId)) return false
    visiting.add(itemId)
    for (const successor of successors.get(itemId) ?? []) {
      if (visit(successor)) return true
    }
    visiting.delete(itemId)
    visited.add(itemId)
    return false
  }

  return [...itemIds].some((itemId) => visit(itemId))
}

export function buildScheduleTemplateApplication(input: {
  readonly anchorDate: string
  readonly items: readonly ScheduleTemplateItemDefinition[]
  readonly dependencies: readonly ScheduleTemplateDependencyDefinition[]
  readonly exceptions: readonly WorkdayExceptionData[]
  readonly nextId: () => string
  readonly firstSortOrder: number
}): ScheduleTemplateApplicationResult {
  if (!isIsoDate(input.anchorDate)) {
    return { success: false, error: "Choose a valid template start date." }
  }
  if (input.items.length === 0) {
    return { success: false, error: "This template has no schedule items." }
  }
  if (input.items.length > 500) {
    return {
      success: false,
      error: "A template may contain no more than 500 schedule items.",
    }
  }

  const itemIds = new Set<string>()
  for (const item of input.items) {
    if (itemIds.has(item.id)) {
      return { success: false, error: "The template contains a duplicate item." }
    }
    if (!item.title.trim()) {
      return { success: false, error: "Every template item needs a title." }
    }
    if (!Number.isInteger(item.startOffsetWorkdays) || item.startOffsetWorkdays < 0) {
      return { success: false, error: `Invalid start offset for “${item.title}”.` }
    }
    if (!Number.isInteger(item.workdays) || item.workdays < 1) {
      return { success: false, error: `Invalid duration for “${item.title}”.` }
    }
    itemIds.add(item.id)
  }

  for (const dependency of input.dependencies) {
    if (
      !itemIds.has(dependency.predecessorItemId) ||
      !itemIds.has(dependency.successorItemId)
    ) {
      return {
        success: false,
        error: "A template dependency references an unknown schedule item.",
      }
    }
    if (dependency.predecessorItemId === dependency.successorItemId) {
      return { success: false, error: "A template item cannot depend on itself." }
    }
    if (!dependencyType(dependency.type)) {
      return { success: false, error: "The template has an unsupported dependency type." }
    }
  }
  if (containsDependencyCycle(itemIds, input.dependencies)) {
    return { success: false, error: "The template contains a dependency cycle." }
  }

  const orderedItems = [...input.items].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title)
  )
  const scheduleTaskIdByTemplateItem = new Map<string, string>()
  const tasks = orderedItems.map((item, index): InstantiatedScheduleTask => {
    const id = input.nextId()
    scheduleTaskIdByTemplateItem.set(item.id, id)
    const startDate = addBusinessDays(
      input.anchorDate,
      item.startOffsetWorkdays,
      input.exceptions
    )
    return {
      id,
      templateItemId: item.id,
      title: item.title.trim(),
      startDate,
      workdays: item.workdays,
      endDateCalculated: calculateEndDate(startDate, item.workdays, input.exceptions),
      phase: item.phase.trim() || "Unassigned / General",
      displayColor: item.displayColor || "blue",
      isMilestone: item.isMilestone,
      assignedTo: item.assigneePlaceholder?.trim() || null,
      ownerVisible: item.ownerVisible,
      subVendorVisible: item.subVendorVisible,
      sortOrder: input.firstSortOrder + index,
    }
  })

  const dependencies: InstantiatedScheduleDependency[] = []
  for (const dependency of input.dependencies) {
    const predecessorId = scheduleTaskIdByTemplateItem.get(
      dependency.predecessorItemId
    )
    const successorId = scheduleTaskIdByTemplateItem.get(
      dependency.successorItemId
    )
    const type = dependencyType(dependency.type)
    if (!predecessorId || !successorId || !type) {
      return { success: false, error: "Unable to instantiate template dependencies." }
    }
    dependencies.push({
      id: input.nextId(),
      predecessorId,
      successorId,
      type,
      lagDays: dependency.lagDays,
    })
  }

  return { success: true, data: { tasks, dependencies } }
}
