/*
 * Enumerated values for this domain (architecture standard, section 3).
 * Pure constants with no imports, so the Drizzle schema can type its
 * columns with them.
 */

export const PROJECT_CONTACT_TYPES = ["owner", "supplier", "subcontractor", "internal"] as const
export type ProjectContactType = (typeof PROJECT_CONTACT_TYPES)[number]

// Column -> list map the store checks before every write.
export const PROJECT_CONTACT_LISTS = { contactType: PROJECT_CONTACT_TYPES }
