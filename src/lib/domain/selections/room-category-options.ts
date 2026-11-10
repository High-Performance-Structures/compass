/**
 * The Room and Category suggestions in the selection forms (Add selection,
 * Edit, Save to Compass). Pure and client-safe; the reads are in
 * ./workspace.ts (loadSelectionRoomCategoryOptions).
 *
 * The lists come from the whole company, not just the job, so a new job
 * still offers the rooms and categories used before. The job's own values
 * come first, then the rest of the company's, each part sorted A to Z.
 * Names are trimmed and compared without case; the first spelling seen wins
 * (the job's own spelling over another job's).
 */

/** Blank category saves as this; it is never offered as a choice. */
export const UNCATEGORIZED = "Uncategorized"

/** Most suggestions sent to a form for one field. */
export const ROOM_CATEGORY_OPTION_LIMIT = 300

export type SelectionRoomCategoryOptions = {
  readonly rooms: readonly string[]
  readonly categories: readonly string[]
}

const byName = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { sensitivity: "base", numeric: true })

/**
 * Job values first, then the company's other values; trimmed, blanks and
 * `exclude` (any case) dropped, de-duplicated without case, each part sorted
 * A to Z, at most `limit` names.
 */
export function mergePickerNames(
  jobValues: readonly (string | null | undefined)[],
  companyValues: readonly (string | null | undefined)[],
  options: { readonly exclude?: readonly string[]; readonly limit?: number } = {}
): string[] {
  const seen = new Set((options.exclude ?? []).map((name) => name.trim().toLocaleLowerCase()))
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
  const job = take(jobValues)
  const company = take(companyValues)
  return [...job, ...company].slice(0, options.limit ?? ROOM_CATEGORY_OPTION_LIMIT)
}

/**
 * Rooms: the job's rooms first, then other rooms used across the company.
 * Categories: the job's first, then the company's and the category names in
 * Settings › Workflows › Selections lead times. "Uncategorized" is left out
 * (a blank category means that).
 */
export function buildSelectionRoomCategoryOptions(input: {
  readonly jobRooms: readonly (string | null | undefined)[]
  readonly companyRooms: readonly (string | null | undefined)[]
  readonly jobCategories: readonly (string | null | undefined)[]
  readonly companyCategories: readonly (string | null | undefined)[]
  readonly leadTimeCategories: readonly string[]
}): SelectionRoomCategoryOptions {
  return {
    rooms: mergePickerNames(input.jobRooms, input.companyRooms),
    categories: mergePickerNames(
      input.jobCategories,
      [...input.companyCategories, ...input.leadTimeCategories],
      { exclude: [UNCATEGORIZED] }
    ),
  }
}
