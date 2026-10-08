const SEPARATORS = /^[\s\-–—:|·]+|[\s\-–—:|·]+$/g
const DEPARTMENT_JOB_NUMBER = /^[OHND]-[A-Z0-9]+(?:-[A-Z0-9]+)*/i

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * The name the office recognizes a job by: the stored name without the job
 * number(s) repeated at its start, e.g. "O-170-2684 - O-170-2684 County Ln 7
 * - Loomis" → "County Ln 7 - Loomis". The job number is shown separately.
 * Public titles are for social media, so they are deliberately not used here.
 */
export function projectDisplayName(project: {
  readonly name: string
  readonly projectNumber: string | null
}): string {
  const number = project.projectNumber?.trim() ?? ""
  const leadingNumber = number
    ? new RegExp(`^${escapeRegExp(number)}(?![A-Za-z0-9])`, "i")
    : null
  let remaining = project.name.trim()
  for (let pass = 0; pass < 4; pass += 1) {
    const before = remaining
    if (leadingNumber) remaining = remaining.replace(leadingNumber, "")
    // Also catch a department-style job number that differs from the record's.
    if (remaining === before) remaining = remaining.replace(DEPARTMENT_JOB_NUMBER, (match) =>
      /\d/.test(match) ? "" : match,
    )
    remaining = remaining.replace(SEPARATORS, "")
    if (remaining === before) break
  }
  return remaining || number || project.name.trim()
}
