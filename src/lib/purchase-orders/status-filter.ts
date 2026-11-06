/**
 * The status filter buttons above a purchase order sheet (a job's POs or all
 * jobs). Pure: no database access.
 *
 * Stored statuses vary in spelling ("Partially-Received", "voided",
 * "archived"), so each is first mapped to one of the purchase order statuses
 * Compass lists. "Open" is everything not complete, closed or void.
 */
import { PURCHASE_ORDER_STATUS_OPTIONS, type PurchaseOrderStatus } from "@/lib/project-operations/status"

export type PurchaseOrderStatusFilter = "open" | "all" | PurchaseOrderStatus

const FINISHED: readonly PurchaseOrderStatus[] = ["complete", "closed", "void"]

/** Stored spellings that mean one of the listed statuses. */
const ALIASES: Readonly<Record<string, PurchaseOrderStatus>> = {
  completed: "complete",
  archived: "closed",
  declined: "closed",
  voided: "void",
  cancelled: "void",
  canceled: "void",
}

function normalized(status: string): string {
  return status.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

/** The listed status a stored one means, or null for an unknown status (open). */
export function canonicalPurchaseOrderStatus(status: string): PurchaseOrderStatus | null {
  const value = normalized(status)
  return ALIASES[value] ?? PURCHASE_ORDER_STATUS_OPTIONS.find((option) => option.value === value)?.value ?? null
}

export function isOpenPurchaseOrder(status: string): boolean {
  const canonical = canonicalPurchaseOrderStatus(status)
  return canonical === null || !FINISHED.includes(canonical)
}

export function purchaseOrderMatchesFilter(status: string, filter: PurchaseOrderStatusFilter): boolean {
  if (filter === "all") return true
  if (filter === "open") return isOpenPurchaseOrder(status)
  return canonicalPurchaseOrderStatus(status) === filter
}

/** The filter in a `?status=` value; anything unknown shows the open POs. */
export function parsePurchaseOrderStatusFilter(value: string | readonly string[] | undefined): PurchaseOrderStatusFilter {
  const raw = typeof value === "string" ? value : value?.[0]
  if (raw === "all" || raw === "open") return raw
  const status = raw === undefined ? null : PURCHASE_ORDER_STATUS_OPTIONS.find((option) => option.value === raw)
  return status ? status.value : "open"
}

export type PurchaseOrderFilterOption = {
  readonly value: PurchaseOrderStatusFilter
  readonly label: string
  readonly count: number
  readonly pinned?: boolean
}

/**
 * Open, each listed status, then All, with how many POs each shows.
 * `statusCounts` is how many POs carry each stored status.
 */
export function purchaseOrderFilterOptions(
  statusCounts: readonly { readonly status: string; readonly count: number }[],
): readonly PurchaseOrderFilterOption[] {
  const countFor = (filter: PurchaseOrderStatusFilter): number =>
    statusCounts.reduce((total, row) => total + (purchaseOrderMatchesFilter(row.status, filter) ? row.count : 0), 0)
  return [
    { value: "open", label: "Open", count: countFor("open"), pinned: true },
    ...PURCHASE_ORDER_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label, count: countFor(option.value) })),
    { value: "all", label: "All", count: countFor("all"), pinned: true },
  ]
}
