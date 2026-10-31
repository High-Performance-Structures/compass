/**
 * Recurring duties (bank reconciliations, sales tax, vendor statements):
 * which period is owed and how far behind a duty is. Periods are months
 * ("2026-05"), quarters ("2026-Q2") or years ("2026"). A period's work is due
 * on `dueDay` of the month after the period ends.
 */

export type DutyCadence = "monthly" | "quarterly" | "yearly"

export type DutyStatus =
  | { readonly kind: "not_started" }
  | { readonly kind: "current"; readonly nextPeriod: string; readonly nextDue: string }
  | { readonly kind: "due_soon"; readonly nextPeriod: string; readonly nextDue: string }
  | { readonly kind: "behind"; readonly owed: readonly string[]; readonly oldestDue: string }

/** Months since year 0, to step through periods without Date math. */
function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1)
}

function fromIndex(index: number): { readonly year: number; readonly month: number } {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

/** The last month (index) a period covers. */
export function periodEndIndex(period: string): number | null {
  let m = period.match(/^(\d{4})-(\d{2})$/)
  if (m) return monthIndex(Number(m[1]), Number(m[2]))
  m = period.match(/^(\d{4})-Q([1-4])$/)
  if (m) return monthIndex(Number(m[1]), Number(m[2]) * 3)
  m = period.match(/^(\d{4})$/)
  if (m) return monthIndex(Number(m[1]), 12)
  return null
}

function periodFromEndIndex(endIndex: number, cadence: DutyCadence): string {
  const { year, month } = fromIndex(endIndex)
  if (cadence === "monthly") return `${year}-${String(month).padStart(2, "0")}`
  if (cadence === "quarterly") return `${year}-Q${Math.ceil(month / 3)}`
  return String(year)
}

function step(cadence: DutyCadence): number {
  return cadence === "monthly" ? 1 : cadence === "quarterly" ? 3 : 12
}

/** The period after this one. */
export function nextPeriod(period: string, cadence: DutyCadence): string | null {
  const end = periodEndIndex(period)
  return end === null ? null : periodFromEndIndex(end + step(cadence), cadence)
}

/** YYYY-MM-DD the period's work is due: `dueDay` of the following month (clamped to its length). */
export function periodDueDate(period: string, dueDay: number): string | null {
  const end = periodEndIndex(period)
  if (end === null) return null
  const { year, month } = fromIndex(end + 1)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const day = Math.min(Math.max(1, dueDay), lastDay)
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/**
 * Where a duty stands today. `lastDone` is the latest completed period, or
 * null when nobody has marked one yet. "Due soon" is within `soonDays`.
 */
export function dutyStatus(input: {
  readonly cadence: DutyCadence
  readonly dueDay: number
  readonly lastDone: string | null
  readonly today: string
  readonly soonDays?: number
}): DutyStatus {
  if (!input.lastDone) return { kind: "not_started" }
  const owed: string[] = []
  let period = nextPeriod(input.lastDone, input.cadence)
  // Bounded walk: at most ten years of periods.
  for (let guard = 0; period && guard < 120; guard += 1) {
    const due = periodDueDate(period, input.dueDay)
    if (!due || due >= input.today) break
    owed.push(period)
    period = nextPeriod(period, input.cadence)
  }
  const first = owed[0]
  if (first) {
    return { kind: "behind", owed, oldestDue: periodDueDate(first, input.dueDay) ?? input.today }
  }
  const upcoming = nextPeriod(input.lastDone, input.cadence) ?? input.lastDone
  const nextDue = periodDueDate(upcoming, input.dueDay) ?? input.today
  const daysAway = (Date.parse(`${nextDue}T00:00:00Z`) - Date.parse(`${input.today}T00:00:00Z`)) / 86_400_000
  return daysAway <= (input.soonDays ?? 7)
    ? { kind: "due_soon", nextPeriod: upcoming, nextDue }
    : { kind: "current", nextPeriod: upcoming, nextDue }
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const

/** "2026-05" → "May 2026", "2026-Q2" → "Q2 2026". */
export function periodLabel(period: string): string {
  const month = period.match(/^(\d{4})-(\d{2})$/)
  if (month) return `${MONTHS[Number(month[2]) - 1] ?? month[2]} ${month[1]}`
  const quarter = period.match(/^(\d{4})-Q([1-4])$/)
  if (quarter) return `Q${quarter[2]} ${quarter[1]}`
  return period
}

/** "5 months behind", "1 quarter behind". */
export function behindLabel(count: number, cadence: DutyCadence): string {
  const unit = cadence === "monthly" ? "month" : cadence === "quarterly" ? "quarter" : "year"
  return `${count} ${unit}${count === 1 ? "" : "s"} behind`
}
