function comparableDailyLogText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

/**
 * Notes / Next should add information beyond Work Completed. Imported systems
 * sometimes copy the same text into both fields, so treat those copies as empty.
 */
export function normalizeDailyLogNotes(
  workCompleted: string,
  notes: string | null
): string | null {
  const trimmedNotes = notes?.trim() ?? ""
  if (trimmedNotes.length === 0) return null

  if (
    comparableDailyLogText(trimmedNotes) ===
    comparableDailyLogText(workCompleted)
  ) {
    return null
  }

  return trimmedNotes
}
