import { isValidDateKey } from "@/lib/work-calendar"

export const WORK_CALENDAR_RECURRENCES = [
  "none",
  "daily",
  "weekly",
  "monthly",
  "yearly",
] as const

export type WorkCalendarRecurrence =
  (typeof WORK_CALENDAR_RECURRENCES)[number]

export function isWorkCalendarRecurrence(
  value: string
): value is WorkCalendarRecurrence {
  return WORK_CALENDAR_RECURRENCES.some(
    (candidate) => candidate === value
  )
}

export type WorkCalendarOccurrence = {
  readonly startDate: string
  readonly endDate: string
}

function dateParts(value: string): {
  readonly year: number
  readonly month: number
  readonly day: number
} {
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number)
  return { year, month, day }
}

function dateKey(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day, 12))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date.toISOString().slice(0, 10)
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function dayDistance(start: string, end: string): number {
  const startTime = new Date(`${start}T12:00:00Z`).getTime()
  const endTime = new Date(`${end}T12:00:00Z`).getTime()
  return Math.round((endTime - startTime) / 86_400_000)
}

function occurrenceStart(
  initialStart: string,
  recurrence: WorkCalendarRecurrence,
  index: number
): string | null {
  if (recurrence === "none") return index === 0 ? initialStart : null
  if (recurrence === "daily") return addDays(initialStart, index)
  if (recurrence === "weekly") return addDays(initialStart, index * 7)

  const initial = dateParts(initialStart)
  if (recurrence === "monthly") {
    const absoluteMonth = initial.month - 1 + index
    const year = initial.year + Math.floor(absoluteMonth / 12)
    const month = (absoluteMonth % 12) + 1
    return dateKey(year, month, initial.day)
  }

  return dateKey(initial.year + index, initial.month, initial.day)
}

export function expandWorkCalendarRecurrence(input: {
  readonly startDate: string
  readonly endDate: string
  readonly recurrence: WorkCalendarRecurrence
  readonly recurrenceUntil: string | null
  readonly windowStart: string
  readonly windowEnd: string
}): readonly WorkCalendarOccurrence[] {
  if (
    !isValidDateKey(input.startDate) ||
    !isValidDateKey(input.endDate) ||
    !isValidDateKey(input.windowStart) ||
    !isValidDateKey(input.windowEnd)
  ) {
    return []
  }

  const recurrenceUntil =
    input.recurrence === "none"
      ? input.startDate
      : input.recurrenceUntil
  if (!recurrenceUntil || !isValidDateKey(recurrenceUntil)) return []

  const durationDays = Math.max(0, dayDistance(input.startDate, input.endDate))
  const occurrences: WorkCalendarOccurrence[] = []
  const maxIterations = input.recurrence === "daily" ? 3_700 : 600

  for (let index = 0; index < maxIterations; index += 1) {
    const startDate = occurrenceStart(
      input.startDate,
      input.recurrence,
      index
    )
    if (startDate === null) continue
    if (startDate > recurrenceUntil || startDate > input.windowEnd) break

    const endDate = addDays(startDate, durationDays)
    if (endDate >= input.windowStart) {
      occurrences.push({ startDate, endDate })
    }
  }

  return occurrences
}
