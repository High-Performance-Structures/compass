/**
 * The access request lifecycle (issue #1329, phase 2). A request's status
 * changes only through these events, applied by ./store.ts as
 * compare-and-set writes on the event's source states, so two admins
 * deciding at once, or an admin deciding while the person withdraws, end
 * with exactly one outcome.
 *
 *   pending ──approve──▶ approved
 *     │  ▲                  │
 *     │  └─────reopen───────┘   (granting failed part way; the admin retries)
 *     ├──decline──▶ declined
 *     └──withdraw─▶ withdrawn
 *
 * A new request starts as "pending"; asking again after a decision adds a
 * new row.
 */
import { defineMachine } from "@/lib/shared/state-machine"

import { ACCESS_REQUEST_STATUSES } from "./statuses"

export const accessRequestMachine = defineMachine({
  name: "access request",
  states: ACCESS_REQUEST_STATUSES,
  initial: "pending",
  terminal: ["declined", "withdrawn"],
  transitions: {
    // An admin approved it; access is granted only after this lands.
    approve: { from: ["pending"], to: "approved" },
    // An admin declined it. Nothing is shared.
    decline: { from: ["pending"], to: "declined" },
    // The person took it back.
    withdraw: { from: ["pending"], to: "withdrawn" },
    // Granting access failed after the approval landed, so it waits again.
    reopen: { from: ["approved"], to: "pending" },
  },
})

export type AccessRequestEvent = keyof typeof accessRequestMachine.transitions
