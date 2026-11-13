/**
 * The contract deposit lifecycle (issue #1329). A deposit's status changes
 * only through these events, written compare-and-set on the status staff saw
 * (src/app/actions/project-contract-deposits.ts), so recording a payment and
 * voiding the same request at once end with one outcome, and a voided
 * deposit is never brought back by a save that started before the void.
 *
 *   requested ──receive──▶ received      (either) ──void──▶ void
 *       ▲                      │
 *       └─────unreceive────────┘   (staff saved it back as only requested)
 *
 * A deposit is created as "requested" (Request deposit) or straight as
 * "received" (a deposit recorded without a request). Saving one without
 * changing its status is a "save" on the same status.
 */
import { defineMachine } from "@/lib/shared/state-machine"

import { CONTRACT_DEPOSIT_STATUSES } from "./statuses"

export const contractDepositMachine = defineMachine({
  name: "contract deposit",
  states: CONTRACT_DEPOSIT_STATUSES,
  initial: "requested",
  entry: ["received"],
  terminal: ["void"],
  transitions: {
    receive: { from: ["requested"], to: "received" },
    unreceive: { from: ["received"], to: "requested" },
    void: { from: ["requested", "received"], to: "void" },
  },
})
