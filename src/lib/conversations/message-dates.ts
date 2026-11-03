import { formatDate } from "@/lib/format"

function datePart(parts: readonly Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((part) => part.type === type)?.value ?? ""
}

export function conversationDayKey(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(iso))
  return `${datePart(parts, "year")}-${datePart(parts, "month")}-${datePart(parts, "day")}`
}

export function conversationTimeLabel(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(new Date(iso))
  return `${datePart(parts, "month")} ${datePart(parts, "day")} at ${datePart(parts, "hour")}:${datePart(parts, "minute")} ${datePart(parts, "dayPeriod")}`
}

export function conversationDayLabel(day: string): string {
  // This key is a date-only calendar value; reuse the shared, zone-safe formatter.
  return formatDate(day, "long")
}
