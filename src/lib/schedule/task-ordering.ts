import type { ScheduleTaskData } from "./types"

export type ScheduleOrderMode = "chronological" | "manual"

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  })
}

export function isScheduleOrderMode(
  value: string | null
): value is ScheduleOrderMode {
  return value === "chronological" || value === "manual"
}

export function scheduleOrderStorageKey(projectId: string): string {
  return `compass-schedule-order:${projectId}`
}

export function orderScheduleTasks(
  tasks: readonly ScheduleTaskData[],
  mode: ScheduleOrderMode
): ScheduleTaskData[] {
  return [...tasks].sort((left, right) => {
    if (mode === "manual") {
      return (
        left.sortOrder - right.sortOrder ||
        compareText(left.startDate, right.startDate) ||
        compareText(left.title, right.title) ||
        compareText(left.id, right.id)
      )
    }

    return (
      compareText(left.startDate, right.startDate) ||
      compareText(left.endDateCalculated, right.endDateCalculated) ||
      left.sortOrder - right.sortOrder ||
      compareText(left.title, right.title) ||
      compareText(left.id, right.id)
    )
  })
}
