/**
 * What Compass itself may do to a finish selection's status, and the
 * lifecycles of round signatures and owner requests (issue #1329, phase 2).
 * Pure: no database access.
 *
 * Staff pick any selection status by hand (the status picker and the edit
 * form); nothing here limits that. Those writes are compare-and-set on the
 * status the person saw (store.ts setSelectionStatusByStaff). This machine
 * covers only the moves Compass makes as a side effect of something else:
 *
 *   publish        needed | proposed ──▶ owner_review        (released to the owner)
 *   owner_approve  needed | proposed | owner_review ──▶ approved   (owner approved a published decision)
 *   owner_sign     needed | proposed | owner_review | pricing | rfq_sent | unavailable ──▶ approved
 *                                                             (the owner e-signed a Selection Phase)
 *   order          needed … rfq_sent ──▶ ordered             (a linked purchase order went out)
 *   install        needed … ordered ──▶ installed            (a daily log ticked it installed)
 *   reopen         any ──▶ owner_review                      (staff changed a signed pick, or a
 *                                                             re-imported approved row changed)
 *
 * An event never moves a selection that is not in one of its source states,
 * so automation never pulls an ordered, installed, deferred or unavailable
 * selection back (only `reopen`, which undoes an owner approval, does).
 * Approvals still record the owner's approval when the status stays.
 */
import { defineMachine, nextState } from "@/lib/shared/state-machine"
import { isListValue } from "@/lib/shared/statuses"

import {
  PROJECT_SELECTION_STATUSES,
  SELECTION_REQUEST_STATUSES,
  SELECTION_ROUND_SIGNATURE_STATUSES,
  type ProjectSelectionStatus,
  type SelectionRoundSignatureStatus,
} from "./statuses"

const BEFORE_ORDERED = ["needed", "proposed", "owner_review", "approved", "pricing", "rfq_sent"] as const

export const selectionStatusAutomation = defineMachine({
  name: "selection status automation",
  states: PROJECT_SELECTION_STATUSES,
  initial: "needed",
  // Staff create a selection in any status, and set any status by hand.
  entry: PROJECT_SELECTION_STATUSES,
  terminal: [],
  transitions: {
    publish: { from: ["needed", "proposed"], to: "owner_review" },
    // Pricing, RFQ sent, Deferred and Unavailable are progress staff set on
    // purpose; a click approval leaves them (the owner_sign list predates it).
    owner_approve: { from: ["needed", "proposed", "owner_review"], to: "approved" },
    owner_sign: { from: ["needed", "proposed", "owner_review", "pricing", "rfq_sent", "unavailable"], to: "approved" },
    order: { from: BEFORE_ORDERED, to: "ordered" },
    install: { from: [...BEFORE_ORDERED, "ordered"], to: "installed" },
    reopen: { from: PROJECT_SELECTION_STATUSES, to: "owner_review" },
  },
})

export type SelectionStatusEvent = keyof typeof selectionStatusAutomation.transitions

/** The statuses `event` may move a selection from. */
export function selectionStatusSources(event: SelectionStatusEvent): readonly ProjectSelectionStatus[] {
  return selectionStatusAutomation.transitions[event].from
}

/** The status `event` moves a selection to. */
export function selectionStatusTarget(event: SelectionStatusEvent): ProjectSelectionStatus {
  return selectionStatusAutomation.transitions[event].to
}

/**
 * The status `event` moves a selection with stored status `stored` to, or
 * null when it doesn't move it from there (including stored values that are
 * not on the list, such as an old "selected").
 */
export function automaticSelectionStatus(event: SelectionStatusEvent, stored: string): ProjectSelectionStatus | null {
  if (!isListValue(PROJECT_SELECTION_STATUSES, stored)) return null
  const next = nextState(selectionStatusAutomation, stored, event)
  return next.ok ? next.to : null
}

/**
 * An owner signature for a Selection Phase (Foxit). Staff prepare it, Foxit
 * reports it sent, then signed, declined or cancelled. A newer preparation
 * cancels an unsent one.
 */
export const roundSignatureMachine = defineMachine({
  name: "selection round signature",
  states: SELECTION_ROUND_SIGNATURE_STATUSES,
  initial: "preparing",
  terminal: ["signed", "declined", "cancelled"],
  transitions: {
    send: { from: ["preparing"], to: "sent" },
    sign: { from: ["preparing", "sent"], to: "signed" },
    decline: { from: ["preparing", "sent"], to: "declined" },
    cancel: { from: ["preparing", "sent"], to: "cancelled" },
  },
})

export type RoundSignatureEvent = keyof typeof roundSignatureMachine.transitions

/** The status `event` moves a signature in `from` to, or null when it may not. */
export function roundSignatureStatusAfter(event: RoundSignatureEvent, from: SelectionRoundSignatureStatus): SelectionRoundSignatureStatus | null {
  const next = nextState(roundSignatureMachine, from, event)
  return next.ok ? next.to : null
}

/** An owner's pricing or alternative request: open until staff resolve it or the owner withdraws it. */
export const selectionRequestMachine = defineMachine({
  name: "selection request",
  states: SELECTION_REQUEST_STATUSES,
  initial: "open",
  terminal: ["resolved", "withdrawn"],
  transitions: {
    resolve: { from: ["open"], to: "resolved" },
    withdraw: { from: ["open"], to: "withdrawn" },
  },
})
