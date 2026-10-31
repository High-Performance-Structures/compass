import type { ProjectTodoItem } from "@/lib/domain/operations/types"
import {
  isArchivedProjectTodoStatus,
  isCompletedProjectTodoStatus,
  projectTodoTypeLabel,
} from "@/lib/project-todos"
import { normalizeWorkCalendarSearch } from "@/lib/work-calendar"

export type TodoFilter = "active" | "completed" | "archived" | "all"

export function todoMatchesFilter(item: ProjectTodoItem, filter: TodoFilter): boolean {
  if (filter === "all") return true
  if (filter === "archived") return isArchivedProjectTodoStatus(item.status)
  const active = !isArchivedProjectTodoStatus(item.status)
  return (
    active &&
    (filter === "completed"
      ? isCompletedProjectTodoStatus(item.status)
      : !isCompletedProjectTodoStatus(item.status))
  )
}

export function todoMatchesSearch(
  item: ProjectTodoItem,
  query: string,
  includeSource: boolean,
): boolean {
  const search = normalizeWorkCalendarSearch(query)
  return (
    !search ||
    normalizeWorkCalendarSearch(
      [
        item.title,
        item.description,
        item.sourceRecordNumber,
        item.assigneeName,
        item.companyName,
        item.status,
        item.priority,
        item.authorName,
        projectTodoTypeLabel(item.sourceRecordType),
        includeSource ? item.sourceSystem : null,
      ]
        .filter(Boolean)
        .join(" "),
    ).includes(search)
  )
}

export function todoFilterForItem(item: ProjectTodoItem | null): TodoFilter {
  if (!item) return "active"
  if (isArchivedProjectTodoStatus(item.status)) return "archived"
  return isCompletedProjectTodoStatus(item.status) ? "completed" : "active"
}
