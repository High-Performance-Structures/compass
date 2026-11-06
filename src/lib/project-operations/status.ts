/*
 * Status helpers for project operations. Each record type's own status list
 * (labels, order, what counts as open) lives in the company status settings:
 * src/lib/domain/record-statuses (registry.ts for the code defaults).
 */
export type ProjectOperationStatusFilter = "open" | "closed" | "all" | string

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

export function purchaseOrderStatusAfterEmail(status: string): string {
  const normalized = normalizedStatus(status)
  return normalized === "draft" || normalized === "approved" ? "sent" : status
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
