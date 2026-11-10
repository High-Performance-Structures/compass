/*
 * Enumerated values for access requests (architecture standard, section 3).
 * Pure constants with no imports, so the Drizzle schema can type its columns
 * with them.
 */

/** Where a request stands. Only "pending" requests can be decided or withdrawn. */
export const ACCESS_REQUEST_STATUSES = ["pending", "approved", "declined", "withdrawn"] as const
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number]

/** Who the person says they are ("I am a …"). */
export const ACCESS_REQUEST_KINDS = ["client", "vendor", "employee"] as const
export type AccessRequestKind = (typeof ACCESS_REQUEST_KINDS)[number]
