/*
 * Status helpers for project operations. Each record type's own status list
 * (labels, order, what counts as open, filter buttons) lives in the company
 * status settings: src/lib/domain/record-statuses (registry.ts for the code
 * defaults).
 */
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
