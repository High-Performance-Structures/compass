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
