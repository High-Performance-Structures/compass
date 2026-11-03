/*
 * Enumerated values for this domain (architecture standard, section 3).
 * Pure constants with no imports, so the Drizzle schema can type its
 * columns with them.
 */

/** reserved: planned, not yet out. out: signed out to the job. returned: checked back in. */
export const BRACING_RENTAL_STATUSES = ["reserved", "out", "returned"] as const
export type BracingRentalStatus = (typeof BRACING_RENTAL_STATUSES)[number]
