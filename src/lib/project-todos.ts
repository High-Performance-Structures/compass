export const PROJECT_TODO_RECORD_TYPES = [
  "staff_task",
  "subcontractor_task",
  "supplier_task",
  "schedule_task",
  "todo",
  "task",
] as const

export type ProjectTodoRecordType =
  (typeof PROJECT_TODO_RECORD_TYPES)[number]

export const PROJECT_TODO_STATUSES = [
  "open",
  "in_progress",
  "blocked",
  "complete",
  "archived",
] as const

export type ProjectTodoStatus = (typeof PROJECT_TODO_STATUSES)[number]

export const PROJECT_TODO_SELECTABLE_STATUSES = [
  "open",
  "in_progress",
  "complete",
  "archived",
] as const

export type ProjectTodoSelectableStatus =
  (typeof PROJECT_TODO_SELECTABLE_STATUSES)[number]

const ARCHIVED_STATUSES = new Set(["archive", "archived", "cancelled"])
const COMPLETED_STATUSES = new Set(["complete", "completed", "closed", "done"])

export function isProjectTodoRecordType(value: string): boolean {
  return PROJECT_TODO_RECORD_TYPES.some((type) => type === value)
}

export function canonicalProjectTodoRecordType(
  value: string
): "staff_task" | "subcontractor_task" | "supplier_task" | "schedule_task" {
  if (value === "subcontractor_task") return "subcontractor_task"
  if (value === "supplier_task") return "supplier_task"
  if (value === "schedule_task") return "schedule_task"
  return "staff_task"
}

export function normalizeProjectTodoStatus(value: string): ProjectTodoStatus {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_")
  if (isArchivedProjectTodoStatus(normalized)) return "archived"
  if (normalized === "in_progress") return "in_progress"
  if (normalized === "blocked" || normalized === "on_hold") return "blocked"
  if (COMPLETED_STATUSES.has(normalized)) return "complete"
  return "open"
}

export function isProjectTodoStatus(value: string): value is ProjectTodoStatus {
  return PROJECT_TODO_STATUSES.some((status) => status === value)
}

export function isSelectableProjectTodoStatus(
  value: string
): value is ProjectTodoSelectableStatus {
  return PROJECT_TODO_SELECTABLE_STATUSES.some((status) => status === value)
}

export function isArchivedProjectTodoStatus(value: string): boolean {
  return ARCHIVED_STATUSES.has(value.trim().toLowerCase())
}

export function isCompletedProjectTodoStatus(value: string): boolean {
  return COMPLETED_STATUSES.has(value.trim().toLowerCase())
}

export function projectTodoStatusLabel(value: string): string {
  if (isArchivedProjectTodoStatus(value)) return "Archived"

  switch (normalizeProjectTodoStatus(value)) {
    case "open":
      return "Open"
    case "in_progress":
      return "In progress"
    case "blocked":
      return "Blocked"
    case "complete":
      return "Complete"
    case "archived":
      return "Archived"
  }
}

export function projectTodoTypeLabel(value: string): string {
  if (value === "subcontractor_task") return "Subcontractor"
  if (value === "supplier_task") return "Supplier"
  if (value === "schedule_task") return "Schedule follow-up"
  return "Staff"
}
