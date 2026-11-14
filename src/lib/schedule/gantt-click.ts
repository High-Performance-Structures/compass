/**
 * Click rules shared by the schedule Gantt charts: one click shows an item on
 * the chart, a double-click opens it. Phones and pens can't double-tap
 * reliably, so a touch or pen tap on the item that is already highlighted
 * opens it instead.
 */

export type ScheduleItemClickAction = "highlight" | "open"

export function scheduleItemClickAction(
  pointerType: string,
  alreadyHighlighted: boolean
): ScheduleItemClickAction {
  const tap = pointerType === "touch" || pointerType === "pen"
  return tap && alreadyHighlighted ? "open" : "highlight"
}
