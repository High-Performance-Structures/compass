import type { WorkCalendarEntryKind } from "@/lib/domain/work-calendar/types"

export type WorkCalendarFilter = WorkCalendarEntryKind | "all"

/** A source link without a kind must still reveal its record. */
export function workCalendarFilter(value: string | readonly string[] | undefined, linkedItemId: string | null = null): WorkCalendarFilter {
  const selected = typeof value === "string" ? value : value?.[0]
  switch (selected) {
    case "all": case "schedule": case "event": case "task": case "rfi": case "purchase_order": return selected
    default: return linkedItemId ? "all" : "event"
  }
}

/** Keep explicit All selections across navigation and refreshes. */
export function workCalendarFilterHref(query: { toString(): string }, kind: WorkCalendarFilter): string {
  const params = new URLSearchParams(query.toString())
  params.set("kind", kind)
  params.delete("item")
  return `/dashboard/schedule?${params.toString()}`
}
