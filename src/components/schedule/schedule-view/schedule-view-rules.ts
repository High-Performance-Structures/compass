import { primaryParty, type ScheduleConflict, type ScheduleConflictSettings } from "@/lib/schedule/conflicts"
import { scheduleItemAssigneeNames } from "@/lib/schedule/assignees"
import type { ScheduleProjectData } from "@/lib/schedule/project-scope"
import { orderScheduleTasks, type ScheduleOrderMode } from "@/lib/schedule/task-ordering"
import { STATUS_OPTIONS, type ScheduleTaskData, type TaskFilters, type TaskStatus } from "@/lib/schedule/types"
import {
  SCHEDULE_GROUP_MODES,
  SCHEDULE_LIST_COLUMNS,
  SCHEDULE_VIEW_PRESETS,
  type ScheduleGroupMode,
  type ScheduleListColumn,
  type ScheduleViewPreset,
} from "@/lib/schedule/saved-views"
import type { SchedulePrintItem } from "../schedule-print-document"

export type View = "calendar" | "list" | "gantt"

// Every schedule starts ungrouped, so several jobs' items mix on one
// timeline in date order and overlaps sit side by side. "By project" is
// still a grouping choice.
const DEFAULT_SCHEDULE_GROUP: ScheduleGroupMode = "none"

type SearchParamReader = { readonly get: (key: string) => string | null }

/** Preset, grouping, columns and status filter requested in the URL. */
export function requestedScheduleSettings(searchParams: SearchParamReader): {
  readonly preset: ScheduleViewPreset
  readonly group: ScheduleGroupMode
  readonly columns: readonly ScheduleListColumn[]
  readonly statuses: readonly TaskStatus[]
} {
  const requestedPreset = searchParams.get("preset")
  const requestedGroup = searchParams.get("group")
  const requestedColumns = (searchParams.get("columns") ?? "")
    .split(",")
    .filter((value): value is ScheduleListColumn =>
      SCHEDULE_LIST_COLUMNS.some((column) => column === value)
    )
  return {
    preset: SCHEDULE_VIEW_PRESETS.find((value) => value === requestedPreset) ?? "all",
    group: SCHEDULE_GROUP_MODES.find((value) => value === requestedGroup) ?? DEFAULT_SCHEDULE_GROUP,
    columns: requestedColumns.length > 0 ? requestedColumns : [...SCHEDULE_LIST_COLUMNS],
    statuses: (searchParams.get("status") ?? "")
      .split(",")
      .flatMap((value) => {
        const option = STATUS_OPTIONS.find((candidate) => candidate.value === value)
        return option ? [option.value] : []
      }),
  }
}

/** The schedule's URL query for the current view state. */
export function scheduleQueryString(
  current: string,
  state: {
    readonly view: View
    readonly orderMode: ScheduleOrderMode
    readonly filters: TaskFilters
    readonly preset: ScheduleViewPreset
    readonly groupMode: ScheduleGroupMode
    readonly conflictsOnly: boolean
    readonly visibleColumns: readonly ScheduleListColumn[]
  }
): string {
  const params = new URLSearchParams(current)
  params.set("view", state.view)
  params.set("order", state.orderMode)

  const setOrDelete = (key: string, value: string): void => {
    if (value) params.set(key, value)
    else params.delete(key)
  }
  setOrDelete("status", state.filters.status.join(","))
  setOrDelete("phase", state.filters.phase.join(","))
  setOrDelete("assignee", state.filters.assignedTo)
  setOrDelete("q", state.filters.search)
  setOrDelete("preset", state.preset === "all" ? "" : state.preset)
  setOrDelete("group", state.groupMode === DEFAULT_SCHEDULE_GROUP ? "" : state.groupMode)
  setOrDelete("conflicts", state.conflictsOnly ? "1" : "")
  setOrDelete(
    "columns",
    state.visibleColumns.length === SCHEDULE_LIST_COLUMNS.length
      ? ""
      : state.visibleColumns.join(",")
  )
  return params.toString()
}

