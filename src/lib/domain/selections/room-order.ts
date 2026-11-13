/**
 * The order of a job's rooms, as staff set it on the Selections page
 * (room-edits.ts): each room row's sort order. Every list of selections
 * (staff workspace, owner board, Selections sheet, Selection Phases, prints)
 * shows rooms in this order, then by name. A room with no row of its own
 * (only selections name it) goes last.
 */
import { sql, type SQL } from "drizzle-orm"

export const ROOMLESS_ORDER = 1_000_000

/** A selection row's room position, for ORDER BY on project_finish_selections. */
export function roomRankSql(): SQL<number> {
  return sql<number>`COALESCE((SELECT MIN(room.sort_order) FROM project_finish_selection_rooms AS room WHERE room.project_id = project_finish_selections.project_id AND room.room_name = project_finish_selections.room_name AND room.active = 1), ${ROOMLESS_ORDER})`
}
