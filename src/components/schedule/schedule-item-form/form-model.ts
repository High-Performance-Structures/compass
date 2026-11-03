import { z } from "zod"
import type { SearchableComboboxOption } from "@/components/searchable-combobox"
import type { ReusableSchedulePhaseOption } from "@/app/actions/schedule-phases"
import { normalizeScheduleItemTimes } from "@/lib/schedule/item-time"
import { scheduleItemAssigneeNames } from "@/lib/schedule/assignees"
import type {
  DependencyType,
  ScheduleTaskData,
  TaskDependencyData,
  TaskStatus,
} from "@/lib/schedule/types"
import { PHASE_ORDER, PHASE_LABELS } from "@/lib/schedule/phase-colors"
import { DEFAULT_DISPLAY_COLOR } from "@/lib/schedule/appearance"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import { DEFAULT_NEW_SCHEDULE_ITEM_WORKDAYS } from "@/components/schedule/schedule-item-defaults"

export const defaultPhaseOptions: readonly ReusableSchedulePhaseOption[] = PHASE_ORDER.map((value) => ({
  id: null,
  value,
  label: PHASE_LABELS[value],
  source: "default"
}))

export const CUSTOM_PHASE_VALUE = "__custom_phase__"

// Predecessor options show start date and phase so items with the same title
// can be told apart.
export function predecessorPickerOptions(
  tasks: readonly ScheduleTaskData[]
): readonly SearchableComboboxOption[] {
  return tasks.map((task) => ({
    value: task.id,
    label: task.title,
    description: [task.startDate, task.phase].filter(Boolean).join(" · "),
  }))
}

// Phase picker options: saved and default phases (deduplicated by value), the
// item's current phase even when it is no longer listed, and the custom entry.
export function schedulePhasePickerOptions(
  options: readonly ReusableSchedulePhaseOption[],
  currentValue: string
): readonly SearchableComboboxOption[] {
  const seen = new Set<string>()
  const result: SearchableComboboxOption[] = []
  for (const option of options) {
    if (seen.has(option.value)) continue
    seen.add(option.value)
    result.push({ value: option.value, label: option.label })
  }
  if (currentValue !== "" && !seen.has(currentValue)) {
    result.push({ value: currentValue, label: currentValue, description: "Current phase" })
  }
  result.push({ value: CUSTOM_PHASE_VALUE, label: "+ Add custom phase…", keywords: "new custom" })
  return result
}

/** Adds a just-saved phase, replacing any option with the same name. */
export function withSavedPhaseOption(
  current: readonly ReusableSchedulePhaseOption[],
  saved: ReusableSchedulePhaseOption
): readonly ReusableSchedulePhaseOption[] {
  const withoutDuplicate = current.filter(
    (option) =>
      option.value.trim().toLocaleLowerCase() !==
      saved.value.trim().toLocaleLowerCase()
  )
  return [...withoutDuplicate, saved]
}

export const DEPENDENCY_TYPES: readonly { value: DependencyType; label: string }[] = [
  { value: "FS", label: "Finish-to-Start" },
  { value: "SS", label: "Start-to-Start" },
  { value: "FF", label: "Finish-to-Finish" },
  { value: "SF", label: "Start-to-Finish" }
]

export const scheduleItemSchema = z.object({
  title: z.string().min(1, "Title is required"),
  startDate: z.string().min(1, "Start date is required"),
  workdays: z.number().min(1, "Must be at least 1 day"),
  startTime: z.string(),
  endTime: z.string(),
  phase: z.string().trim().min(1, "Phase is required"),
  displayColor: z.string(),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETE", "BLOCKED"]),
  isMilestone: z.boolean(),
  percentComplete: z.number().min(0).max(100),
  // Everyone assigned, in picked order. All assignees are equal.
  assignees: z.array(z.object({ name: z.string(), optionId: z.string().nullable() })),
  ownerVisible: z.boolean(),
  subVendorVisible: z.boolean(),
  confirmationRequired: z.boolean(),
  notes: z.string(),
  shiftReason: z.string().max(500, "Reason must be 500 characters or fewer")
}).superRefine((values, context) => {
  const times = normalizeScheduleItemTimes(values.startTime, values.endTime)
  if (!times.success) {
    context.addIssue({ code: "custom", path: ["endTime"], message: times.error })
  }
})

export type ScheduleItemFormValues = z.infer<typeof scheduleItemSchema>

export interface PendingPredecessor {
  taskId: string
  type: DependencyType
  lagDays: number
}

/** Blank values for a new item, starting today. */
export function newScheduleItemValues(): ScheduleItemFormValues {
  return {
    title: "",
    startDate: new Date().toISOString().split("T")[0],
    workdays: DEFAULT_NEW_SCHEDULE_ITEM_WORKDAYS,
    startTime: "",
    endTime: "",
    phase: "preconstruction",
    displayColor: DEFAULT_DISPLAY_COLOR,
    status: "PENDING",
    isMilestone: false,
    percentComplete: 0,
    assignees: [],
    ownerVisible: true,
    subVendorVisible: false,
    confirmationRequired: false,
    notes: "",
    shiftReason: ""
  }
}

