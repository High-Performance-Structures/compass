/**
 * Pure view logic for the staff Daily Logs workspace: form drafts, labels,
 * filters and upload limit messages. No React, database or network access.
 */
import type { ProjectDailyLogItem } from "@/lib/domain/field/daily-log-workspace"
import {
  emptyWorkLine,
  localDateInputValue,
  type DailyLogWorkLineDraft,
} from "@/lib/daily-logs/daily-log-form"
import { field } from "@/lib/shared/guards"
import {
  MAX_PHOTO_UPLOAD_BATCH_BYTES,
  MAX_PHOTO_UPLOAD_FILE_BYTES,
  PHOTO_UPLOAD_LIMIT_LABEL,
} from "@/lib/photos/upload-limits"

export type LogFilter = "all" | "needs_review" | "approved" | "owner_visible"

/** The phase picker's "No phase" value. */
export const NO_PHASE_VALUE = "unassigned"

export type DailyLogDraft = {
  readonly logDate: string
  readonly weatherTempF: string
  readonly weatherConditions: string
  readonly weatherPrecipitation: string
  readonly workCompleted: string
  readonly crewPresent: string
  readonly materialsUsed: string
  readonly issues: string
  readonly safetyIncidents: string
  readonly visitorLog: string
  readonly notes: string
  readonly workLines: readonly DailyLogWorkLineDraft[]
}

export type DailyLogTextField = Exclude<keyof DailyLogDraft, "workLines">

export function emptyDailyLogDraft(): DailyLogDraft {
  return {
    logDate: localDateInputValue(),
    weatherTempF: "",
    weatherConditions: "",
    weatherPrecipitation: "",
    workCompleted: "",
    crewPresent: "",
    materialsUsed: "",
    issues: "",
    safetyIncidents: "",
    visitorLog: "",
    notes: "",
    workLines: [emptyWorkLine()],
  }
}

export function draftFromLog(log: ProjectDailyLogItem): DailyLogDraft {
  return {
    logDate: log.logDate,
    weatherTempF: log.weatherTempF === null ? "" : String(log.weatherTempF),
    weatherConditions: log.weatherConditions ?? "",
    weatherPrecipitation: log.weatherPrecipitation ?? "",
    workCompleted: log.workCompleted,
    crewPresent: log.crewPresent ?? "",
    materialsUsed: log.materialsUsed ?? "",
    issues: log.issues ?? "",
    safetyIncidents: log.safetyIncidents ?? "",
    visitorLog: log.visitorLog ?? "",
    notes: log.notes ?? "",
    workLines:
      log.workLines.length > 0
        ? log.workLines.map((line) => ({
            costCode: line.costCode,
            hours: line.hours === null ? "" : String(line.hours),
            description: line.description,
            ...(line.todoId ? { todoId: line.todoId } : {}),
          }))
        : [emptyWorkLine()],
  }
}

/** Drops a field's errors once it is edited ("workLines" drops every line's). */
export function withoutErrors(errors: ReadonlyMap<string, string>, key: string): ReadonlyMap<string, string> {
  if (![...errors.keys()].some((errorKey) => errorKey === key || errorKey.startsWith(`${key}.`))) return errors
  return new Map([...errors].filter(([errorKey]) => errorKey !== key && !errorKey.startsWith(`${key}.`)))
}

/** The input to focus for a form error. */
export function fieldElementId(idPrefix: string, key: string): string {
  const line = /^workLines\.(\d+)\.(costCode|hours)$/.exec(key)
  if (line) return `${idPrefix}-line-${line[1]}-${line[2] === "costCode" ? "code" : "hours"}`
  if (key === "workLines") return `${idPrefix}-line-0-code`
  const contact = /^clientContacts\.(\d+)\.(contactId|time|summary|interactionType)$/.exec(key)
  if (contact) {
    const part = contact[2] === "contactId" ? "who" : contact[2] === "interactionType" ? "type" : contact[2]
    return `${idPrefix}-contact-${contact[1]}-${part}`
  }
  const ids: Readonly<Record<string, string>> = {
    logDate: "date",
    workCompleted: "work",
    crewPresent: "crew",
    materialsUsed: "materials",
    issues: "issues",
    safetyIncidents: "safety",
    visitorLog: "visitors",
    notes: "notes",
  }
  return `${idPrefix}-${ids[key] ?? key}`
}

/** "512 B", "1.5 KB", "2.0 MB". */
export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

