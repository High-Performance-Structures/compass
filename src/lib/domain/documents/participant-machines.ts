/**
 * Source-record participant lifecycles (issue #1329, phase 2). Staff review of
 * imported participants is the only thing that changes a participant's
 * statuses after it is written; documents/store.ts applies it as a
 * compare-and-set write, so two reviewers (or a review and the automatic
 * resolver) can't both decide the same row.
 *
 *   review:   unreviewed ──review──▶ reviewed
 *
 *   identity: any undecided identity ──match──▶ matched
 *             any undecided identity ──split──▶ boundary_split
 *
 * Review is the real guard: it lands only on rows still `unreviewed`. The
 * identity events leave from every identity except `boundary_split`, because
 * review has never checked identity and must keep working on whatever an
 * importer stored. Every state other than `unmatched` is an entry state
 * (written by an importer as it found it). The older cutover review values
 * (held, needs_review, verified) are entry states no Compass code moves.
 * Rows staff add or assign by hand (RFI vendor, sub/vendor requester, rows
 * added by review) are written whole with MANAGED_PARTICIPANT_STATUSES or
 * RECORDED_PARTICIPANT_STATUSES. membership_status has no transitions: it is
 * set when a row is written.
 */
import { defineMachine } from "@/lib/shared/state-machine"

import { PARTICIPANT_IDENTITY_STATUSES, PARTICIPANT_REVIEW_STATUSES } from "./statuses"

export const participantReviewMachine = defineMachine({
  name: "participant review",
  states: PARTICIPANT_REVIEW_STATUSES,
  initial: "unreviewed",
  entry: ["held", "needs_review", "verified"],
  terminal: ["reviewed", "held", "needs_review", "verified"],
  transitions: {
    // Staff decided the row (picked a person, split it, or left it as is).
    review: { from: ["unreviewed"], to: "reviewed" },
  },
})

/** Identities review may still decide: all but a split literal. */
const UNDECIDED = PARTICIPANT_IDENTITY_STATUSES.filter(
  (status): status is Exclude<(typeof PARTICIPANT_IDENTITY_STATUSES)[number], "boundary_split"> => status !== "boundary_split",
)

export const participantIdentityMachine = defineMachine({
  name: "participant identity",
  states: PARTICIPANT_IDENTITY_STATUSES,
  initial: "unmatched",
  entry: UNDECIDED.filter((status) => status !== "unmatched"),
  terminal: ["boundary_split"],
  transitions: {
    // Review tied the row to one person (re-pointing an importer match too).
    match: { from: UNDECIDED, to: "matched" },
    // Review split a run-together literal into people (added as their own rows).
    split: { from: UNDECIDED, to: "boundary_split" },
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
