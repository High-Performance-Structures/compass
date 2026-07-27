export type PurchaseOrderStatus =
  | "draft"
  | "approved"
  | "ordered"
  | "partially_received"
  | "received"
  | "complete"
  | "closed"
  | "void"

export type RfqStatus =
  | "draft"
  | "sent"
  | "response_received"
  | "awarded"
  | "declined"
  | "complete"
  | "closed"
  | "void"

export type ProjectOperationStatusFilter = "open" | "closed" | "all" | string

export const PURCHASE_ORDER_STATUS_OPTIONS: readonly {
  readonly value: PurchaseOrderStatus
  readonly label: string
}[] = [
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "ordered", label: "Ordered" },
  { value: "partially_received", label: "Partially received" },
  { value: "received", label: "Received" },
  { value: "complete", label: "Complete" },
  { value: "closed", label: "Closed" },
  { value: "void", label: "Void" },
]

export const RFQ_STATUS_OPTIONS: readonly {
  readonly value: RfqStatus
  readonly label: string
}[] = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "response_received", label: "Response received" },
  { value: "awarded", label: "Awarded" },
  { value: "declined", label: "Declined" },
  { value: "complete", label: "Complete" },
  { value: "closed", label: "Closed" },
  { value: "void", label: "Void" },
]

const CLOSED_STATUSES = new Set([
  "complete",
  "completed",
  "closed",
  "void",
  "cancelled",
  "canceled",
  "declined",
])

function normalizedStatus(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")
}

export function statusLabel(value: string): string {
  return normalizedStatus(value)
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

export function isClosedProjectOperationStatus(status: string): boolean {
  return CLOSED_STATUSES.has(normalizedStatus(status))
}

export function isPurchaseOrderStatus(
  status: string
): status is PurchaseOrderStatus {
  const normalized = normalizedStatus(status)
  return PURCHASE_ORDER_STATUS_OPTIONS.some(
    (option) => option.value === normalized
  ) && status === normalized
}

export function isRfqStatus(status: string): status is RfqStatus {
  const normalized = normalizedStatus(status)
  return (
    RFQ_STATUS_OPTIONS.some((option) => option.value === normalized) &&
    status === normalized
  )
}

export function parseProjectOperationStatusFilter(
  value: string | readonly string[] | undefined
): ProjectOperationStatusFilter {
  const selected = typeof value === "string" ? value : value?.[0]
  const normalized = selected ? normalizedStatus(selected) : "open"
  return normalized || "open"
}

export function projectOperationMatchesStatusFilter(
  status: string,
  filter: ProjectOperationStatusFilter
): boolean {
  if (filter === "all") return true
  if (filter === "open") return !isClosedProjectOperationStatus(status)
  if (filter === "closed") return isClosedProjectOperationStatus(status)
  return normalizedStatus(status) === normalizedStatus(filter)
}
