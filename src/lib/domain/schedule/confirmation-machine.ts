/**
 * A schedule item's single-assignee commitment (issue #1329, phase 2).
 * schedule_tasks.confirmation_status changes only through these events.
 * Items assigned to several people use assignee-response-machine.ts instead.
 *
 *   staff:    any ──request────────▶ pending        (asked the assigned account)
 *             any ──await_account──▶ unavailable    (asked, but nobody has an account yet)
 *             any ──stop───────────▶ not_requested  (no answer needed)
 *             proposed ──reject_proposal──▶ pending (staff turned the new dates down)
 *
 *   assignee: any asked ──confirm / decline / propose──▶ confirmed / declined / proposed
 *
 * Staff events are what the item form, bulk assign and accepting a proposal
 * write today (staffConfirmationEvent picks one), from any state. Assignee
 * answers are compare-and-set in ./store.ts (recordConfirmationAnswer) on the
 * dates and request the assignee answered, so a late answer never lands on
 * moved dates or a new request, and a double submit lands once.
 */
import { defineMachine } from "@/lib/shared/state-machine"

import { SCHEDULE_CONFIRMATION_STATUSES, type ScheduleConfirmationStatus } from "./statuses"

/** Every state but not_requested: an answer needs a request. */
const ASKED = SCHEDULE_CONFIRMATION_STATUSES.filter(
  (status): status is Exclude<ScheduleConfirmationStatus, "not_requested"> => status !== "not_requested",
)

export const confirmationMachine = defineMachine({
  name: "schedule confirmation",
  states: SCHEDULE_CONFIRMATION_STATUSES,
  initial: "not_requested",
  // An item created (or bulk assigned) with an answer required starts asked.
  entry: ["pending", "unavailable"],
  terminal: [],
  transitions: {
    request: { from: SCHEDULE_CONFIRMATION_STATUSES, to: "pending" },
    await_account: { from: SCHEDULE_CONFIRMATION_STATUSES, to: "unavailable" },
    stop: { from: SCHEDULE_CONFIRMATION_STATUSES, to: "not_requested" },
    reject_proposal: { from: ["proposed"], to: "pending" },
    confirm: { from: ASKED, to: "confirmed" },
    decline: { from: ASKED, to: "declined" },
    propose: { from: ASKED, to: "proposed" },
  },
})

export type ConfirmationEvent = keyof typeof confirmationMachine.transitions
export type ConfirmationAnswerEvent = "confirm" | "decline" | "propose"

/** What staff's settings ask for: nothing, the assigned account, or an account first. */
export function staffConfirmationEvent(input: {
  readonly required: boolean
  readonly assignedUserId: string | null
}): "request" | "await_account" | "stop" {
  if (!input.required) return "stop"
  return input.assignedUserId ? "request" : "await_account"
}

/** The status `event` writes. */
export function confirmationStatusAfter(event: ConfirmationEvent): ScheduleConfirmationStatus {
  return confirmationMachine.transitions[event].to
}
