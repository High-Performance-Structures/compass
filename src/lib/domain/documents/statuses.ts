/*
 * Enumerated values for this domain (architecture standard, section 3).
 * Pure constants with no imports, so the Drizzle schema can type its
 * columns with them.
 */

export const PAPER_TRAIL_RECORD_TYPES = [
  "purchase_order",
  "estimate",
  "rfi",
  "change_order",
  "shop_ticket",
] as const
export type PaperTrailRecordType = (typeof PAPER_TRAIL_RECORD_TYPES)[number]

export const PAPER_TRAIL_FILE_STATUSES = [
  "pending",
  "synced",
  "failed",
  // Written to the private "Compass Records" folder because the usual
  // subfolder is shared outside the company.
  "held_private",
  // The record no longer exists; its last Drive copy is kept.
  "removed",
  // A file that looks like this record was already in the folder (saved by
  // hand); nothing is written until someone chooses what to do.
  "needs_choice",
  // Someone chose to keep the hand-saved file; Compass stops saving this record.
  "kept_existing",
] as const
export type PaperTrailFileStatus = (typeof PAPER_TRAIL_FILE_STATUSES)[number]

export const PAPER_TRAIL_SNAPSHOT_STATUSES = ["pending", "saved", "failed"] as const

/** What a published archive document collects. */
export const ARCHIVE_DOCUMENT_KINDS = ["daily_log", "message", "owner_update", "rfi", "rfq", "other"] as const

export const ARCHIVE_AUDIENCES = ["owner", "sub_vendor"] as const

export const ARCHIVE_DOCUMENT_STATUSES = ["published", "revoked"] as const

// Source-record participants (project_source_record_participants): the
// access boundary for a person named on an imported or shared record.
// Transitions are in participant-machines.ts.

/**
 * Who the row is. The Buildertrend message importer records `matched`,
 * `unmatched` (ambiguous person) or `boundary_unproven:<how>` (a run-together
 * name it could not split safely); staff review moves rows to `matched` or
 * `boundary_split`. The `matched_*` and `source_display_unverified` values
 * were written by earlier cutover imports (no writer remains in Compass or
 * its scripts) and are kept as stored.
 */
export const PARTICIPANT_IDENTITY_STATUSES = [
  "unmatched",
  "matched",
  "boundary_unproven:none",
  "boundary_unproven:several",
  "boundary_unproven:sender_several",
  "boundary_split",
  "matched_active_user",
  "matched_project_contact",
  "matched_source_held",
  "source_display_unverified",
] as const

/** Whether the person takes part (`active`) or is only recorded (`pending`). Set when the row is written. */
export const PARTICIPANT_MEMBERSHIP_STATUSES = ["pending", "active"] as const

/**
 * `held`, `needs_review` and `verified` were written by earlier cutover
 * imports; Compass review only acts on `unreviewed` rows and leaves them as is.
 */
export const PARTICIPANT_REVIEW_STATUSES = ["unreviewed", "reviewed", "held", "needs_review", "verified"] as const
