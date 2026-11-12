/**
 * Source-record participant lifecycles (issue #1329, phase 2). Staff review of
 * imported participants is the only thing that changes a participant's
 * statuses after it is written; documents/store.ts applies it as a
 * compare-and-set write, so two reviewers (or a review and the automatic
 * resolver) can't both decide the same row.
 *
 *   review:   unreviewed ──review──▶ reviewed
 *
 *   identity: unmatched ─────────────────┐
 *             boundary_unproven:* ──match─┴─▶ matched
 *             boundary_unproven:* ──split───▶ boundary_split
 *
 * The importer creates rows as matched, unmatched or boundary_unproven:*
 * (entry states). Rows staff add or assign by hand (RFI vendor, sub/vendor
 * requester, rows added by review) are written whole with
 * MANAGED_PARTICIPANT_STATUSES or RECORDED_PARTICIPANT_STATUSES.
 * membership_status has no transitions: it is set when a row is written.
 */
import { defineMachine } from "@/lib/shared/state-machine"

import { PARTICIPANT_IDENTITY_STATUSES, PARTICIPANT_REVIEW_STATUSES } from "./statuses"

export const participantReviewMachine = defineMachine({
  name: "participant review",
  states: PARTICIPANT_REVIEW_STATUSES,
  initial: "unreviewed",
  terminal: ["reviewed"],
  transitions: {
    // Staff decided the row (picked a person, split it, or left it as is).
    review: { from: ["unreviewed"], to: "reviewed" },
  },
})

const UNPROVEN = ["boundary_unproven:none", "boundary_unproven:several", "boundary_unproven:sender_several"] as const

export const participantIdentityMachine = defineMachine({
  name: "participant identity",
  states: PARTICIPANT_IDENTITY_STATUSES,
  initial: "unmatched",
  entry: ["matched", ...UNPROVEN],
  terminal: ["boundary_split"],
  transitions: {
    // Review tied the row to one person. A row the importer already matched
    // may be re-pointed while it is still unreviewed.
    match: { from: ["unmatched", "matched", ...UNPROVEN], to: "matched" },
    // Review split a run-together literal into people (added as their own rows).
    split: { from: [...UNPROVEN], to: "boundary_split" },
  },
})

export type ParticipantIdentityEvent = keyof typeof participantIdentityMachine.transitions

/** A participant staff add or assign by hand: identified, taking part and decided from the start. */
export const MANAGED_PARTICIPANT_STATUSES = {
  identityStatus: participantIdentityMachine.transitions.match.to,
  membershipStatus: "active",
  reviewStatus: participantReviewMachine.transitions.review.to,
} as const

/** Decided by staff but only recorded (a per-message row, or a thread row before the thread is shared). */
export const RECORDED_PARTICIPANT_STATUSES = { ...MANAGED_PARTICIPANT_STATUSES, membershipStatus: "pending" } as const
