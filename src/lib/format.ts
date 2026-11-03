/**
 * Shared money and date formatting (architecture standard, section 4).
 * Amounts are integer cents everywhere except `formatDollars`. Date-only
 * values ("YYYY-MM-DD") are calendar dates and never shift with time zone.
 */

const MISSING = "—"

const currencyFormatters = new Map<number, Intl.NumberFormat>()

function currency(decimals: number): Intl.NumberFormat {
  let formatter = currencyFormatters.get(decimals)
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
    currencyFormatters.set(decimals, formatter)
  }
  return formatter
}

export type MoneyOptions = {
  /** Digits after the decimal point. Default 2. */
  readonly decimals?: 0 | 2
  /** Shown for null or non-finite amounts. Default "—". */
  readonly fallback?: string
}

/** Integer cents to "$1,234.56". */
export function formatCents(cents: number | null | undefined, options: MoneyOptions = {}): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return options.fallback ?? MISSING
  return currency(options.decimals ?? 2).format(cents / 100)
}

/** Dollars (for values already stored as dollars) to "$1,234.56". */
export function formatDollars(dollars: number | null | undefined, options: MoneyOptions = {}): string {
  if (dollars === null || dollars === undefined || !Number.isFinite(dollars)) return options.fallback ?? MISSING
  return currency(options.decimals ?? 2).format(dollars)
}

/** Dollars (number or "$1,234.50" text) to integer cents, or null. */
export function toCents(dollars: number | string | null | undefined): number | null {
  if (dollars === null || dollars === undefined) return null
  const value = typeof dollars === "number" ? dollars : Number(dollars.replace(/[$,\s]/g, ""))
  return Number.isFinite(value) ? Math.round(value * 100) : null
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/** "YYYY-MM-DD" as a local calendar date (no UTC shift), or null. */
export function parseDateOnly(value: string | null | undefined): Date | null {
  const match = value ? DATE_ONLY.exec(value) : null
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.getMonth() === Number(match[2]) - 1 ? date : null
}

export type DateStyle = "short" | "medium" | "long"

const DATE_STYLES: Readonly<Record<DateStyle, Intl.DateTimeFormatOptions>> = {
  short: { month: "short", day: "numeric" },
  medium: { month: "short", day: "numeric", year: "numeric" },
  long: { month: "long", day: "numeric", year: "numeric" },
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const dateOnly = parseDateOnly(value)
  if (dateOnly) return dateOnly
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** A date-only or ISO value as "Oct 30, 2026" (style "medium" by default). */
export function formatDate(
  value: string | Date | null | undefined,
  style: DateStyle = "medium",
  fallback = MISSING,
): string {
  const date = toDate(value)
  return date ? date.toLocaleDateString("en-US", DATE_STYLES[style]) : fallback
}

/** An ISO timestamp as "Oct 30, 2026, 9:15 PM". */
export function formatDateTime(value: string | Date | null | undefined, fallback = MISSING): string {
  const date = toDate(value)
  return date
    ? date.toLocaleString("en-US", { ...DATE_STYLES.medium, hour: "numeric", minute: "2-digit" })
    : fallback
}
