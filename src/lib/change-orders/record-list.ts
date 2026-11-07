/**
 * Row values for the Change Orders sheet: the status groups behind its filter
 * buttons, search and sort keys. Pure: no React, database or network access.
 */
import type { ChangeOrderStatus } from "@/lib/domain/estimates/statuses"
import { changeOrderDisplayStatus } from "@/lib/change-orders/status"
import type { ProjectChangeOrderItem } from "@/lib/change-orders/types"

/** The fixed change-order steps, grouped for the filter buttons. */
export type ChangeOrderStatusGroup = "in_progress" | "with_owner" | "executed" | "closed" | "ended"

export type ChangeOrderListFilter = "open" | "in_progress" | "with_owner" | "executed" | "closed" | "all"

export const CHANGE_ORDER_LIST_FILTERS: readonly { readonly value: ChangeOrderListFilter; readonly label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "with_owner", label: "With owner" },
  { value: "executed", label: "Executed" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
]

const GROUP_BY_STATUS: Readonly<Record<ChangeOrderStatus, ChangeOrderStatusGroup>> = {
  draft: "in_progress",
  submitted: "in_progress",
  triage: "in_progress",
  needs_information: "in_progress",
  pricing: "in_progress",
  internal_review: "in_progress",
  approved_for_owner: "with_owner",
  signature_pending: "with_owner",
  executed: "executed",
  sage_pending: "executed",
  synced: "executed",
  closed: "closed",
  declined: "ended",
  void: "ended",
}

export function changeOrderStatusGroup(status: ChangeOrderStatus): ChangeOrderStatusGroup {
  return GROUP_BY_STATUS[status]
}

export function parseChangeOrderListFilter(value: string | null | undefined): ChangeOrderListFilter {
  return CHANGE_ORDER_LIST_FILTERS.find((filter) => filter.value === value)?.value ?? "open"
}

export function changeOrderMatchesFilter(item: ProjectChangeOrderItem, filter: ChangeOrderListFilter): boolean {
  const group = changeOrderStatusGroup(item.status)
  if (filter === "all") return true
  if (filter === "open") return group !== "closed" && group !== "ended"
  return group === filter
}

/** Status sorts by workflow step, so a column sort reads in process order. */
export function changeOrderStatusSortValue(status: ChangeOrderStatus): number {
  return ["in_progress", "with_owner", "executed", "closed", "ended"].indexOf(changeOrderStatusGroup(status))
}

/** "CO-012" and "V-003" sort by type, then number, not as text ("CO-10" after "CO-9"). */
export function changeOrderNumberSortValue(item: ProjectChangeOrderItem): string {
  const match = /^(.*?)(\d+)$/.exec(item.changeOrderNumber.trim())
  return match ? `${match[1] ?? ""}${(match[2] ?? "").padStart(8, "0")}` : item.changeOrderNumber
}

export function changeOrderMatchesSearch(item: ProjectChangeOrderItem, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [
    item.changeOrderNumber,
    item.formerChangeOrderNumber,
    item.title,
    item.scope,
    item.requesterName,
    item.requesterCompany,
    changeOrderDisplayStatus(item.status, item.sourceType),
    item.recordType === "variance" ? "variance" : "change order",
  ].some((value) => value?.toLowerCase().includes(needle))
}
