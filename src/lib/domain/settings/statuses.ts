/*
 * Enumerated values for settings records (architecture standard, section 3).
 * Pure constants with no imports, so the Drizzle schema can type its
 * columns with them.
 */

/** The screens a saved view can filter. A new scope is a value here plus a zod schema in its caller. */
export const SAVED_VIEW_SCOPES = ["projects", "schedule"] as const
export type SavedViewScope = (typeof SAVED_VIEW_SCOPES)[number]

/** Who can see a saved project or schedule view. */
export const SAVED_VIEW_VISIBILITIES = ["personal", "shared"] as const
export type SavedViewVisibility = (typeof SAVED_VIEW_VISIBILITIES)[number]
