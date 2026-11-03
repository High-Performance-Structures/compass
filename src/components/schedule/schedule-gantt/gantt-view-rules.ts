import { primaryParty, type ScheduleConflict, type ScheduleConflictSettings } from "@/lib/schedule/conflicts"
import {
  transformToFrappeTasks,
  transformWithPhaseGroups,
  type DisplayItem,
  type PhaseTransformResult,
} from "@/lib/schedule/gantt-transform"
import { DEFAULT_DISPLAY_COLOR_LABELS, type DisplayColor } from "@/lib/schedule/appearance"
import type { ScheduleProjectData } from "@/lib/schedule/project-scope"
import type { ScheduleTaskData, TaskDependencyData } from "@/lib/schedule/types"
import type { GanttScrollPosition } from "../gantt-chart"

export type ViewMode = "Day" | "Week" | "Month" | "Year"

export const VIEW_MODES: readonly ViewMode[] = ["Day", "Week", "Month", "Year"]

export const DEFAULT_COLUMN_WIDTHS: Readonly<Record<ViewMode, number>> = {
  Day: 38,
  Week: 140,
  Month: 120,
  Year: 160,
}

/** Column width after one zoom step, rounded and kept within 20–300px. */
export function zoomedColumnWidth(current: number, direction: "in" | "out"): number {
  const next = direction === "in" ? current * 1.3 : current / 1.3
  return Math.round(Math.min(300, Math.max(20, next)))
}

// Local calendar date (YYYY-MM-DD) so "today" matches the viewer's day.
export function localIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Key meanings saved in this browser, over the defaults. Only non-blank text
 * values are kept. Null when nothing usable was saved (null or undefined).
 */
export function storedPaletteLabels(value: unknown): Record<DisplayColor, string> | null {
  if (value === null || value === undefined) return null
  return {
    ...DEFAULT_DISPLAY_COLOR_LABELS,
    ...Object.fromEntries(
      Object.entries(Object(value)).filter(([, label]) => typeof label === "string" && label.trim())
    ),
  }
}

/** A scroll position saved in session storage, or null when malformed. */
export function storedGanttScrollPosition(parsed: unknown): GanttScrollPosition | null {
  if (
    parsed &&
    typeof parsed === "object" &&
    "left" in parsed &&
    "top" in parsed &&
    typeof parsed.left === "number" &&
    typeof parsed.top === "number" &&
    (!("anchorDate" in parsed) ||
      typeof parsed.anchorDate === "string")
  ) {
    const anchorDate =
      "anchorDate" in parsed &&
      typeof parsed.anchorDate === "string"
        ? parsed.anchorDate
        : null
    return {
      left: parsed.left,
      top: parsed.top,
      ...(anchorDate ? { anchorDate } : {}),
    }
  }
  return null
}

/** Date range of each list row, for finding the row nearest a date. */
export function displayItemDateRanges(
  displayItems: readonly DisplayItem[]
): readonly { startDate: string; endDate: string }[] {
  return displayItems.map((item) =>
    item.type === "task"
      ? {
          startDate: item.task.startDate,
          endDate: item.task.endDateCalculated,
        }
      : {
          startDate: item.group.startDate,
          endDate: item.group.endDate,
        }
  )
}

/**
 * Chart bars and list rows: grouped by crew, by phase, or flat. Conflicting
 * items are marked, and with several projects each bar carries its project
 * color.
 */
export function ganttDisplay(input: {
  readonly tasks: readonly ScheduleTaskData[]
  readonly dependencies: readonly TaskDependencyData[]
  readonly collapsedPhases: Set<string>
  readonly groupByCrew: boolean
  readonly phaseGrouping: boolean
  readonly conflictSettings: ScheduleConflictSettings
  readonly conflicts: ReadonlyMap<string, readonly ScheduleConflict[]>
  readonly multipleProjects: boolean
  readonly projectById: ReadonlyMap<string, ScheduleProjectData>
}): PhaseTransformResult {
  const { tasks, conflicts, projectById } = input
  // The transforms read but never change these lists.
  const taskList = [...tasks]
  const dependencyList = [...input.dependencies]
  const transformed = input.groupByCrew
    ? transformWithPhaseGroups(
        taskList,
        dependencyList,
        input.collapsedPhases,
        (task) => primaryParty(task.assignedTo, input.conflictSettings),
      )
    : input.phaseGrouping
    ? transformWithPhaseGroups(
        taskList,
        dependencyList,
        input.collapsedPhases,
      )
    : {
        frappeTasks: transformToFrappeTasks(
          taskList,
          dependencyList,
        ),
        displayItems: tasks.map(
          (task): DisplayItem => ({
            type: "task",
            task,
          })
        ),
      }

  // A double-booked crew outlines the bar in the destructive color.
  const marked = conflicts.size === 0
    ? transformed
    : {
        ...transformed,
        frappeTasks: transformed.frappeTasks.map((task) =>
          conflicts.has(task.id)
            ? { ...task, hasConflict: true }
            : task
        ),
      }
  if (!input.multipleProjects) return marked
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  return {
    ...marked,
    frappeTasks: marked.frappeTasks.map((task) => {
      const scheduleTask = taskById.get(task.id)
      const project = scheduleTask
        ? projectById.get(scheduleTask.projectId)
        : null
      return project ? { ...task, projectColor: project.color } : task
    }),
  }
}
