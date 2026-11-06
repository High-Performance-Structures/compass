/**
 * The status filter buttons above a purchase order sheet (a job's POs or all
 * jobs). Pure: no database access.
 *
 * Every rule reads the company's purchase order statuses (Settings ›
 * Statuses, resolved over the code defaults). Stored statuses vary in
 * spelling ("Partially-Received", "voided", "archived"), so each is first
 * read as one of the listed statuses through the registry's known spellings.
 * "Open" is every PO whose status counts as Open (an unknown status counts
 * as open).
 */
import {
  isOpenRecordStatus,
  parseRecordStatusFilter,
  recordStatusFilterOptions,
  recordStatusKey,
  recordStatusMatchesFilter,
  type RecordStatusFilter,
  type RecordStatusFilterOption,
  type RecordStatusList,
} from "@/lib/domain/record-statuses/rules"

export type PurchaseOrderStatusFilter = RecordStatusFilter

/** The listed status key a stored one means, or null for an unknown status (open). */
export function canonicalPurchaseOrderStatus(status: string, statuses: RecordStatusList): string | null {
  return recordStatusKey(statuses, status)
}

/** Whether the PO counts as Open: its status is in the company's Open group. */
export function isOpenPurchaseOrder(status: string, statuses: RecordStatusList): boolean {
  return isOpenRecordStatus(statuses, status)
}

export function purchaseOrderMatchesFilter(
  status: string,
  filter: PurchaseOrderStatusFilter,
  statuses: RecordStatusList,
): boolean {
  return recordStatusMatchesFilter(statuses, status, filter)
}

/** The filter in a `?status=` value; anything unknown shows the open POs. */
export function parsePurchaseOrderStatusFilter(
  value: string | readonly string[] | undefined,
  statuses: RecordStatusList,
): PurchaseOrderStatusFilter {
  return parseRecordStatusFilter(statuses, value)
}

/**
 * Open, each status the company shows as a button, then All, with how many
 * POs each shows. `statusCounts` is how many POs carry each stored status.
 */
export function purchaseOrderFilterOptions(
  statusCounts: readonly { readonly status: string; readonly count: number }[],
  statuses: RecordStatusList,
): readonly RecordStatusFilterOption[] {
  return recordStatusFilterOptions(statuses, statusCounts)
}
