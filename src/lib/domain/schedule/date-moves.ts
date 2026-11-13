/**
 * Schedule date moves, the pure part: their shape, the company's rule and
 * the size limit. store.ts writes them (persistScheduleDateUpdates,
 * runWithDateUpdates), the only code that writes a schedule item's start
 * date, workdays or end date (a test enforces it).
 *
 * Unless the company turned it off (Settings › Workflows › Schedule
 * confirmations, date-move-rules.ts), an item whose dates actually change
 * asks its assignees again: the single assignee (confirmation-machine.ts
 * dates_moved) inside the item's own date write, and every multi-assignee
 * row (assignee-response-machine.ts reset) whose answer was for other dates.
 *
 * D1 caps the queries one request may run (about 1,000): a move costs at
 * most two statements per item plus one per group of 40, and a request that
 * would move more than MAX_DATE_MOVES items is refused before anything is
 * written.
 */
import type { TaskDates } from "./rules"

/** A task's new dates; `workdays` only when the duration itself was edited. */
export type DateMove = TaskDates & { readonly workdays?: number }
export type DateMoves = ReadonlyMap<string, DateMove>

/** The company's rule (date-move-rules.ts reads it). */
export type DateMoveRules = { readonly reaskOnDateMove: boolean }

/** Most items one request may move (about 600 statements). */
export const MAX_DATE_MOVES = 300

/** Why `moves` can't be applied in one request, or null. Callers check before writing anything. */
export function dateMovesLimitError(moves: DateMoves): string | null {
  return moves.size > MAX_DATE_MOVES
    ? `This change would move ${moves.size} schedule items; Compass moves up to ${MAX_DATE_MOVES} at a time. Make the change in smaller steps.`
    : null
}
