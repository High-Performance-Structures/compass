/**
 * Click rules shared by the schedule Gantt charts: one click shows an item on
 * the chart, a double-click opens it. Phones can't double-tap reliably, so a
 * touch tap on the item that is already highlighted opens it instead.
 */

export type ScheduleItemClickAction = "highlight" | "open"

export function scheduleItemClickAction(
  pointerType: string,
  alreadyHighlighted: boolean
): ScheduleItemClickAction {
  return pointerType === "touch" && alreadyHighlighted ? "open" : "highlight"
}
