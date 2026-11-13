/**
 * The owner pay application (draw) lifecycle for draws built in Compass
 * (source "compass_contract_budget"; issue #1329). A draw's status changes
 * only through these events, applied by ./store.ts (movePayApplicationStatus)
 * as compare-and-set writes on the event's source states, so a double click
 * or two people at once end with exactly one move and one set of follow-ups
 * (Activity, the Sage AR invoice request).
 *
 *   building ──finish──▶ draft ──mark_ready──▶ internal_review ──approve──▶ billed
 *                          ▲                     │        ▲                  │
 *                          └───return_to_draft───┘        └───undo_billing───┘
 *
 * A Compass draw is inserted as "building" and finished once its G703 lines
 * and workflow item exist; a draw synced from Sage is inserted as "draft".
 * Deleting a draft (or a leftover "building" row) removes the row.
 *
 * Other rows in project_budget_applications are not Compass draws: contract
 * budget projections (building, budget_current, budget_superseded; see
 * store.ts) and imported historical draws, which keep the status they were
 * imported with.
 */
import { defineMachine } from "@/lib/shared/state-machine"

import { PAY_APPLICATION_STATUSES } from "./statuses"

export const payApplicationMachine = defineMachine({
  name: "pay application",
  states: PAY_APPLICATION_STATUSES,
  initial: "building",
  entry: ["draft"],
  terminal: [],
  transitions: {
    // Its lines and workflow item were written.
    finish: { from: ["building"], to: "draft" },
    // Staff sent it for review; its amounts are frozen.
    mark_ready: { from: ["draft"], to: "internal_review" },
    // Reviewers sent it back for edits.
    return_to_draft: { from: ["internal_review"], to: "draft" },
    // Approve for billing: billed, published to the owner, Sage invoice requested.
    approve: { from: ["internal_review"], to: "billed" },
    // The billing approval was taken back.
    undo_billing: { from: ["billed"], to: "internal_review" },
  },
})

export type PayApplicationEvent = keyof typeof payApplicationMachine.transitions