/** Distinct phases in first-seen order. */
export function schedulePhaseOptions(
  tasks: readonly ScheduleTaskData[]
): readonly { value: string; label: string }[] {
  const seen = new Set<string>()
  return tasks
    .map((task) => task.phase)
    .filter((phase) => {
      if (!phase || seen.has(phase)) return false
      seen.add(phase)
      return true
    })
    .map((phase) => ({ value: phase, label: phase }))
}

/**
 * The items the schedule shows: conflict, status, phase, assignee, search and
 * date-preset filters, then ordering and grouping. `now` is the current time.
 */
export function visibleScheduleTasks(input: {
  readonly tasks: readonly ScheduleTaskData[]
  readonly conflicts: ReadonlyMap<string, readonly ScheduleConflict[]>
  readonly conflictsOnly: boolean
  readonly filters: TaskFilters
  readonly preset: ScheduleViewPreset
  readonly currentUserAssigneeTerms: readonly string[]
  readonly orderMode: ScheduleOrderMode
  readonly groupMode: ScheduleGroupMode
  readonly scheduleProjects: readonly ScheduleProjectData[]
  readonly conflictSettings: ScheduleConflictSettings
  readonly now: Date
}): ScheduleTaskData[] {
  const { filters, preset, groupMode, conflictSettings } = input
  let tasks = input.tasks
  if (input.conflictsOnly) tasks = tasks.filter((task) => input.conflicts.has(task.id))

  if (filters.status.length > 0) {
    tasks = tasks.filter((t) => filters.status.includes(t.status))
  }
  if (filters.phase.length > 0) {
    tasks = tasks.filter((t) => filters.phase.includes(t.phase))
  }
  if (filters.assignedTo) {
    const search = filters.assignedTo.toLowerCase()
    // Any one of an item's people matches; all assignees are equal.
    tasks = tasks.filter((t) =>
      scheduleItemAssigneeNames(t).some((name) => name.toLowerCase().includes(search))
    )
  }
  if (filters.search) {
    const search = filters.search.toLowerCase()
    tasks = tasks.filter((t) =>
      t.title.toLowerCase().includes(search)
    )
  }
  const today = new Date(input.now)
  today.setHours(0, 0, 0, 0)
  if (preset === "my-items") {
    const terms = input.currentUserAssigneeTerms
      .map((term) => term.trim().toLowerCase())
      .filter(Boolean)
    tasks = tasks.filter((task) =>
      scheduleItemAssigneeNames(task).some((name) => {
        const assignee = name.toLowerCase()
        return terms.some((term) => assignee === term || assignee.includes(term))
      })
    )
  } else if (preset === "past-due") {
    tasks = tasks.filter(
      (task) =>
        task.status !== "COMPLETE" &&
        new Date(`${task.endDateCalculated}T00:00:00`).getTime() <
          today.getTime()
    )
  } else if (
    preset === "next-7" ||
    preset === "next-30" ||
    preset === "next-90"
  ) {
    const dayCount =
      preset === "next-7" ? 7 : preset === "next-30" ? 30 : 90
    const horizon = new Date(today)
    horizon.setDate(horizon.getDate() + dayCount)
    tasks = tasks.filter(
      (task) =>
        new Date(`${task.startDate}T00:00:00`).getTime() <=
          horizon.getTime() &&
        new Date(`${task.endDateCalculated}T00:00:00`).getTime() >=
          today.getTime()
    )
  }

  const ordered = orderScheduleTasks(tasks, input.orderMode)
  if (groupMode === "none") return ordered

  const projectById = new Map(
    input.scheduleProjects.map((project) => [project.id, project])
  )
  const groupKey = (task: (typeof ordered)[number]): string => {
    if (groupMode === "phase") return task.phase
    if (groupMode === "status") return task.status
    if (groupMode === "crew") {
      // Unassigned items sort after every named crew.
      const party = primaryParty(task.assignedTo, conflictSettings)
      return party.key ? party.label : "￿"
    }
    const project = projectById.get(task.projectId)
    return project?.projectNumber ?? project?.name ?? task.projectId
  }
  return [...ordered].sort((left, right) =>
    groupKey(left).localeCompare(groupKey(right))
  )
}

