import { countBusinessDays, isNonWorkday } from "@/lib/schedule/business-days"
import type {
  DependencyType,
  WorkdayExceptionData,
} from "@/lib/schedule/types"
import { parseISO } from "date-fns"

const SCHEDULE_TEMPLATE_CAPTURE_LIMIT = 500

/** Template kind for schedules saved from a Compass project. */
export const SAVED_SCHEDULE_TEMPLATE_KIND = "schedule"

export type CapturableScheduleTask = {
  readonly id: string
  readonly title: string
  readonly notes: string | null
  readonly startDate: string
  readonly workdays: number
  readonly phase: string
  readonly displayColor: string | null
  readonly isMilestone: boolean
  readonly assignedTo: string | null
  readonly ownerVisible: boolean
  readonly subVendorVisible: boolean
  readonly sortOrder: number
}

export type CapturableScheduleDependency = {
  readonly predecessorId: string
  readonly successorId: string
  readonly type: DependencyType
  readonly lagDays: number
}

export type CapturedScheduleTemplateItem = {
  readonly id: string
  readonly sourceItemId: string
  readonly itemKey: string
  readonly title: string
  readonly startOffsetWorkdays: number
  readonly workdays: number
  readonly phase: string
  readonly displayColor: string
  readonly isMilestone: boolean
  readonly assigneePlaceholder: string | null
  readonly ownerVisible: boolean
  readonly subVendorVisible: boolean
  readonly notes: string | null
  readonly sortOrder: number
}

export type CapturedScheduleTemplateDependency = {
  readonly id: string
  readonly predecessorItemId: string
  readonly successorItemId: string
  readonly type: DependencyType
  readonly lagDays: number
}

type CapturedScheduleTemplate = {
  readonly items: readonly CapturedScheduleTemplateItem[]
  readonly dependencies: readonly CapturedScheduleTemplateDependency[]
}

export type ScheduleTemplateCaptureResult =
  | { readonly success: true; readonly data: CapturedScheduleTemplate }
  | { readonly success: false; readonly error: string }

/**
 * Workdays after `from` that `to` falls on, so addBusinessDays(anchor, n)
 * rebuilds the same spacing on another project's calendar.
 */
export function workdayOffset(
  from: string,
  to: string,
  exceptions: readonly WorkdayExceptionData[]
): number {
  if (to <= from) return 0
  const counted = countBusinessDays(from, to, exceptions)
  return Math.max(
    0,
    counted - (isNonWorkday(parseISO(from), exceptions) ? 0 : 1)
  )
}

/**
 * Turns a project's schedule into reusable template rows. Dates become
 * workday offsets from the earliest item; predecessors keep their type and
 * lag. Progress, confirmations and named users stay with the project.
 */
export function captureScheduleTemplate(input: {
  readonly tasks: readonly CapturableScheduleTask[]
  readonly dependencies: readonly CapturableScheduleDependency[]
  readonly exceptions: readonly WorkdayExceptionData[]
  readonly nextId: () => string
}): ScheduleTemplateCaptureResult {
  if (input.tasks.length === 0) {
    return { success: false, error: "This schedule has no items to save." }
  }
  if (input.tasks.length > SCHEDULE_TEMPLATE_CAPTURE_LIMIT) {
    return {
      success: false,
      error: `A template may contain no more than ${SCHEDULE_TEMPLATE_CAPTURE_LIMIT} schedule items.`,
    }
  }

  const ordered = [...input.tasks].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.startDate.localeCompare(right.startDate) ||
      left.title.localeCompare(right.title)
  )
  const firstStart = ordered.reduce(
    (earliest, task) => (task.startDate < earliest ? task.startDate : earliest),
    ordered[0].startDate
  )
  const itemIdByTaskId = new Map<string, string>()
  const items = ordered.map((task, index): CapturedScheduleTemplateItem => {
    const id = input.nextId()
    itemIdByTaskId.set(task.id, id)
    return {
      id,
      sourceItemId: task.id,
      itemKey: `item-${String(index + 1).padStart(3, "0")}`,
      title: task.title.trim(),
      startOffsetWorkdays: workdayOffset(firstStart, task.startDate, input.exceptions),
      workdays: Math.max(1, task.workdays),
      phase: task.phase.trim() || "Unassigned / General",
      displayColor: task.displayColor || "blue",
      isMilestone: task.isMilestone,
      assigneePlaceholder: task.assignedTo?.trim() || null,
      ownerVisible: task.ownerVisible,
      subVendorVisible: task.subVendorVisible,
      notes: task.notes?.trim() || null,
      sortOrder: index,
    }
  })

  const seenEdges = new Set<string>()
  const dependencies = input.dependencies.flatMap(
    (dependency): CapturedScheduleTemplateDependency[] => {
      const predecessorItemId = itemIdByTaskId.get(dependency.predecessorId)
      const successorItemId = itemIdByTaskId.get(dependency.successorId)
      if (!predecessorItemId || !successorItemId) return []
      const edge = `${predecessorItemId}:${successorItemId}:${dependency.type}`
      if (seenEdges.has(edge)) return []
      seenEdges.add(edge)
      return [
        {
          id: input.nextId(),
          predecessorItemId,
          successorItemId,
          type: dependency.type,
          lagDays: dependency.lagDays,
        },
      ]
    }
  )

  return { success: true, data: { items, dependencies } }
}
