/**
 * Pure schedule rules: dependency validation and cycle detection, date
 * propagation, critical path, bulk-selection limits, and the field changes an
 * item edit produces. No database or network access, so the server actions
 * and the agent API share exactly the same decisions.
 */
import type { scheduleTasks } from "@/db/schema"
import { DEPENDENCY_TYPES, SCHEDULE_TASK_STATUSES } from "@/lib/domain/schedule/statuses"
import { isListValue } from "@/lib/shared/statuses"
import { findCriticalPath } from "@/lib/schedule/critical-path"
import {
  wouldCreateCycle,
  wouldDependencyUpdateCreateCycle,
} from "@/lib/schedule/dependency-validation"
import {
  joinAssigneeNames,
  MAX_SCHEDULE_ASSIGNEES,
  normalizeAssigneeInputs,
  type ScheduleAssigneeInput,
} from "@/lib/schedule/assignees"
import { effectivePercentComplete } from "@/lib/schedule/progress"
import { propagateDates, recalculateScheduleDates } from "@/lib/schedule/propagate-dates"
import type {
  DependencyType,
  ExceptionCategory,
  ExceptionRecurrence,
  ScheduleTaskData,
  ScheduleTaskPersonData,
  TaskDependencyData,
  TaskStatus,
  WorkdayExceptionData,
  WorkdayExceptionType,
} from "@/lib/schedule/types"

export type TaskDates = {
  readonly startDate: string
  readonly endDateCalculated: string
}

export type DateUpdates = ReadonlyMap<string, TaskDates>

/** Largest number of items one bulk complete, assign, or delete may touch. */
const BULK_TASK_LIMIT = 200

export const DEPENDENCY_ERRORS = {
  self: "A schedule item cannot depend on itself",
  outsideProject: "Both schedule items must belong to this project",
  duplicate: "That dependency already exists",
  cycle: "This dependency would create a cycle",
} as const

export function isTaskStatus(value: unknown): value is TaskStatus {
  return isListValue(SCHEDULE_TASK_STATUSES, value)
}

export function isDependencyType(value: unknown): value is DependencyType {
  return isListValue(DEPENDENCY_TYPES, value)
}

type TaskRow = Omit<ScheduleTaskData, "status" | "assignees"> & { readonly status: string }
type DependencyRow = Omit<TaskDependencyData, "type"> & { readonly type: string }
type ExceptionRow = Omit<WorkdayExceptionData, "type" | "category" | "recurrence"> & {
  readonly type: string
  readonly category: string
  readonly recurrence: string
}

/*
 * Row mappers. The stored text columns are written through validated paths,
 * so these keep the long-standing casts (an unexpected stored value passes
 * through unchanged rather than being coerced).
 */
export function taskWithStatus<T extends TaskRow>(row: T): T & { readonly status: TaskStatus } {
  return { ...row, status: row.status as TaskStatus }
}

/** A task as the schedule views show it: COMPLETE reads 100%, others cap at 99%. */
export function taskWithProgress<T extends TaskRow>(
  row: T
): T & { readonly status: TaskStatus; readonly percentComplete: number } {
  const status = row.status as TaskStatus
  return { ...row, status, percentComplete: effectivePercentComplete(status, row.percentComplete) }
}

export function dependencyData<T extends DependencyRow>(row: T): T & { readonly type: DependencyType } {
  return { ...row, type: row.type as DependencyType }
}

export function exceptionDataCast<T extends ExceptionRow>(
  row: T
): T & {
  readonly type: WorkdayExceptionType
  readonly category: ExceptionCategory
  readonly recurrence: ExceptionRecurrence
} {
  return {
    ...row,
    type: row.type as WorkdayExceptionType,
    category: row.category as ExceptionCategory,
    recurrence: row.recurrence as ExceptionRecurrence,
  }
}

/** The dependencies whose both ends are in `taskIds`. */
export function dependenciesWithin<T extends { readonly predecessorId: string; readonly successorId: string }>(
  taskIds: ReadonlySet<string>,
  dependencies: readonly T[]
): T[] {
  return dependencies.filter(
    (dependency) => taskIds.has(dependency.predecessorId) && taskIds.has(dependency.successorId)
  )
}

export function dependencySelfError(predecessorId: string, successorId: string): string | null {
  return predecessorId === successorId ? DEPENDENCY_ERRORS.self : null
}

/**
 * Checks a new or edited dependency in the order users have always seen the
 * messages: self-link, items outside the project, duplicate pair, cycle.
 * `replacingId` names the dependency being edited, which is ignored for the
 * duplicate and cycle checks.
 */