/** "needs_review" → "Needs Review". */
export function statusLabel(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

export function sourceLabel(value: string): string {
  switch (value) {
    case "buildertrend":
      return "Buildertrend"
    case "google_daily_log":
      return "Google daily log"
    case "google_drive":
      return "Google Drive"
    case "telegram":
      return "Telegram"
    case "mobile":
      return "Mobile"
    default:
      return "Compass"
  }
}

function readableJsonItem(value: unknown): string | null {
  if (typeof value === "string") return value
  if (typeof value !== "object" || value === null) return null

  const company =
    "company" in value && typeof value.company === "string"
      ? value.company
      : null
  const count =
    "count" in value && typeof value.count === "number"
      ? value.count
      : null

  if (company && count !== null) return `${company} (${count})`
  if (company) return company
  return null
}

/** Imported crew/material fields can be JSON lists; shows them as text. */
export function readableField(value: string | null): string | null {
  if (value === null || value.length === 0) return null

  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed)) {
      const parts = parsed
        .map(readableJsonItem)
        .filter((part): part is string => part !== null && part.length > 0)
      return parts.length > 0 ? parts.join(", ") : value
    }
    return value
  } catch {
    return value
  }
}

export function dailyLogTodoDescription(log: ProjectDailyLogItem): string {
  return (
    [log.issues, log.safetyIncidents, log.notes]
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n\n") || log.workCompleted
  )
}

export function filterValue(value: string): LogFilter {
  switch (value) {
    case "needs_review":
    case "approved":
    case "owner_visible":
      return value
    default:
      return "all"
  }
}

export function matchesFilter(log: ProjectDailyLogItem, filter: LogFilter): boolean {
  switch (filter) {
    case "needs_review":
      return log.reviewStatus === "needs_review"
    case "approved":
      return log.reviewStatus === "approved"
    case "owner_visible":
      return log.isClientVisible
    case "all":
      return true
  }
}

export function selectedLogIds(
  logs: readonly ProjectDailyLogItem[],
  selectedIds: readonly string[]
): readonly string[] {
  const availableIds = new Set(logs.map((log) => log.id))
  return selectedIds.filter((id) => availableIds.has(id))
}

/** Total size of the chosen files. */
export function totalFileBytes(files: readonly { readonly size: number }[]): number {
  return files.reduce((total, file) => total + file.size, 0)
}

/** Why a batch of files is too large to upload, or null when it fits. */
export function uploadSizeProblem(
  files: readonly { readonly name: string; readonly size: number }[]
): string | null {
  const oversizedFile = files.find((file) => file.size > MAX_PHOTO_UPLOAD_FILE_BYTES)
  if (oversizedFile) {
    return `${oversizedFile.name} is ${formatBytes(oversizedFile.size)}. ${PHOTO_UPLOAD_LIMIT_LABEL}`
  }
  const totalBytes = totalFileBytes(files)
  if (totalBytes > MAX_PHOTO_UPLOAD_BATCH_BYTES) {
    return `${formatBytes(totalBytes)} selected. ${PHOTO_UPLOAD_LIMIT_LABEL}`
  }
  return null
}

/** Reads a photo upload response body; a platform rejection may not be JSON. */
export function parseUploadResponse(responseText: string): unknown {
  try {
    return JSON.parse(responseText)
  } catch {
    return null
  }
}

/** True when the upload route answered with success. */
export function uploadSucceeded(ok: boolean, result: unknown): boolean {
  return ok && field(result, "success") === true
}

/** The message for a failed upload response. */
export function uploadFailureMessage(status: number, result: unknown, responseText: string): string {
  if (status === 413) return `The file is too large. ${PHOTO_UPLOAD_LIMIT_LABEL}`
  const error = field(result, "error")
  if (typeof error === "string") return error
  return responseText.trim().length > 0
    ? `Upload failed (${status}): ${responseText.trim()}`
    : `Upload failed (${status}).`
}

/** "Uploaded 2 of 3. 1 can be retried." style summary for a partial batch. */
export function uploadBatchSummary(
  uploadedCount: number,
  totalCount: number,
  failureMessages: readonly string[]
): string {
  const failedCount = failureMessages.length
  const summary =
    uploadedCount === 0
      ? `No files uploaded. ${failedCount} can be retried.`
      : `Uploaded ${uploadedCount} of ${totalCount}. ${failedCount} can be retried.`
  return `${summary} ${failureMessages.join(" ")}`
}

/** "Weather filled from NWS station KCOS near Woodland Park." */
export function weatherFilledMessage(weather: {
  readonly source: string
  readonly station: string | null
  readonly locationLabel: string | null
}): string {
  return [
    `Weather filled from ${weather.source}`,
    weather.station ? `station ${weather.station}` : null,
    weather.locationLabel ? `near ${weather.locationLabel}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" ")
    .concat(".")
}
