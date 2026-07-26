export const ALL_DAILY_LOG_AUTHORS = "all"
export const UNKNOWN_DAILY_LOG_AUTHOR = "unknown"

type PrintableDailyLog = {
  readonly logDate: string
  readonly authorName: string | null
}

export function dailyLogAuthorValue(log: PrintableDailyLog): string {
  return log.authorName ?? UNKNOWN_DAILY_LOG_AUTHOR
}

export function matchesDailyLogPrintFilters(
  log: PrintableDailyLog,
  startDate: string,
  endDate: string,
  author: string
): boolean {
  if (startDate.length > 0 && log.logDate < startDate) return false
  if (endDate.length > 0 && log.logDate > endDate) return false
  return (
    author === ALL_DAILY_LOG_AUTHORS || dailyLogAuthorValue(log) === author
  )
}
