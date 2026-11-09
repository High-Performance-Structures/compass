/**
 * Selection rounds on a job: each company round's due date from the job's
 * schedule, and its progress (how many selections have an owner's pick,
 * over/under the allowance, ready to finalize). Pure.
 */
import type { SelectionRound } from "@/lib/feature-settings/selection-settings"

export type RoundScheduleItem = { readonly title: string; readonly startDate: string }

/**
 * The round is due `bufferDays` before the first schedule item (by start
 * date) whose title contains the round's schedule item text, ignoring case.
 * Null when the round names no item or the job's schedule has no match.
 */
export function roundDueDate(round: Pick<SelectionRound, "scheduleItem" | "bufferDays">, schedule: readonly RoundScheduleItem[]): string | null {
  const wanted = round.scheduleItem.trim().toLocaleLowerCase()
  if (!wanted) return null
  const match = schedule
    .filter((item) => item.title.toLocaleLowerCase().includes(wanted) && /^\d{4}-\d{2}-\d{2}/.test(item.startDate))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0]
  if (!match) return null
  const start = Date.UTC(Number(match.startDate.slice(0, 4)), Number(match.startDate.slice(5, 7)) - 1, Number(match.startDate.slice(8, 10)))
  return new Date(start - round.bufferDays * 86_400_000).toISOString().slice(0, 10)
}

export type RoundSelection = {
  readonly roundKey: string | null
  readonly hasPick: boolean
  /** The pick's owner price minus the allowance; null when either is missing. */
  readonly deltaCents: number | null
}

export type RoundProgress = {
  readonly total: number
  readonly chosen: number
  /** Over (+) or under (-) the allowance across picks that have both numbers. */
  readonly deltaCents: number
  /** Every selection in the round has an owner's pick (and the round isn't empty). */
  readonly ready: boolean
}

export function roundProgress(roundKey: string, selections: readonly RoundSelection[]): RoundProgress {
  const inRound = selections.filter((selection) => selection.roundKey === roundKey)
  const chosen = inRound.filter((selection) => selection.hasPick).length
  const deltaCents = inRound.reduce((total, selection) => total + (selection.hasPick && selection.deltaCents !== null ? selection.deltaCents : 0), 0)
  return { total: inRound.length, chosen, deltaCents, ready: inRound.length > 0 && chosen === inRound.length }
}
