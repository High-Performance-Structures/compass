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
