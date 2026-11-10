/**
 * The Room suggestions in the selection forms (Add selection, Edit, Save to
 * Compass). Pure and client-safe; the reads are in ./workspace.ts
 * (loadSelectionRoomOptions).
 *
 * The list comes from the whole company, not just the job, so a new job
 * still offers the rooms used before. The job's own rooms come first, then
 * the rest of the company's, each part sorted A to Z. Names are trimmed and
 * compared without case; the first spelling seen wins (the job's own
 * spelling over another job's).
 */

/** Most room suggestions sent to a form. */
export const ROOM_OPTION_LIMIT = 300

const byName = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { sensitivity: "base", numeric: true })

/**
 * Job rooms first, then the company's other rooms; trimmed, blanks dropped,
 * de-duplicated without case, each part sorted A to Z, at most `limit` names.
 */
export function mergeRoomNames(
  jobRooms: readonly (string | null | undefined)[],
  companyRooms: readonly (string | null | undefined)[],
  limit: number = ROOM_OPTION_LIMIT
): string[] {
  const seen = new Set<string>()
  const take = (values: readonly (string | null | undefined)[]): string[] => {
    const names: string[] = []
    for (const value of values) {
      const name = value?.trim() ?? ""
      const key = name.toLocaleLowerCase()
      if (!name || seen.has(key)) continue
      seen.add(key)
      names.push(name)
    }
    return names.sort(byName)
  }
  const job = take(jobRooms)
  const company = take(companyRooms)
  return [...job, ...company].slice(0, limit)
}
