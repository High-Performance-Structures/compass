/**
 * Lead-time warnings for selections: a choice with a long lead time has to
 * be ordered by (the selection's due date − its lead time) to arrive in
 * time. "late" once that order-by date has passed, "soon" within the
 * company's warning window (Settings > Selections). Selections already
 * ordered, installed, deferred or unavailable, choices with no lead time,
 * and selections with no due date (or one already past) are not flagged.
 * Pure: no database or network access; dates are "YYYY-MM-DD".
 */
import { formatDate } from "@/lib/format"

import type { ProjectSelectionStatus, SelectionChoiceStatus } from "./statuses"

/** Selection statuses past the point where ordering on time matters. */
const LEAD_TIME_SETTLED_STATUSES: ReadonlySet<ProjectSelectionStatus> = new Set(["ordered", "installed", "deferred", "unavailable"])

/** Choices that can no longer be picked do not set the lead time. */
const LEAD_TIME_DROPPED_CHOICES: ReadonlySet<SelectionChoiceStatus> = new Set(["unavailable", "declined"])

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})/
const DAY_MS = 86_400_000

type LeadTimeLevel = "late" | "soon"

function dayNumber(date: string): number | null {
  const match = DATE_KEY.exec(date)
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS : null
}

function dateKey(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

/** The date the selection is needed by: its own decision due date, else its Selection Phase's due date. */
export function selectionNeededByDate(decisionDueDate: string | null, phaseDueDate: string | null): string | null {
  return decisionDueDate ?? phaseDueDate
}

export type ChoiceLeadTime = {
  readonly level: LeadTimeLevel
  readonly orderByDate: string
  readonly neededByDate: string
  readonly leadTimeDays: number
  /** Days from today to the order-by date; negative once it has passed. */
  readonly daysLeft: number
}

/** One choice's warning, or null when it is on track or does not apply. */
export function choiceLeadTime(input: {
  readonly selectionStatus: ProjectSelectionStatus
  readonly neededByDate: string | null
  readonly leadTimeDays: number | null
  readonly today: string
  readonly warnDays: number
}): ChoiceLeadTime | null {
  if (LEAD_TIME_SETTLED_STATUSES.has(input.selectionStatus)) return null
  if (input.leadTimeDays === null || input.leadTimeDays <= 0 || input.neededByDate === null) return null
  const needed = dayNumber(input.neededByDate)
  const today = dayNumber(input.today)
  if (needed === null || today === null) return null
  // Past the due date itself the Due column already says so; a lead-time note adds nothing.
  if (needed < today) return null
  const orderBy = needed - input.leadTimeDays
  const daysLeft = orderBy - today
  if (daysLeft > input.warnDays) return null
  return {
    level: daysLeft < 0 ? "late" : "soon",
    orderByDate: dateKey(orderBy),
    neededByDate: dateKey(needed),
    leadTimeDays: input.leadTimeDays,
    daysLeft,
  }
}

export type LeadTimeChoiceInput = {
  readonly id: string
  readonly chosen: boolean
  readonly status: SelectionChoiceStatus
  readonly leadTimeDays: number | null
}

/**
 * The choice whose lead time governs the selection: the owner's pick when
 * there is one, else the open choice with the longest lead time.
 */
export function governingLeadTimeChoice<T extends LeadTimeChoiceInput>(choices: readonly T[]): T | null {
  const pick = choices.find((choice) => choice.chosen)
  if (pick) return pick
  let longest: T | null = null
  for (const choice of choices) {
    if (LEAD_TIME_DROPPED_CHOICES.has(choice.status) || choice.leadTimeDays === null) continue
    if (longest === null || choice.leadTimeDays > (longest.leadTimeDays ?? 0)) longest = choice
  }
  return longest
}

export type SelectionLeadTimeWarning = ChoiceLeadTime & {
  readonly selectionId: string
  readonly choiceId: string
}

/** The selection's lead-time warning (from its governing choice), or null. */
export function selectionLeadTimeWarning(input: {
  readonly selectionId: string
  readonly status: ProjectSelectionStatus
  readonly neededByDate: string | null
  readonly choices: readonly LeadTimeChoiceInput[]
  readonly today: string
  readonly warnDays: number
}): SelectionLeadTimeWarning | null {
  const choice = governingLeadTimeChoice(input.choices)
  if (!choice) return null
  const warning = choiceLeadTime({
    selectionStatus: input.status,
    neededByDate: input.neededByDate,
    leadTimeDays: choice.leadTimeDays,
    today: input.today,
    warnDays: input.warnDays,
  })
  return warning ? { ...warning, selectionId: input.selectionId, choiceId: choice.id } : null
}

/** "8-week lead time" for whole weeks, else "10-day lead time". */
export function leadTimeLabel(days: number): string {
  if (days >= 14 && days % 7 === 0) return `${days / 7}-week lead time`
  return `${days}-day lead time`
}

/** Staff wording, e.g. "8-week lead time, needed Dec 4 — order by Oct 9". */
export function staffLeadTimeNote(warning: ChoiceLeadTime): string {
  const needed = formatDate(warning.neededByDate, "short")
  const orderBy = formatDate(warning.orderByDate, "short")
  if (warning.level === "late") return `${leadTimeLabel(warning.leadTimeDays)} — won't arrive by ${needed} (order-by date was ${orderBy})`
  return `${leadTimeLabel(warning.leadTimeDays)}, needed ${needed} — order by ${orderBy}`
}

/** Owner wording: no supplier, price or lead-time details, just when to choose. */
export function ownerLeadTimeNote(warning: Pick<ChoiceLeadTime, "level" | "orderByDate">): string {
  if (warning.level === "late") return "Longer lead time: please choose as soon as you can to stay on schedule."
  return `Longer lead time: choose by ${formatDate(warning.orderByDate, "short")} to stay on schedule.`
}
