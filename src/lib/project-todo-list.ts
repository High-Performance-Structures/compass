import type { ProjectTodoItem } from "@/lib/domain/operations/types"
import {
  isOpenRecordStatus,
  recordStatusFilterValue,
  recordStatusKey,
  recordStatusLabel,
  type RecordStatusFilter,
  type RecordStatusList,
} from "@/lib/domain/record-statuses/rules"
import { projectTodoTypeLabel } from "@/lib/project-todos"
import { normalizeWorkCalendarSearch } from "@/lib/work-calendar"

export function todoMatchesSearch(
  item: ProjectTodoItem,
  query: string,
  includeSource: boolean,
  statuses: RecordStatusList,
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
        recordStatusLabel(statuses, item.status),
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

/**
 * The status button a linked to-do shows under: Open while it counts as
 * Open, else its own status (so a link to a finished to-do still shows it).
 */
export function todoFilterForItem(item: ProjectTodoItem | null, statuses: RecordStatusList): RecordStatusFilter {
  if (!item || isOpenRecordStatus(statuses, item.status)) return "open"
  const key = recordStatusKey(statuses, item.status)
  return key === null ? "all" : recordStatusFilterValue(key)
}
