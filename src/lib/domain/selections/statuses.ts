/*
 * Enumerated values for this domain (architecture standard, section 3).
 * Pure constants with no imports, so the Drizzle schema can type its
 * columns with them.
 */

/** Finish selection progress. */
export const PROJECT_SELECTION_STATUSES = ["needed", "proposed", "owner_review", "approved", "pricing", "rfq_sent", "ordered", "installed", "unavailable", "deferred"] as const
export type ProjectSelectionStatus = (typeof PROJECT_SELECTION_STATUSES)[number]

export const SELECTION_REQUEST_KINDS = ["pricing", "alternative"] as const

export const SELECTION_REQUEST_STATUSES = ["open", "resolved", "withdrawn"] as const

/** Where a choice under a selection stands. Which choice the owner picked is the separate `chosen` flag. */
export const SELECTION_CHOICE_STATUSES = ["proposed", "available", "unavailable", "declined"] as const
export type SelectionChoiceStatus = (typeof SELECTION_CHOICE_STATUSES)[number]

/** Who can read a selection comment: the owner and staff, or staff only. */
export const SELECTION_COMMENT_VISIBILITIES = ["owner", "staff"] as const
export type SelectionCommentVisibility = (typeof SELECTION_COMMENT_VISIBILITIES)[number]

/** Which side added a supplier link or comment. */
export const SELECTION_AUTHOR_AUDIENCES = ["staff", "owner"] as const
export type SelectionAuthorAudience = (typeof SELECTION_AUTHOR_AUDIENCES)[number]