/**
 * Form values for an existing item; the shift reason always starts blank.
 * Each assignee is matched back to its picker option where one exists.
 */
export function editingTaskValues(
  task: ScheduleTaskData,
  assigneeOptions: readonly ProjectTaskAssigneeOption[] = []
): ScheduleItemFormValues {
  return {
    title: task.title,
    startDate: task.startDate,
    workdays: task.workdays,
    startTime: task.startTime ?? "",
    endTime: task.endTime ?? "",
    phase: task.phase,
    displayColor: task.displayColor ?? DEFAULT_DISPLAY_COLOR,
    status: task.status,
    isMilestone: task.isMilestone,
    percentComplete: task.percentComplete,
    assignees: scheduleItemAssigneeNames(task).map((name) => ({
      name,
      optionId: matchingAssigneeOptionId(assigneeOptions, name),
    })),
    ownerVisible: task.ownerVisible ?? true,
    subVendorVisible: task.subVendorVisible ?? false,
    confirmationRequired: task.confirmationRequired ?? false,
    notes: task.notes ?? "",
    shiftReason: ""
  }
}

/** The assignee option whose name matches a saved assignee name. */
export function matchingAssigneeOptionId(
  options: readonly ProjectTaskAssigneeOption[],
  assignedTo: string | null | undefined
): string | null {
  return (
    options.find(
      (option) =>
        option.name.trim().toLowerCase() === (assignedTo ?? "").trim().toLowerCase()
    )?.id ?? null
  )
}

/** Each saved predecessor's editable values, keyed by dependency id. */
export function predecessorEditsFor(
  dependencies: readonly TaskDependencyData[],
  taskId: string
): Record<string, PendingPredecessor> {
  return Object.fromEntries(
    dependencies
      .filter((dependency) => dependency.successorId === taskId)
      .map((dependency) => [
        dependency.id,
        {
          taskId: dependency.predecessorId,
          type: dependency.type,
          lagDays: dependency.lagDays
        }
      ])
  )
}

/** True when an edit changes a saved predecessor's item, type or lag. */
export function predecessorEditChanged(
  dependency: TaskDependencyData,
  edit: PendingPredecessor | undefined
): boolean {
  return Boolean(
    edit &&
      (edit.taskId !== dependency.predecessorId ||
        edit.type !== dependency.type ||
        edit.lagDays !== dependency.lagDays)
  )
}

/**
 * Whether saving moves the schedule: new dates or duration, a changed saved
 * predecessor, or a new predecessor with an item chosen.
 */
export function scheduleShiftRequested(input: {
  readonly editingTask: ScheduleTaskData | null
  readonly values: Pick<ScheduleItemFormValues, "startDate" | "workdays">
  readonly existingPredecessors: readonly TaskDependencyData[]
  readonly existingPredecessorEdits: Readonly<Record<string, PendingPredecessor>>
  readonly pendingPredecessors: readonly PendingPredecessor[]
}): boolean {
  const datesChanged =
    input.editingTask !== null &&
    (input.values.startDate !== input.editingTask.startDate ||
      input.values.workdays !== input.editingTask.workdays)
  const existingDependencyChanged = input.existingPredecessors.some((dependency) =>
    predecessorEditChanged(dependency, input.existingPredecessorEdits[dependency.id])
  )
  const dependencyAdded = input.pendingPredecessors.some(
    (predecessor) => predecessor.taskId.length > 0
  )
  return datesChanged || existingDependencyChanged || dependencyAdded
}

/** Progress to set when the status changes, or null to leave it. */
export function percentForStatusChange(status: string, currentPercent: number): number | null {
  if (status === "COMPLETE") return 100
  if (currentPercent >= 100) return status === "IN_PROGRESS" ? 50 : 0
  return null
}

/** Status to set when progress changes, or null to leave it. */
export function statusForPercentChange(percent: number, currentStatus: TaskStatus): TaskStatus | null {
  if (percent === 100 && currentStatus !== "COMPLETE") return "COMPLETE"
  if (percent < 100 && currentStatus === "COMPLETE") return percent > 0 ? "IN_PROGRESS" : "PENDING"
  return null
}

/** "not_requested" → "Not requested". */
export function confirmationStatusLabel(status: string | undefined): string {
  return (status ?? "not_requested")
    .replace(/_/g, " ")
    .replace(/^\w/, (letter) => letter.toUpperCase())
}

/** Adds or removes an id, keeping the list unchanged when nothing moves. */
export function toggleSelectedId(
  current: readonly string[],
  id: string,
  selected: boolean
): readonly string[] {
  return selected
    ? current.includes(id)
      ? current
      : [...current, id]
    : current.filter((candidate) => candidate !== id)
}