export function validateDependency(input: {
  readonly predecessorId: string
  readonly successorId: string
  readonly projectTaskIds: ReadonlySet<string>
  readonly dependencies: readonly TaskDependencyData[]
  readonly replacingId?: string
}): string | null {
  const self = dependencySelfError(input.predecessorId, input.successorId)
  if (self) return self
  if (!input.projectTaskIds.has(input.predecessorId) || !input.projectTaskIds.has(input.successorId)) {
    return DEPENDENCY_ERRORS.outsideProject
  }
  const others =
    input.replacingId === undefined
      ? input.dependencies
      : input.dependencies.filter((dependency) => dependency.id !== input.replacingId)
  if (
    others.some(
      (dependency) =>
        dependency.predecessorId === input.predecessorId &&
        dependency.successorId === input.successorId
    )
  ) {
    return DEPENDENCY_ERRORS.duplicate
  }
  const cycle =
    input.replacingId === undefined
      ? wouldCreateCycle([...input.dependencies], input.predecessorId, input.successorId)
      : wouldDependencyUpdateCreateCycle(
          input.dependencies,
          input.replacingId,
          input.predecessorId,
          input.successorId
        )
  return cycle ? DEPENDENCY_ERRORS.cycle : null
}

/** Dates of every successor that moves when `changedTaskId` moves. */
export function propagateFrom(
  changedTaskId: string,
  tasks: readonly ScheduleTaskData[],
  dependencies: readonly TaskDependencyData[],
  exceptions: readonly WorkdayExceptionData[]
): DateUpdates {
  return propagateDates(changedTaskId, tasks, dependencies, exceptions).updatedTasks
}

/** Dates of every task that moves when the working calendar changes. */
export function recalculateAll(
  tasks: readonly ScheduleTaskData[],
  dependencies: readonly TaskDependencyData[],
  exceptions: readonly WorkdayExceptionData[]
): DateUpdates {
  return recalculateScheduleDates(tasks, dependencies, exceptions).updatedTasks
}

/** Tasks whose stored critical-path flag no longer matches the schedule. */
export function criticalPathChanges(
  tasks: readonly ScheduleTaskData[],
  dependencies: readonly TaskDependencyData[]
): { readonly id: string; readonly isCriticalPath: boolean }[] {
  const critical = findCriticalPath([...tasks], [...dependencies])
  return tasks.flatMap((task) => {
    const isCriticalPath = critical.has(task.id)
    return task.isCriticalPath === isCriticalPath ? [] : [{ id: task.id, isCriticalPath }]
  })
}

/** The sort order for an item appended after `sortOrders` (ascending). */
export function nextSortOrder(sortOrders: readonly number[]): number {
  const last = sortOrders[sortOrders.length - 1]
  return last === undefined ? 0 : last + 1
}

/** Trimmed, de-duplicated ids for a bulk action, or the message to show. */
export function bulkTaskIds(
  taskIds: readonly string[],
  verb: "Update" | "Delete"
): { readonly ids: string[] } | { readonly error: string } {
  const ids = [...new Set(taskIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return { error: "Select at least one schedule item" }
  if (ids.length > BULK_TASK_LIMIT) {
    return { error: `${verb} no more than ${BULK_TASK_LIMIT} schedule items at a time` }
  }
  return { ids }
}

export function itemsLabel(count: number): string {
  return count === 1 ? "item" : "items"
}

/** Progress totals the agent API reports with a schedule. */
export function scheduleSummary(
  tasks: readonly Pick<
    ScheduleTaskData,
    "id" | "title" | "status" | "startDate" | "endDateCalculated" | "percentComplete" | "isCriticalPath"
  >[]
): {
  readonly total: number
  readonly completed: number
  readonly inProgress: number
  readonly blocked: number
  readonly pending: number
  readonly overallPercent: number
  readonly criticalPath: readonly {
    readonly id: string
    readonly title: string
    readonly status: TaskStatus
    readonly startDate: string
    readonly endDate: string
  }[]
} {
  const total = tasks.length
  const completed = tasks.filter((task) => task.status === "COMPLETE").length
  const inProgress = tasks.filter((task) => task.status === "IN_PROGRESS").length
  const blocked = tasks.filter((task) => task.status === "BLOCKED").length
  const overallPercent =
    total > 0 ? Math.round(tasks.reduce((sum, task) => sum + task.percentComplete, 0) / total) : 0
  return {
    total,
    completed,
    inProgress,
    blocked,
    pending: total - completed - inProgress - blocked,
    overallPercent,
    criticalPath: tasks
      .filter((task) => task.isCriticalPath)
      .map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        startDate: task.startDate,
        endDate: task.endDateCalculated,
      })),
  }
}

/** Revalidated after any change to a project's working schedule. */
export function schedulePaths(projectId: string): readonly string[] {
  return [
    `/dashboard/projects/${projectId}/schedule`,
    `/dashboard/projects/${projectId}/todos`,
    "/dashboard",
    "/dashboard/schedule",
  ]
}

/** What a create or edit asks about assignees, from the form or a legacy caller. */
export type AssigneeRequest = {
  readonly assignees?: readonly ScheduleAssigneeInput[]
  readonly assignedTo?: string | null
  readonly assignedOptionId?: string | null
}

