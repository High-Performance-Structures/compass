/**
 * Row values for the Daily Logs sheet (sort keys, search and labels).
 * Pure: no React, database or network access.
 */
import type { ProjectDailyLogItem } from "@/lib/domain/field/daily-log-workspace"
import { matchesFilter, readableField, statusLabel, type LogFilter } from "@/lib/daily-logs/workspace-view"

/** "41°F · Clear · Snow", else the imported weather text. */
export function dailyLogWeatherLabel(log: ProjectDailyLogItem): string | null {
  const parts = [
    log.weatherTempF === null ? null : `${log.weatherTempF}°F`,
    log.weatherConditions?.trim() || null,
    log.weatherPrecipitation?.trim() || null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(" · ") : log.weather?.trim() || null
}

/** What the log flags for attention: an issue and/or a safety incident. */
export function dailyLogFlags(log: ProjectDailyLogItem): readonly ("issue" | "safety")[] {
  return [
    ...(log.issues?.trim() ? (["issue"] as const) : []),
    ...(log.safetyIncidents?.trim() ? (["safety"] as const) : []),
  ]
}

/** The log's first line of work, for the sheet's one-line summary. */
export function dailyLogWorkSummary(log: ProjectDailyLogItem): string {
  const work = log.workCompleted.trim()
  if (work) return work
  return log.workLines.map((line) => line.description.trim() || line.costCodeLabel).filter(Boolean).join("; ")
}

export function dailyLogMatchesSearch(log: ProjectDailyLogItem, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [
    log.logDate,
    log.authorName,
    log.workCompleted,
    readableField(log.crewPresent),
    readableField(log.materialsUsed),
    log.issues,
    log.safetyIncidents,
    log.visitorLog,
    log.notes,
    dailyLogWeatherLabel(log),
    statusLabel(log.reviewStatus),
    ...log.workLines.flatMap((line) => [line.costCode, line.costCodeLabel, line.description]),
  ].some((value) => value?.toLowerCase().includes(needle))
}

/** The filter buttons above the sheet, each with its count. */
export function dailyLogFilterOptions(
  logs: readonly ProjectDailyLogItem[]
): readonly { readonly value: LogFilter; readonly label: string; readonly count: number; readonly pinned: boolean }[] {
  const option = (value: LogFilter, label: string): { readonly value: LogFilter; readonly label: string; readonly count: number; readonly pinned: boolean } => ({
    value,
    label,
    count: logs.filter((log) => matchesFilter(log, value)).length,
    pinned: value === "all",
  })
  return [
    option("all", "All"),
    option("needs_review", "Needs review"),
    option("approved", "Approved"),
    option("owner_visible", "Owner visible"),
  ]
}
