export type SchedulePrintLayout = "list" | "gantt" | "calendar"
export type SchedulePrintPreset =
  | "next_7"
  | "next_14"
  | "next_30"
  | "entire_schedule"
  | "custom"

export interface SchedulePrintDateRange {
  readonly start: string
  readonly end: string
}

export interface SchedulePrintRangeItem {
  readonly startDate: string
  readonly endDate: string
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  )
}

export function addDaysToDateKey(value: string, days: number): string {
  const parsed = new Date(`${value}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

export function normalizeSchedulePrintRange(
  start: string,
  end: string
): SchedulePrintDateRange | null {
  if (!isDateKey(start) || !isDateKey(end) || start > end) return null
  return { start, end }
}

export function scheduleItemOverlapsRange(
  item: SchedulePrintRangeItem,
  range: SchedulePrintDateRange
): boolean {
  return item.startDate <= range.end && item.endDate >= range.start
}

export function filterScheduleItemsForPrint<
  Item extends SchedulePrintRangeItem,
>(
  items: readonly Item[],
  range: SchedulePrintDateRange
): readonly Item[] {
  return items.filter((item) => scheduleItemOverlapsRange(item, range))
}

export function schedulePrintBounds(
  items: readonly SchedulePrintRangeItem[],
  fallbackDate: string
): SchedulePrintDateRange {
  if (items.length === 0) return { start: fallbackDate, end: fallbackDate }

  let start = items[0].startDate
  let end = items[0].endDate
  for (const item of items.slice(1)) {
    if (item.startDate < start) start = item.startDate
    if (item.endDate > end) end = item.endDate
  }
  return { start, end }
}

export function schedulePrintPresetRange(
  preset: Exclude<SchedulePrintPreset, "custom">,
  today: string,
  items: readonly SchedulePrintRangeItem[]
): SchedulePrintDateRange {
  if (preset === "entire_schedule") {
    return schedulePrintBounds(items, today)
  }
  const days = preset === "next_7" ? 7 : preset === "next_14" ? 14 : 30
  return { start: today, end: addDaysToDateKey(today, days - 1) }
}
