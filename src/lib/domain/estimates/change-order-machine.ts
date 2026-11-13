/**
 * The change order (and variance) lifecycle (issue #1329). A change order's
 * status changes only through these events; ./change-order-status-store.ts
 * makes each one compare-and-set on the status that was read, so
 * executing twice, executing after a void, or approving a variance twice
 * lands once, and its history entry, Activity and contract budget rebuild
 * happen once.
 *
 * Staff moves (the status picker on a change order) are one event per
 * target status; src/lib/change-orders/status.ts adds who may make them:
 *
 *   draft ─▶ submitted ─▶ triage ─▶ pricing ─▶ internal_review ─▶ approved_for_owner
 *     ─▶ signature_pending ─▶ executed ─▶ sage_pending ─▶ synced ─▶ closed
 *   (with needs_information side trips, and decline / void before execution)
 *
 * Compass's own moves:
 *   execute_from_estimate   the change order's estimate was accepted (again)
 *   record_acceptance       staff recorded written or verbal owner approval
 *   approve_variance        staff approved a variance (no owner signature)
 *   sign_selection_round    the owner signed a selection round's change order
 *   cancel_selection_round  that round's signature was cancelled or declined
 *   execute_rebaseline      a preconstruction rebaseline amendment executed
 */
import { defineMachine } from "@/lib/shared/state-machine"

import { CHANGE_ORDER_STATUSES, type ChangeOrderStatus } from "./statuses"

/** Before execution: the change order can still be priced, declined or voided. */
const OPEN = ["draft", "submitted", "triage", "needs_information", "pricing", "internal_review"] as const
const WITH_OWNER = ["approved_for_owner", "signature_pending"] as const

export const changeOrderMachine = defineMachine({
  name: "change order",
  states: CHANGE_ORDER_STATUSES,
  initial: "draft",
  // Imports record executed (and other) change orders as they found them.
  entry: [...CHANGE_ORDER_STATUSES.filter((status) => status !== "draft")],
  terminal: ["closed", "declined", "void"],
  transitions: {
    // ---- staff moves, one per target status
    submit: { from: ["draft", "needs_information"], to: "submitted" },
    triage: { from: ["submitted", "needs_information"], to: "triage" },
    request_information: { from: ["submitted", "triage", "pricing", "internal_review"], to: "needs_information" },
    price: { from: ["triage", "needs_information", "internal_review"], to: "pricing" },
    review: { from: ["triage", "pricing", "approved_for_owner"], to: "internal_review" },
    approve_for_owner: { from: ["internal_review", "signature_pending"], to: "approved_for_owner" },
    send_for_signature: { from: ["approved_for_owner"], to: "signature_pending" },
    // Signed; or back from Sage pending.
    execute: { from: ["signature_pending", "sage_pending"], to: "executed" },
    send_to_sage: { from: ["executed"], to: "sage_pending" },
    mark_synced: { from: ["sage_pending"], to: "synced" },
    close: { from: ["executed", "synced"], to: "closed" },
    decline: { from: ["submitted", "triage", "needs_information", "pricing", "internal_review", ...WITH_OWNER], to: "declined" },
    void: { from: [...OPEN, ...WITH_OWNER], to: "void" },

    // ---- Compass's own moves
    // A newer accepted version re-executes an executed change order with its lines.
    execute_from_estimate: {
      from: [...OPEN, ...WITH_OWNER, "executed", "sage_pending", "synced"],
      to: "executed",
    },
    record_acceptance: { from: [...OPEN, ...WITH_OWNER], to: "executed" },
    approve_variance: { from: [...OPEN], to: "executed" },
    sign_selection_round: { from: ["signature_pending"], to: "executed" },
    cancel_selection_round: { from: ["draft", "signature_pending"], to: "void" },
    execute_rebaseline: { from: ["signature_pending"], to: "executed" },
  },
})

export type ChangeOrderEvent = keyof typeof changeOrderMachine.transitions

/** The staff event that moves a change order to `status` (null: staff never pick it). */
const STAFF_EVENTS: Readonly<Record<ChangeOrderStatus, ChangeOrderEvent | null>> = {
  draft: null,
  submitted: "submit",
  triage: "triage",
  needs_information: "request_information",
  pricing: "price",
  internal_review: "review",
  approved_for_owner: "approve_for_owner",
  signature_pending: "send_for_signature",
  executed: "execute",
  sage_pending: "send_to_sage",
  synced: "mark_synced",
  closed: "close",
  declined: "decline",
  void: "void",
}

export function staffEventFor(status: ChangeOrderStatus): ChangeOrderEvent | null {
  return STAFF_EVENTS[status]
}

/** The statuses staff may move a change order to from `from` (before permission rules). */
export function staffTargetsFrom(from: ChangeOrderStatus): readonly ChangeOrderStatus[] {
  return CHANGE_ORDER_STATUSES.filter((to) => {
    const event = STAFF_EVENTS[to]
    return event !== null && changeOrderMachine.transitions[event].from.some((state) => state === from)
  })
}
