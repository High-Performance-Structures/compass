/**
 * Shared wording for people who were removed from Contacts or whose Compass
 * account is inactive. Pure, so server and client code both use it.
 */

/** Prefix for an archived or inactive person's name (SQL reads use it too). */
export const ARCHIVED_USER_PREFIX = "Archived user – "

/** How an archived or inactive person is named as an author or sender: "Archived user – Name". */
export function archivedUserLabel(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? ""
  return trimmed ? `${ARCHIVED_USER_PREFIX}${trimmed}` : "Archived user"
}


/** The archive/remove confirmation line about jobs. `null` while the count loads. */
export function archivedPersonJobsNotice(jobCount: number | null): string {
  if (jobCount === null) return "Removes them from every job they are on (kept in history)."
  if (jobCount === 0) return "They are not on any jobs."
  return `Removes them from ${jobCount} ${jobCount === 1 ? "job" : "jobs"} (kept in history).`
}