/**
 * The assignee list a request sets: the form's `assignees`, or the single
 * legacy `assignedTo` (with its picked option) that older callers send.
 * Undefined leaves the assignees alone; an error names a list that is too long.
 */
export function requestedAssignees(
  request: AssigneeRequest
): { readonly inputs: ScheduleAssigneeInput[] } | { readonly error: string } | undefined {
  const raw =
    request.assignees ??
    (request.assignedTo === undefined
      ? undefined
      : request.assignedTo
        ? [{ name: request.assignedTo, optionId: request.assignedOptionId ?? null }]
        : [])
  if (raw === undefined) return undefined
  const inputs = normalizeAssigneeInputs(raw)
  if (inputs.length > MAX_SCHEDULE_ASSIGNEES) {
    return { error: `Assign at most ${MAX_SCHEDULE_ASSIGNEES} people to one schedule item.` }
  }
  return { inputs }
}

/**
 * The legacy columns for an assignee list: every name joined for
 * assigned_to, and the first linked account for assigned_user_id.
 */
export function legacyAssignment(people: readonly ScheduleTaskPersonData[]): {
  readonly assignedTo: string | null
  readonly assignedUserId: string | null
} {
  return {
    assignedTo: joinAssigneeNames(people.map((person) => person.name)),
    assignedUserId: people.find((person) => person.assignedUserId !== null)?.assignedUserId ?? null,
  }
}

/** Fields of a schedule item edit that map straight onto the stored row. */
export type TaskEditInput = {
  readonly title?: string
  readonly notes?: string | null
  readonly phase?: string
  readonly displayColor?: string
  readonly isMilestone?: boolean
  readonly assignedTo?: string | null
  readonly assignedOptionId?: string | null
  readonly ownerVisible?: boolean
  readonly subVendorVisible?: boolean
  readonly confirmationRequired?: boolean
}

const CLEARED_PROPOSAL = {
  confirmationRespondedAt: null,
  reminderSentAt: null,
  proposedStartDate: null,
  proposedWorkdays: null,
  proposalNote: null,
  proposalSubmittedAt: null,
} as const

/**
 * The column values an item edit writes. Dates are not included: they move
 * in the paired date batch so linked to-dos shift from the previous dates.
 * A reassignment or a changed confirmation rule restarts confirmation; an
 * accepted subcontractor proposal becomes a draft that is confirmed anew once
 * published.
 */
export function taskEditValues(input: {
  readonly data: TaskEditInput
  readonly workdays: number
  readonly status: TaskStatus
  readonly percentComplete: number
  readonly times: { readonly startTime: string | null; readonly endTime: string | null } | null
  readonly assignedUserId: string | null
  readonly confirmationRequired: boolean
  readonly restartConfirmation: { readonly status: string; readonly requestedAt: string | null } | null
  readonly acceptChangeProposal: boolean
  readonly now: string
}): Partial<typeof scheduleTasks.$inferInsert> {
  const { data } = input
  return {
    ...(data.title && { title: data.title }),
    ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
    workdays: input.workdays,
    ...(input.times && { startTime: input.times.startTime, endTime: input.times.endTime }),
    ...(data.phase && { phase: data.phase }),
    ...(data.displayColor && { displayColor: data.displayColor }),
    status: input.status,
    ...(data.isMilestone !== undefined && { isMilestone: data.isMilestone }),
    percentComplete: input.percentComplete,
    ...(data.assignedTo !== undefined && { assignedTo: data.assignedTo }),
    ...(data.assignedOptionId !== undefined || data.assignedTo === null
      ? { assignedUserId: input.assignedUserId }
      : {}),
    ...(data.ownerVisible !== undefined && { ownerVisible: data.ownerVisible }),
    ...(data.subVendorVisible !== undefined && { subVendorVisible: data.subVendorVisible }),
    ...(data.confirmationRequired !== undefined && { confirmationRequired: input.confirmationRequired }),
    ...(input.restartConfirmation
      ? {
          confirmationStatus: input.restartConfirmation.status,
          confirmationRequestedAt: input.restartConfirmation.requestedAt,
          ...CLEARED_PROPOSAL,
        }
      : {}),
    ...(input.acceptChangeProposal
      ? {
          confirmationStatus: input.confirmationRequired ? "pending" : "not_requested",
          confirmationRequestedAt: input.confirmationRequired ? input.now : null,
          ...CLEARED_PROPOSAL,
        }
      : {}),
    updatedAt: input.now,
  }
}

/** Owner preview pages also show the schedule. */
export function ownerSchedulePaths(projectId: string): readonly string[] {
  return [
    ...schedulePaths(projectId),
    `/preview/projects/${projectId}/owner`,
    `/preview/projects/${projectId}/owner/schedule`,
  ]
}
