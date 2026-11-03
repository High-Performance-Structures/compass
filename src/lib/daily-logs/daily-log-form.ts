/**
 * Daily log form rules shared by the browser, Field Mode on phones and the
 * server: which fields are required, and the cost code + time lines.
 *
 * Kept free of path aliases so the native Field Mode bundle can import it.
 */

/** Fields a company may make required, in the order the form shows them. */
export const DAILY_LOG_OPTIONAL_FIELDS = [
  "crewPresent",
  "materialsUsed",
  "issues",
  "safetyIncidents",
  "visitorLog",
  "notes",
] as const

export type DailyLogOptionalField = (typeof DAILY_LOG_OPTIONAL_FIELDS)[number]

export const DAILY_LOG_FIELD_LABELS: { readonly [K in DailyLogOptionalField]: string } = {
  crewPresent: "Who was on site",
  materialsUsed: "Deliveries and materials",
  issues: "Issues or delays",
  safetyIncidents: "Safety",
  visitorLog: "Visitors",
  notes: "Notes / next steps",
}

/** What a company requires on every daily log, beyond the date and work completed. */
export type DailyLogRequirements = {
  /** At least one cost code with its time. */
  readonly requireCostCodeTime: boolean
  readonly requiredFields: readonly DailyLogOptionalField[]
}

export const DEFAULT_DAILY_LOG_REQUIREMENTS: DailyLogRequirements = {
  requireCostCodeTime: true,
  requiredFields: [],
}

export type DailyLogCostCodeOption = {
  readonly code: string
  /** The name without the code, e.g. "Mobilization". */
  readonly name: string
  /** What the picker shows, e.g. "01 71 13 Mobilization". */
  readonly label: string
  /** e.g. "On this job's budget" or "All cost codes"; empty when ungrouped. */
  readonly group: string
}

/** One cost code worked on, as typed into the form (hours still text). */
export type DailyLogWorkLineDraft = {
  readonly costCode: string
  readonly hours: string
  readonly description: string
  /** The to-do these hours went to, when the line came from ticking one. */
  readonly todoId?: string
}

export type DailyLogWorkLine = {
  readonly costCode: string
  readonly hours: number
  readonly description: string
  readonly todoId: string | null
}

export type DailyLogFormValues = {
  readonly logDate: string
  readonly workCompleted: string
  readonly workLines: readonly DailyLogWorkLineDraft[]
} & { readonly [K in DailyLogOptionalField]: string }

/** Where an error belongs: a field, a work line's part, or the lines as a whole. */
type DailyLogFormErrorKey =
  | "logDate"
  | "workCompleted"
  | "workLines"
  | DailyLogOptionalField
  | `workLines.${number}.${"costCode" | "hours"}`

export type DailyLogFormError = { readonly key: DailyLogFormErrorKey; readonly message: string }

/** Today on this device's calendar (not UTC, which runs a day ahead in the evening). */
export function localDateInputValue(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}

export function emptyWorkLine(): DailyLogWorkLineDraft {
  return { costCode: "", hours: "", description: "" }
}

/** A line the person hasn't started (all blank) is ignored rather than flagged. */
function isBlankLine(line: DailyLogWorkLineDraft): boolean {
  return !line.costCode.trim() && !line.hours.trim() && !line.description.trim()
}

/** Time to the quarter hour, or an error message. */
export function parseWorkLineHours(value: string): { readonly ok: true; readonly hours: number } | { readonly ok: false; readonly error: string } {
  const clean = value.trim()
  if (!clean) return { ok: false, error: "Add the time." }
  const hours = Number(clean)
  if (!Number.isFinite(hours) || hours <= 0) return { ok: false, error: "Enter hours greater than zero." }
  if (hours > 24) return { ok: false, error: "One line can't be more than 24 hours." }
  return { ok: true, hours: Math.round(hours * 4) / 4 }
}

export function isRequired(requirements: DailyLogRequirements, field: DailyLogOptionalField): boolean {
  return requirements.requiredFields.includes(field)
}

/**
 * Every problem with the form, in the order the fields appear, so the first
 * one can be focused. Also returns the cleaned work lines.
 */
export function validateDailyLogForm(
  values: DailyLogFormValues,
  requirements: DailyLogRequirements,
  costCodes: readonly Pick<DailyLogCostCodeOption, "code">[],
): { readonly errors: readonly DailyLogFormError[]; readonly workLines: readonly DailyLogWorkLine[] } {
  const errors: DailyLogFormError[] = []
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.logDate.trim())) errors.push({ key: "logDate", message: "Choose the date." })

  const knownCodes = new Set(costCodes.map((option) => option.code))
  const workLines: DailyLogWorkLine[] = []
  values.workLines.forEach((line, index) => {
    if (isBlankLine(line)) return
    const costCode = line.costCode.trim()
    if (!costCode) errors.push({ key: `workLines.${index}.costCode`, message: "Choose a cost code." })
    else if (knownCodes.size > 0 && !knownCodes.has(costCode)) errors.push({ key: `workLines.${index}.costCode`, message: "That cost code isn't on the list." })
    const hours = parseWorkLineHours(line.hours)
    if (!hours.ok) errors.push({ key: `workLines.${index}.hours`, message: hours.error })
    if (costCode && hours.ok) {
      workLines.push({ costCode, hours: hours.hours, description: line.description.trim(), todoId: line.todoId?.trim() || null })
    }
  })
  if (requirements.requireCostCodeTime && values.workLines.every(isBlankLine)) {
    errors.push({ key: "workLines", message: "Add at least one cost code and its time." })
  }

  if (!values.workCompleted.trim()) errors.push({ key: "workCompleted", message: "Describe the work completed." })
  for (const field of DAILY_LOG_OPTIONAL_FIELDS) {
    if (isRequired(requirements, field) && !values[field].trim()) {
      errors.push({ key: field, message: `${DAILY_LOG_FIELD_LABELS[field]} is required.` })
    }
  }
  return { errors, workLines }
}

/** Total of the lines' hours, or null when there are none. */
export function totalWorkLineHours(lines: readonly Pick<DailyLogWorkLine, "hours">[]): number | null {
  if (lines.length === 0) return null
  return lines.reduce((sum, line) => sum + line.hours, 0)
}

/** "1 required field is missing" style summary for the top of the form. */
export function missingFieldsSummary(errors: readonly unknown[]): string {
  if (errors.length === 0) return ""
  return errors.length === 1
    ? "1 required item needs attention before saving."
    : `${errors.length} required items need attention before saving.`
}
