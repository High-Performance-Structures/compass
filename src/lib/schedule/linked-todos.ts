import { isProjectTodoRecordType } from "@/lib/project-todos"

export function linkedScheduleTaskId(
  operation: {
    readonly sourceRecordType: string
    readonly sourceRecordId: string | null
  },
  scheduleTaskIds: ReadonlySet<string>
): string | null {
  if (!isProjectTodoRecordType(operation.sourceRecordType)) return null
  if (!operation.sourceRecordId) return null
  return scheduleTaskIds.has(operation.sourceRecordId)
    ? operation.sourceRecordId
    : null
}

export function linkedTodoSourceLabel(
  taskTitle: string,
  taskNumber: string | null
): string {
  return taskNumber
    ? `Schedule: ${taskTitle} · ${taskNumber}`
    : `Schedule: ${taskTitle}`
}
