/*
 * Enumerated values for this domain (architecture standard, section 3).
 * Pure constants with no imports, so the Drizzle schema can type its
 * columns with them.
 */

export const PROJECT_CONTACT_TYPES = ["owner", "supplier", "subcontractor", "internal"] as const
export type ProjectContactType = (typeof PROJECT_CONTACT_TYPES)[number]

/** Whether a vendor gets a 1099; unknown until their W-9 is on file. */
export const VENDOR_1099_STATUSES = ["yes", "no", "unknown"] as const
export type Vendor1099Status = (typeof VENDOR_1099_STATUSES)[number]

// Column -> list map the store checks before every write.
export const PROJECT_CONTACT_LISTS = { contactType: PROJECT_CONTACT_TYPES }
