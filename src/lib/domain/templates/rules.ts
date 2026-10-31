import type { workdayExceptions } from "@/db/schema"
import { cleanText } from "@/lib/shared/guards"
import type {
  DependencyType,
  ExceptionCategory,
  ExceptionRecurrence,
  WorkdayExceptionData,
  WorkdayExceptionType,
} from "@/lib/schedule/types"

/*
 * Pure template rules: input validation and the schedule value readers the
 * template actions share. No database or network access.
 */

/** Trimmed text, or an error naming the missing field. */
export function requiredText(value: string | null, label: string): string {
  const cleaned = cleanText(value)
  if (!cleaned) throw new Error(`${label} is required.`)
  return cleaned
}

/** A non-negative finite number, or `fallback` when the value is empty. */
export function nonNegative(value: number | null, fallback: number): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new Error("Quantity, cost, and markup cannot be negative.")
  }
  return resolved
}

/** A real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** A stored dependency type; anything unknown is finish-to-start. */
export function dependencyType(value: string): DependencyType {
  return value === "SS" || value === "FF" || value === "SF" ? value : "FS"
}

const EXCEPTION_CATEGORIES: readonly ExceptionCategory[] = [
  "national_holiday",
  "state_holiday",
  "vacation_day",
  "company_holiday",
  "weather_day",
  "extra_workday",
]

/** A stored workday exception with its type, category and recurrence narrowed. */
export function exceptionData(row: typeof workdayExceptions.$inferSelect): WorkdayExceptionData {
  const type: WorkdayExceptionType = row.type === "working" ? "working" : "non_working"
  const recurrence: ExceptionRecurrence = row.recurrence === "yearly" ? "yearly" : "one_time"
  const category =
    EXCEPTION_CATEGORIES.find((candidate) => candidate === row.category) ?? "company_holiday"
  return { ...row, type, recurrence, category }
}
