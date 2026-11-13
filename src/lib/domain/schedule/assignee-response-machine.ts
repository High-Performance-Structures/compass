/**
 * A schedule assignee's answer to their dates (issue #1329, phase 2).
 * schedule_task_assignees.response_status changes only through these
 * events; date_response_status and duration_response_status are written
 * with it, worked out from the same event (assigneeResponseParts).
 *
 *   any ──confirm──▶ confirmed
 *   any ──decline──▶ declined     (the assignee answers, or changes their answer)
 *   any ──propose──▶ proposed
 *   any ──reset────▶ pending      (staff changed the item's dates or terms)
 *
 * Every event leaves from every state, as today: an assignee may change their
 * answer and staff may reschedule at any time. The race guard is the version
 * the assignee answered (see recordAssigneeResponse in ./store.ts): an answer
 * lands only while the item's dates and the row's assigned_at (set again by
 * every reset) are still the ones it was given against, so a late answer
 * never overwrites a reset and two submits of one answer land once.
 *
 * Rows start at "pending" (the 0140 default). The only code that created them,
 * setScheduleTaskAssignees, was removed as unused in #1051; existing rows
 * still take answers and resets.
 */
import { defineMachine } from "@/lib/shared/state-machine"

import { SCHEDULE_ASSIGNEE_RESPONSES, type ScheduleAssigneeResponseStatus } from "./statuses"

export const assigneeResponseMachine = defineMachine({
  name: "schedule assignee response",
  states: SCHEDULE_ASSIGNEE_RESPONSES,
  initial: "pending",
  terminal: [],
  transitions: {
    // The assignee can make the dates as given.
    confirm: { from: SCHEDULE_ASSIGNEE_RESPONSES, to: "confirmed" },
    // The assignee cannot commit to them.
    decline: { from: SCHEDULE_ASSIGNEE_RESPONSES, to: "declined" },
    // The assignee asked for another start date and/or duration.
    propose: { from: SCHEDULE_ASSIGNEE_RESPONSES, to: "proposed" },
    // Staff moved the item (or re-asked); every answer is asked again.
    reset: { from: SCHEDULE_ASSIGNEE_RESPONSES, to: "pending" },
  },
})

export type AssigneeResponseEvent = keyof typeof assigneeResponseMachine.transitions
export type AssigneeAnswerEvent = Exclude<AssigneeResponseEvent, "reset">

/** The three status columns an event writes together. */
export type AssigneeResponseColumns = {
  readonly responseStatus: ScheduleAssigneeResponseStatus
  readonly dateResponseStatus: ScheduleAssigneeResponseStatus
  readonly durationResponseStatus: ScheduleAssigneeResponseStatus
}

/**
 * The columns for `event`. A proposal marks only the parts it changes
 * (a new start date, a new duration); the other part stays "pending".
 */
export function assigneeResponseParts(
  event: AssigneeResponseEvent,
  proposal: { readonly date: boolean; readonly duration: boolean } = { date: false, duration: false },
): AssigneeResponseColumns {
  const to = assigneeResponseMachine.transitions[event].to
  if (event !== "propose") return { responseStatus: to, dateResponseStatus: to, durationResponseStatus: to }
  const pending = assigneeResponseMachine.transitions.reset.to
  return {
    responseStatus: to,
    dateResponseStatus: proposal.date ? to : pending,
    durationResponseStatus: proposal.duration ? to : pending,
  }
}

/** The event for an answer as the partner schedule sends it. */
export function answerEvent(response: "confirmed" | "declined" | "proposed"): AssigneeAnswerEvent {
  if (response === "confirmed") return "confirm"
  if (response === "declined") return "decline"
  return "propose"
}
