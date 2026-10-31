import { SCHEDULE_LINK_TYPES, type ScheduleLinkType } from "@/lib/domain/schedule/statuses"
export type { ScheduleLinkType }

export function isScheduleLinkType(value: string): value is ScheduleLinkType {
  return SCHEDULE_LINK_TYPES.some((linkType) => linkType === value)
}

export function safeScheduleLinkHref(value: string): string | null {
  const href = value.trim()
  if (href.startsWith("/dashboard/")) return href
  try {
    const url = new URL(href)
    return url.protocol === "https:" ? url.toString() : null
  } catch {
    return null
  }
}
