import { parseDateOnly } from "@/lib/format"
import {
  recordStatusFilterOptions,
  recordStatusLabel,
  recordStatusSortValue,
  type RecordStatusFilter,
  type RecordStatusFilterOption,
  type RecordStatusList,
} from "@/lib/domain/record-statuses/rules"

/** One RFI as a row of the shared record table (staff list or vendor view). */
export type RfiListRow = {
  readonly id: string
  readonly rfiNumber: string
  readonly subject: string
  readonly question: string
  readonly status: string
  readonly priority: string
  readonly assignedToName: string | null
  readonly companyName: string | null
  readonly requesterName: string | null
  /** When the RFI was sent (ISO timestamp). */
  readonly submittedAt: string
  /** Response needed by (ISO date). */
  readonly dueDate: string | null
  readonly answeredAt: string | null
}

type RfiListSource = {
  readonly id: string
  readonly rfiNumber: string
  readonly subject: string
  readonly question: string
  readonly status: string
  readonly priority: string
  readonly assignedToName: string | null
  readonly companyName: string | null
  readonly requesterName: string | null
  readonly submittedAt: string
  readonly dueDate: string | null
  readonly answeredAt: string | null
}

export function rfiListRow(item: RfiListSource): RfiListRow {
  return {
    id: item.id,
    rfiNumber: item.rfiNumber,
    subject: item.subject,
    question: item.question,
    status: item.status,
    priority: item.priority,
    assignedToName: item.assignedToName,
    companyName: item.companyName,
    requesterName: item.requesterName,
    submittedAt: item.submittedAt,
    dueDate: item.dueDate,
    answeredAt: item.answeredAt,
  }
}

/** Status sorts in the company's workflow order (Settings › Statuses), not alphabetically. */
export function rfiStatusSortValue(status: string, statuses: RecordStatusList): number {
  return recordStatusSortValue(statuses, status)
}

/** The company's name for the RFI's status. */
export function rfiStatusLabel(status: string, statuses: RecordStatusList): string {
  return recordStatusLabel(statuses, status)
}

/** Who answers: the assigned person, else the company or trade asked. */
export function rfiAssigneeSortValue(row: RfiListRow): string | undefined {
  return row.assignedToName?.trim() || row.companyName?.trim() || undefined
}

/**
 * A date column's sort value: the timestamp in milliseconds, so dates sort by
 * when they are, never by their display text. Blank or unreadable dates are
 * undefined so they sort last.
 */
export function rfiDateSortValue(value: string | null): number | undefined {
  if (!value) return undefined
  const time = parseDateOnly(value)?.getTime() ?? Date.parse(value)
  return Number.isNaN(time) ? undefined : time
}

/** Search over the text a row shows: number, subject, question, people and status. */
export function rfiMatchesSearch(row: RfiListRow, query: string, statuses: RecordStatusList): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [
    row.rfiNumber,
    row.subject,
    row.question,
    row.assignedToName,
    row.companyName,
    row.requesterName,
    rfiStatusLabel(row.status, statuses),
  ].some((value) => value?.toLowerCase().includes(needle))
}

/** The RFI's record on its job's RFI page, keeping the list's status filter. */
export function rfiRecordHref(projectId: string, rfiId: string, statusFilter: RecordStatusFilter): string {
  const project = encodeURIComponent(projectId)
  const item = encodeURIComponent(rfiId)
  return `/dashboard/projects/${project}/rfis?status=${encodeURIComponent(statusFilter)}&item=${item}#rfi-${item}`
}

/**
 * The RFI a vendor link opens: `?item=<id>`, else a `#rfi-<id>` hash. Ids not
 * in the visible list open nothing.
 */
export function selectedRfiIdFromLocation(
  search: string,
  hash: string,
  visibleIds: readonly string[],
): string | null {
  const fromQuery = new URLSearchParams(search).get("item")
  const fromHash = hash.startsWith("#rfi-") ? safeDecode(hash.slice("#rfi-".length)) : null
  const candidate = fromQuery || fromHash
  return candidate && visibleIds.includes(candidate) ? candidate : null
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/**
 * The status buttons above the RFI list, each with its count: Open, each
 * status the company shows as a button (in its order), then All. Open and
 * All always show.
 */
export function rfiStatusFilterOptions(
  statuses: readonly string[],
  list: RecordStatusList,
): readonly RecordStatusFilterOption[] {
  return recordStatusFilterOptions(
    list,
    statuses.map((status) => ({ status, count: 1 })),
  )
}
