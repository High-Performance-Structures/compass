/**
 * The project access invitation lifecycle (issue #1329, phase 2). An
 * invitation's status changes only through these events, applied by
 * identity/store.ts as compare-and-set writes, so a stale read can never
 * accept a revoked invitation or expire an accepted one.
 *
 *   sent ──accept──▶ accepted ──revoke──▶ revoked
 *     │                                     ▲
 *     ├──────────────revoke─────────────────┘
 *     └──expire──▶ expired
 *
 * A new invitation row starts as "sent"; re-inviting someone adds a new row.
 */
import { defineMachine } from "@/lib/shared/state-machine"

import { PROJECT_ACCESS_INVITATION_STATUSES } from "./statuses"

export const invitationMachine = defineMachine({
  name: "project access invitation",
  states: PROJECT_ACCESS_INVITATION_STATUSES,
  initial: "sent",
  terminal: ["revoked", "expired"],
  transitions: {
    // The invited person signed in and claimed it.
    accept: { from: ["sent"], to: "accepted" },
    // Its WorkOS link lapsed before it was claimed.
    expire: { from: ["sent"], to: "expired" },
    // Staff withdrew it, the contact's email changed, or the contact left the job.
    revoke: { from: ["sent", "accepted"], to: "revoked" },
  },
})

export type InvitationEvent = keyof typeof invitationMachine.transitions
