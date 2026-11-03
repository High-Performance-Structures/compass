/*
 * Pure duty log and recurring duty rules. No database or network access.
 * Period math (due dates, labels) lives in src/lib/internal-duties/recurring.ts.
 */

/** Monday of the week containing `date` (local calendar day), YYYY-MM-DD. */
export function weekStartOf(date: Date): string {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const offset = (day.getUTCDay() + 6) % 7
  day.setUTCDate(day.getUTCDate() - offset)
  return day.toISOString().slice(0, 10)
}

/** The duty log note written when a recurring duty's period is marked done with hours. */
export function recurringDoneEntryNote(input: {
  readonly title: string
  readonly accountName: string | null
  readonly periodLabel: string
  readonly notes: string
}): string {
  return [`${input.title}${input.accountName ? ` · ${input.accountName}` : ""}: ${input.periodLabel}`, input.notes.trim()]
    .filter(Boolean)
    .join(". ")
}

/** A new recurring duty goes after the workspace's last one. */
export function nextRecurringDutySortOrder(lastSortOrder: number | null | undefined): number {
  return (lastSortOrder ?? 0) + 1
}

/** D1 reports a unique-index conflict in the error message. */
export function isUniqueConflict(error: unknown): boolean {
  return error instanceof Error && /UNIQUE/i.test(error.message)
}
