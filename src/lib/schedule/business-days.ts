import { addDays, isWeekend, parseISO, format, isWithinInterval } from "date-fns"
import type { WorkdayExceptionData } from "./types"

function matchingExceptions(
  date: Date,
  exceptions: WorkdayExceptionData[]
): WorkdayExceptionData[] {
  return exceptions.filter((ex) => {
    const start = parseISO(ex.startDate)
    const end = parseISO(ex.endDate)
    return isWithinInterval(date, { start, end })
  })
}

function isNonWorkday(
  date: Date,
  exceptions: WorkdayExceptionData[] = []
): boolean {
  const matches = matchingExceptions(date, exceptions)
  if (matches.some((exception) => exception.type === "working")) return false
  if (matches.some((exception) => exception.type !== "working")) return true
  return isWeekend(date)
}

export function calculateEndDate(
  startDate: string,
  workdays: number,
  exceptions: WorkdayExceptionData[] = []
): string {
  if (workdays <= 0) return startDate

  let current = parseISO(startDate)
  let remaining = workdays

  if (!isNonWorkday(current, exceptions)) {
    remaining--
  }

  while (remaining > 0) {
    current = addDays(current, 1)
    if (!isNonWorkday(current, exceptions)) {
      remaining--
    }
  }

  return format(current, "yyyy-MM-dd")
}

export function calculateStartDate(
  endDate: string,
  workdays: number,
  exceptions: WorkdayExceptionData[] = []
): string {
  if (workdays <= 0) return endDate

  let current = parseISO(endDate)
  let remaining = workdays

  if (!isNonWorkday(current, exceptions)) {
    remaining--
  }

  while (remaining > 0) {
    current = addDays(current, -1)
    if (!isNonWorkday(current, exceptions)) {
      remaining--
    }
  }

  return format(current, "yyyy-MM-dd")
}

export function countBusinessDays(
  startDate: string,
  endDate: string,
  exceptions: WorkdayExceptionData[] = []
): number {
  let current = parseISO(startDate)
  const end = parseISO(endDate)
  let count = 0

  while (current <= end) {
    if (!isNonWorkday(current, exceptions)) {
      count++
    }
    current = addDays(current, 1)
  }

  return count
}

export function addBusinessDays(
  date: string,
  days: number,
  exceptions: WorkdayExceptionData[] = []
): string {
  let current = parseISO(date)
  let remaining = Math.abs(days)
  const direction = days >= 0 ? 1 : -1

  while (remaining > 0) {
    current = addDays(current, direction)
    if (!isNonWorkday(current, exceptions)) {
      remaining--
    }
  }

  return format(current, "yyyy-MM-dd")
}

export function businessDayOffset(
  fromDate: string,
  toDate: string,
  exceptions: WorkdayExceptionData[] = []
): number {
  if (fromDate === toDate) return 0

  let current = parseISO(fromDate)
  const target = parseISO(toDate)
  const direction = target > current ? 1 : -1
  let offset = 0

  while (direction > 0 ? current < target : current > target) {
    current = addDays(current, direction)
    if (!isNonWorkday(current, exceptions)) {
      offset += direction
    }
  }

  return offset
}
