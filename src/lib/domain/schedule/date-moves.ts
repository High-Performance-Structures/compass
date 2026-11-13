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
 * D1 caps the queries one request may run at 1,000. Moves are written a
 * group of DATE_MOVE_GROUP items at a time in three set-based statements
 * (linked to-dos, dates with the single-assignee re-ask, multi-assignee
 * re-ask), so a request's cost is counted in statements and refused before
 * anything is written only when it would pass MAX_DATE_MOVE_STATEMENTS,
 * leaving room for the action's other queries.
 */
import type { TaskDates } from "./rules"

/** A task's new dates; `workdays` only when the duration itself was edited. */
export type DateMove = TaskDates & { readonly workdays?: number }
export type DateMoves = ReadonlyMap<string, DateMove>

/** The company's rule (date-move-rules.ts reads it). */
export type DateMoveRules = { readonly reaskOnDateMove: boolean }

/** Items written together; each group costs STATEMENTS_PER_GROUP statements. */
export const DATE_MOVE_GROUP = 100
const STATEMENTS_PER_GROUP = 3
/** Statements one request may spend on date moves, under D1's 1,000 with headroom. */
export const MAX_DATE_MOVE_STATEMENTS = 900

/** The statements writing `moves` costs, plus `extra` the same request writes with them. */
export function dateMoveStatementCount(moves: DateMoves, extra = 0): number {
  return extra + Math.ceil(moves.size / DATE_MOVE_GROUP) * STATEMENTS_PER_GROUP
}

/** Why `moves` can't be applied in one request, or null. Callers check before writing anything. */
export function dateMovesLimitError(moves: DateMoves, extra = 0): string | null {
  const statements = dateMoveStatementCount(moves, extra)
  return statements > MAX_DATE_MOVE_STATEMENTS
    ? `This change would move ${moves.size} schedule items, more than Compass can save at once (${statements} of ${MAX_DATE_MOVE_STATEMENTS} database writes). Make the change in smaller steps.`
    : null
}
