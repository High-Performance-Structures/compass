/**
 * Missing daily log reminders: who is reminded, when, and on which days.
 * Pure rules shared by the scheduled job, Settings and tests.
 */

export const DAILY_LOG_REMINDER_AUDIENCES = ["all_staff", "field_staff", "scheduled_staff"] as const

export type DailyLogReminderAudience = (typeof DAILY_LOG_REMINDER_AUDIENCES)[number]

export const DAILY_LOG_REMINDER_AUDIENCE_LABELS: { readonly [K in DailyLogReminderAudience]: string } = {
  all_staff: "All internal staff",
  field_staff: "Field staff only",
  scheduled_staff: "Staff scheduled on a job that day",
}

/** Day numbers as JavaScript counts them: 0 is Sunday. */
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

export type DailyLogReminderRules = {
  readonly enabled: boolean
  readonly audience: DailyLogReminderAudience
  /** HH:MM, company time. */
  readonly officeTime: string
  readonly fieldTime: string
  readonly workDays: readonly number[]
  readonly skipAbsences: boolean
  readonly adminMissingList: boolean
  readonly staffPickOwnTime: boolean
}

const FIELD_ROLES: ReadonlySet<string> = new Set(["field_superintendent", "field_crew", "field"])

export function isFieldRole(role: string): boolean {
  return FIELD_ROLES.has(role)
}

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/** The time a person is reminded: their own when allowed and set, else their group's. */
export function reminderTimeFor(
  rules: Pick<DailyLogReminderRules, "officeTime" | "fieldTime" | "staffPickOwnTime">,
  role: string,
  personalTime: string | null,
): string {
  if (rules.staffPickOwnTime && personalTime && TIME_PATTERN.test(personalTime)) return personalTime
  return isFieldRole(role) ? rules.fieldTime : rules.officeTime
}

/** Weekday (0 = Sunday) of a YYYY-MM-DD date. */
export function weekdayOf(date: string): number {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).getUTCDay()
}

export function isWorkDay(date: string, workDays: readonly number[]): boolean {
  return workDays.includes(weekdayOf(date))
}

/** "4:30 PM" for "16:30". */
export function clockLabel(time: string): string {
  const [hours, minutes] = time.split(":").map(Number)
  if (hours === undefined || minutes === undefined || Number.isNaN(hours) || Number.isNaN(minutes)) return time
  const suffix = hours < 12 ? "AM" : "PM"
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`
}

/** The reminder's message. */
export function reminderBody(projectLabel: string | null, scheduled: boolean): string {
  if (!projectLabel) return "You haven't written a daily log today. Tap to write one for the job or workspace you worked in."
  return scheduled
    ? `You haven't written a daily log today. Tap to log on ${projectLabel} (you were scheduled) or another job or workspace.`
    : `You haven't written a daily log today. Tap to log on ${projectLabel} or another job or workspace.`
}
