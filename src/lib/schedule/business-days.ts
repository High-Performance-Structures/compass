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

export type WorkdaysFromEndDateResult =
  | {
      readonly success: true
      readonly workdays: number
      /** The end date used: the chosen one, or the workday before it. */
      readonly endDate: string
      /** True when the chosen end fell on a non-workday and was moved back. */
      readonly snapped: boolean
    }
  | { readonly success: false; readonly error: string }

/**
 * The duration that makes an item starting on startDate end on endDate, using
 * the same workday calendar as calculateEndDate. An end on a non-workday moves
 * back to the previous workday; endDate is always what calculateEndDate gives
 * for the returned workdays.
 */
export function workdaysFromEndDate(
  startDate: string,
  endDate: string,
  exceptions: readonly WorkdayExceptionData[] = []
): WorkdaysFromEndDateResult {
  if (endDate < startDate) {
    return { success: false, error: "The end date can't be before the start date." }
  }
  let current = parseISO(endDate)
  const start = parseISO(startDate)
  while (current > start && isNonWorkday(current, exceptions)) {
    current = addDays(current, -1)
  }
  const snappedEnd = format(current, "yyyy-MM-dd")
  const workdays = Math.max(1, countBusinessDays(startDate, snappedEnd, exceptions))
  // A start on a non-workday counts forward, so the end can land after the
  // chosen date (e.g. Saturday to Sunday becomes one workday ending Monday).
  const resultEnd = calculateEndDate(startDate, workdays, exceptions)
  return {
    success: true,
    workdays,
    endDate: resultEnd,
    snapped: resultEnd !== endDate,
  }
}