/** The fields the print document needs from each visible item. */
export function schedulePrintItems(tasks: readonly ScheduleTaskData[]): SchedulePrintItem[] {
  return tasks.map((task) => ({
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    startDate: task.startDate,
    endDate: task.endDateCalculated,
    workdays: task.workdays,
    status: task.status,
    phase: task.phase,
    displayColor: task.displayColor,
    assignedTo: task.assignedTo,
    percentComplete: task.percentComplete,
    isMilestone: task.isMilestone,
  }))
}

/** Adds the value when absent, removes it when present. */
export function toggleListValue<T>(current: readonly T[], value: T): T[] {
  return current.includes(value)
    ? current.filter((candidate) => candidate !== value)
    : [...current, value]
}

/** Column key shown as a readable label. */
export function scheduleColumnLabel(column: ScheduleListColumn): string {
  return column
    .replace("endDateCalculated", "End date")
    .replace("startDate", "Start date")
    .replace("assignedTo", "Responsible")
}

/** CSV export of the visible items; a Project column leads when several jobs show. */
export function scheduleCsv(
  tasks: readonly ScheduleTaskData[],
  scheduleProjects: readonly ScheduleProjectData[]
): string {
  const includeProject = scheduleProjects.length > 1
  const headers = [
    ...(includeProject ? ["Project"] : []),
    "Title", "Phase", "Status", "Start Date", "End Date",
    "Duration (days)", "% Complete", "Assigned To",
    "Critical Path", "Milestone",
  ]
  const rows = tasks.map((task) => [
    ...(includeProject
      ? [
          scheduleProjects.find(
            (project) => project.id === task.projectId
          )?.projectNumber ??
            scheduleProjects.find(
              (project) => project.id === task.projectId
            )?.name ??
            task.projectId,
        ]
      : []),
    task.title, task.phase, task.status, task.startDate,
    task.endDateCalculated, task.workdays.toString(),
    task.percentComplete.toString(), task.assignedTo ?? "",
    task.isCriticalPath ? "Yes" : "No",
    task.isMilestone ? "Yes" : "No",
  ])

  const escapeCSV = (value: string) => {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`
    }
    return value
  }

  return [
    headers.join(","),
    ...rows.map((row) => row.map(escapeCSV).join(",")),
  ].join("\n")
}

/**
 * Schedule items read from an imported CSV. Columns are found by header name;
 * rows without a title are skipped.
 */
export function parseScheduleCsv(text: string): Record<string, unknown>[] {
  const lines = text.split("\n")
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase())

  const titleIdx = headers.findIndex(
    (h) => h.includes("title") || h.includes("task")
  )
  const startIdx = headers.findIndex((h) => h.includes("start"))
  const durationIdx = headers.findIndex(
    (h) => h.includes("duration") || h.includes("days")
  )
  const phaseIdx = headers.findIndex((h) => h.includes("phase"))
  const assignedIdx = headers.findIndex(
    (h) => h.includes("assigned") || h.includes("owner")
  )

  const parsed: Record<string, unknown>[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const values = line.split(",").map((v) => v.trim())
    const task: Record<string, unknown> = {}

    if (titleIdx >= 0 && values[titleIdx]) task.title = values[titleIdx]
    if (startIdx >= 0 && values[startIdx]) task.startDate = values[startIdx]
    if (durationIdx >= 0 && values[durationIdx]) {
      task.workdays = parseInt(values[durationIdx]) || 1
    }
    if (phaseIdx >= 0 && values[phaseIdx]) task.phase = values[phaseIdx]
    if (assignedIdx >= 0 && values[assignedIdx]) {
      task.assignedTo = values[assignedIdx]
    }

    if (task.title) {
      task.status = "PENDING"
      task.percentComplete = 0
      parsed.push(task)
    }
  }
  return parsed
}
