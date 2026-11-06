export const PROJECT_TODO_RECORD_TYPES = [
  "staff_task",
  "subcontractor_task",
  "supplier_task",
  "schedule_task",
  "todo",
  "task",
] as const

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

export function projectTodoTypeLabel(value: string): string {
  if (value === "subcontractor_task") return "Subcontractor"
  if (value === "supplier_task") return "Supplier"
  if (value === "schedule_task") return "Schedule follow-up"
  return "Staff"
}
