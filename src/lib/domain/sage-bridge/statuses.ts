/*
 * Enumerated values for this domain (architecture standard, section 3).
 * Pure constants with no imports, so the Drizzle schema can type its
 * columns with them.
 */

export const SAGE_LABOR_REQUEST_STATUSES = ["queued", "running", "done", "failed"] as const
export type SageLaborRequestStatus = (typeof SAGE_LABOR_REQUEST_STATUSES)[number]
