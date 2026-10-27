/**
 * Visibility model for published project documents.
 *
 * A document carries two independent flags — owner and sub-vendor — that staff
 * toggle per file. Internal staff always have access, so the flags only govern
 * the two external audiences. This module is the single source of truth for the
 * audience vocabulary and is deliberately free of any database or React import
 * so actions, routes, previews, and UI can all share it.
 */

export type ProjectDocumentAudience = "owner" | "sub_vendor"

export type ProjectDocumentVisibility = {
  readonly owner: boolean
  readonly subVendor: boolean
}

export type ProjectDocumentAudienceOption = {
  readonly value: ProjectDocumentAudience
  readonly label: string
}

/** The external audiences a file can be shared with, in display order. */
export const PROJECT_DOCUMENT_AUDIENCES: readonly ProjectDocumentAudienceOption[] = [
  { value: "owner", label: "Owners" },
  { value: "sub_vendor", label: "Vendors" },
]

/** New files are shared with everyone unless staff narrow the audience. */
export const DEFAULT_PROJECT_DOCUMENT_VISIBILITY: ProjectDocumentVisibility = {
  owner: true,
  subVendor: true,
}

export function isProjectDocumentAudience(
  value: string
): value is ProjectDocumentAudience {
  return value === "owner" || value === "sub_vendor"
}

/** True when a document with this visibility should reach the given audience. */
export function isDocumentVisibleToAudience(
  visibility: ProjectDocumentVisibility,
  audience: ProjectDocumentAudience
): boolean {
  return audience === "owner" ? visibility.owner : visibility.subVendor
}

/**
 * Coarse single value kept in sync with the two flags for the legacy `audience`
 * column, activity logs, and quick "is this internal-only" checks.
 */
export function coarseProjectDocumentAudience(
  visibility: ProjectDocumentVisibility
): "project_team" | "internal_only" {
  return visibility.owner || visibility.subVendor ? "project_team" : "internal_only"
}

/** Short, human summary of who can see the document. */
export function projectDocumentVisibilityLabel(
  visibility: ProjectDocumentVisibility
): string {
  const who = [
    visibility.owner ? "Owners" : null,
    visibility.subVendor ? "Vendors" : null,
  ].filter((value): value is string => value !== null)
  return who.length > 0 ? `${who.join(" · ")} · internal staff` : "Internal staff only"
}

/** Coerce arbitrary input (form values, JSON) into a concrete visibility. */
export function normalizeProjectDocumentVisibility(input: {
  readonly owner?: unknown
  readonly subVendor?: unknown
}): ProjectDocumentVisibility {
  return { owner: input.owner === true, subVendor: input.subVendor === true }
}
