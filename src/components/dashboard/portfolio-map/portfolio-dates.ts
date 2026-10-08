const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const

/** "2026-10-13" → "Oct 13" without time-zone shifts. */
export function formatDateKeyShort(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateKey)
  if (!match) return dateKey
  const month = MONTHS[Number(match[2]) - 1]
  return month ? `${month} ${Number(match[3])}` : dateKey
}
