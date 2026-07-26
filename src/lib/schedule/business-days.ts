import {
  addDays,
  isWeekend,
  parseISO,
  format,
} from "date-fns"
import type { WorkdayExceptionData } from "./types"

function isExceptionActive(
  date: Date,
  exception: WorkdayExceptionData
): boolean {
  if (exception.recurrence === "yearly") {
    const dateKey = format(date, "MM-dd")
    const startKey = exception.startDate.slice(5)
    const endKey = exception.endDate.slice(5)

    if (startKey <= endKey) {
      return dateKey >= startKey && dateKey <= endKey
    }

    // A yearly range such as Dec 24–Jan 2 crosses the year boundary.
    return dateKey >= startKey || dateKey <= endKey
  }

  const dateKey = format(date, "yyyy-MM-dd")
  return dateKey >= exception.startDate && dateKey <= exception.endDate
}

export function isNonWorkday(
  date: Date,
  exceptions: readonly WorkdayExceptionData[] = []
): boolean {
  const activeExceptions = exceptions.filter((exception) =>
    isExceptionActive(date, exception)
  )

  // An explicit working override wins so a weekend or a broader shutdown
  // range can be opened for work without changing the base calendar.
  if (activeExceptions.some((exception) => exception.type === "working")) {
    return false
  }

  if (activeExceptions.some((exception) => exception.type === "non_working")) {
    return true
  }

  return isWeekend(date)
}

export function calculateEndDate(
  startDate: string,
  workdays: number,
  exceptions: readonly WorkdayExceptionData[] = []
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

export function countBusinessDays(
  startDate: string,
  endDate: string,
  exceptions: readonly WorkdayExceptionData[] = []
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
  exceptions: readonly WorkdayExceptionData[] = []
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

export function calculateStartDate(
  endDate: string,
  workdays: number,
  exceptions: readonly WorkdayExceptionData[] = []
): string {
  if (workdays <= 1) return endDate
  return addBusinessDays(endDate, -(workdays - 1), exceptions)
}
