/*
 * Enumerated values for this domain (architecture standard, section 3).
 * Pure constants with no imports, so the Drizzle schema can type its
 * columns with them.
 */

export const WARRANTY_CLAIM_STATUSES = [
  "submitted",
  "acknowledged",
  "visit_scheduled",
  "in_progress",
  "waiting_on_owner",
  "resolved",
  "closed",
  "rejected",
] as const
export type WarrantyClaimStatus = (typeof WARRANTY_CLAIM_STATUSES)[number]
