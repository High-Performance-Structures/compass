import { parseDateOnly } from "@/lib/format"
import { canonicalRfiStatus, rfiMatchesStatusFilter, type RfiStatus, type RfiStatusFilter } from "@/lib/rfis/status"

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

const STATUS_ORDER: readonly RfiStatus[] = ["new", "in_progress", "info_needed", "complete", "void"]

/** Status sorts in workflow order (new first, void last), not alphabetically. */
export function rfiStatusSortValue(status: string): number {
  return STATUS_ORDER.indexOf(canonicalRfiStatus(status))
}

export function rfiStatusLabel(status: string): string {
  return canonicalRfiStatus(status)
    .split("_")
    .map((part, index) => (index === 0 ? `${part.slice(0, 1).toUpperCase()}${part.slice(1)}` : part))
    .join(" ")
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
export function rfiMatchesSearch(row: RfiListRow, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [
    row.rfiNumber,
    row.subject,
    row.question,
    row.assignedToName,
    row.companyName,
    row.requesterName,
    rfiStatusLabel(row.status),
  ].some((value) => value?.toLowerCase().includes(needle))
}

/** The RFI's record on its job's RFI page, keeping the list's status filter. */
export function rfiRecordHref(projectId: string, rfiId: string, statusFilter: RfiStatusFilter): string {
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

const RFI_FILTERS: readonly { readonly value: RfiStatusFilter; readonly label: string }[] = [
  { value: "open", label: "Open" },
  { value: "new", label: "New" },
  { value: "in_progress", label: "In progress" },
  { value: "info_needed", label: "Info needed" },
  { value: "complete", label: "Complete" },
  { value: "void", label: "Void" },
  { value: "all", label: "All" },
]

/** The status buttons above the RFI list, each with its count; Open and All always show. */
export function rfiStatusFilterOptions(statuses: readonly string[]): readonly {
  readonly value: RfiStatusFilter
  readonly label: string
  readonly count: number
  readonly pinned: boolean
}[] {
  return RFI_FILTERS.map((option) => ({
    ...option,
    count: statuses.filter((status) => rfiMatchesStatusFilter(status, option.value)).length,
    pinned: option.value === "open" || option.value === "all",
  }))
}
