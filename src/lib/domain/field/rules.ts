/**
 * Field domain rules (architecture standard, section 1): pure logic for
 * daily logs, photos, weather and owner updates. No database or network
 * access, so the browser may import these for previews too.
 */
import type { DailyLogFormValues, DailyLogWorkLineDraft } from "@/lib/daily-logs/daily-log-form"
import { MAX_PHOTO_UPLOAD_BATCH_BYTES, MAX_PHOTO_UPLOAD_FILE_BYTES } from "@/lib/photos/upload-limits"
import {
  isDateWithinOwnerUpdatePeriod,
  type OwnerUpdateDocumentSelection,
  type OwnerUpdateScheduleSelection,
  type OwnerUpdateTodoSelection,
} from "@/lib/owner-updates/snapshot"

// ---------------------------------------------------------------------------
// Id lists stored as JSON text on owner updates
// ---------------------------------------------------------------------------

/** A stored JSON id list: unique, trimmed, non-empty strings; [] when invalid. */
export function parseIdList(value: string | null): readonly string[] {
  if (!value) return []

  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return [
      ...new Set(
        parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      ),
    ]
  } catch {
    return []
  }
}

/** Ids submitted by the editor: de-duplicated, then trimmed, blanks dropped. */
export function submittedIdList(ids: readonly string[]): string[] {
  return [...new Set(ids)].map((id) => id.trim()).filter((id) => id.length > 0)
}

// ---------------------------------------------------------------------------
// Daily logs
// ---------------------------------------------------------------------------

export function personDisplayName(row: {
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
  readonly email: string | null
}): string | null {
  if (row.displayName) return row.displayName

  const fullName = [row.firstName, row.lastName]
    .filter((part) => part !== null && part.length > 0)
    .join(" ")

  return fullName.length > 0 ? fullName : row.email
}

export function normalizedDailyLogReviewStatus(value: string): string {
  switch (value) {
    case "draft":
    case "needs_review":
    case "approved":
    case "rejected":
      return value
    default:
      return "needs_review"
  }
}

/** Trimmed text; throws "<label> is required." when blank. */
export function requiredText(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`${label} is required.`)
  }
  return trimmed
}

export function optionalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** A YYYY-MM-DD log date; throws when the value is not one. */
export function normalizedLogDate(value: string): string {
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  throw new Error("Enter a valid daily log date.")
}

/** The form values the shared daily log rules check. */
export function dailyLogFormValues(
  input: {
    readonly logDate: string
    readonly workCompleted: string
    readonly crewPresent: string
    readonly materialsUsed: string
    readonly issues: string
    readonly safetyIncidents: string
    readonly visitorLog: string
    readonly notes: string
  },
  workLines: readonly DailyLogWorkLineDraft[]
): DailyLogFormValues {
  return {
    logDate: input.logDate,
    workCompleted: input.workCompleted,
    workLines,
    crewPresent: input.crewPresent,
    materialsUsed: input.materialsUsed,
    issues: input.issues,
    safetyIncidents: input.safetyIncidents,
    visitorLog: input.visitorLog,
    notes: input.notes,
  }
}

/** Notes safe for an owner: Buildertrend import markers are dropped. */
export function ownerFacingDailyLogNotes(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  if (trimmed.length === 0) return null
  if (trimmed.startsWith("Buildertrend title:")) return null
  if (trimmed.includes("Buildertrend job ID:")) return null
  return trimmed
}

/** Unique, trimmed, non-empty schedule phase names in their given order. */
export function uniqueSchedulePhases(phases: readonly string[]): string[] {
  return [
    ...new Set(
      phases.map((phase) => phase.trim()).filter((phase) => phase.length > 0)
    ),
  ]
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

export function fahrenheitFromCelsius(value: number | null): number | null {
  if (value === null) return null
  return Math.round((value * 9) / 5 + 32)
}

export function inchesFromMeters(value: number | null): string | null {
  if (value === null || value <= 0) return null
  const inches = value * 39.3701
  return `${inches.toFixed(inches < 0.1 ? 2 : 1)} in last hour`
}

/** WMO weather code to the label the daily log shows. */
export function weatherCodeLabel(value: number | null): string {
  switch (value) {
    case 0:
      return "Clear"
    case 1:
    case 2:
    case 3:
      return "Partly cloudy"
    case 45:
    case 48:
      return "Fog"
    case 51:
    case 53:
    case 55:
    case 56:
    case 57:
      return "Drizzle"
    case 61:
    case 63:
    case 65:
    case 66:
    case 67:
      return "Rain"
    case 71:
    case 73:
    case 75:
    case 77:
      return "Snow"
    case 80:
    case 81:
    case 82:
      return "Rain showers"
    case 85:
    case 86:
      return "Snow showers"
    case 95:
    case 96:
    case 99:
      return "Thunderstorm"
    default:
      return "Historical weather"
  }
}

export function inchesText(value: number | null, label: string): string | null {
  if (value === null || value <= 0) return null
  return `${value.toFixed(value < 0.1 ? 2 : 1)} in ${label}`
}

/** Both are YYYY-MM-DD; today and later use live observations. */
export function isTodayOrFuture(logDate: string, today: string): boolean {
  return logDate >= today
}

/** "Clear, 72F, 0.1 in rain", or null when nothing was recorded. */
export function weatherLabel(row: {
  readonly weatherConditions: string | null
  readonly weatherTempF: number | null
  readonly weatherPrecipitation: string | null
}): string | null {
  const parts = [
    row.weatherConditions,
    row.weatherTempF === null ? null : `${row.weatherTempF}F`,
    row.weatherPrecipitation,
  ].filter((part): part is string => part !== null && part.length > 0)

  return parts.length > 0 ? parts.join(", ") : null
}

/** The owner update document's weather: conditions and temperature only. */
export function ownerUpdateWeatherLabel(row: {
  readonly weatherConditions: string | null
  readonly weatherTempF: number | null
}): string | null {
  return (
    [
      row.weatherConditions,
      row.weatherTempF === null ? null : `${row.weatherTempF}F`,
    ]
      .filter((part) => part !== null && part.length > 0)
      .join(", ") || null
  )
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export function normalizedPhotoReviewStatus(value: string): string {
  switch (value) {
    case "approved":
    case "needs_review":
    case "rejected":
      return value
    default:
      return "needs_review"
  }
}

export function normalizedPhotoKind(value: string): string {
  switch (value) {
    case "progress":
    case "issue":
    case "delivery":
    case "selection":
    case "archive":
      return value
    default:
      return "progress"
  }
}

export type PhotoUploadSizeCheck<T> =
  | { readonly ok: true; readonly totalBytes: number }
  | { readonly ok: false; readonly reason: "file"; readonly file: T; readonly totalBytes: number }
  | { readonly ok: false; readonly reason: "batch"; readonly totalBytes: number }

/**
 * The photo upload size limits: each file, then the whole batch. Each caller
 * words its own message; the server route enforces the same check.
 */
export function photoUploadSizeCheck<T extends { readonly size: number }>(
  files: readonly T[]
): PhotoUploadSizeCheck<T> {
  const totalBytes = files.reduce((total, file) => total + file.size, 0)
  const oversized = files.find((file) => file.size > MAX_PHOTO_UPLOAD_FILE_BYTES)
  if (oversized) return { ok: false, reason: "file", file: oversized, totalBytes }
  if (totalBytes > MAX_PHOTO_UPLOAD_BATCH_BYTES) {
    return { ok: false, reason: "batch", totalBytes }
  }
  return { ok: true, totalBytes }
}

/** The photo_count a Buildertrend review folder link carries, if any. */
export function photoReviewPhotoCount(value: string | null): number | null {
  if (!value) return null

  try {
    const parsed: unknown = JSON.parse(value)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "photo_count" in parsed
    ) {
      const count = parsed.photo_count
      return typeof count === "number" ? count : null
    }
    return null
  } catch {
    return null
  }
}

/** Thumbnails first, then other images, then everything else. */
export function latestPhotoOrder<
  T extends { readonly thumbnailUrl: string | null; readonly mimeType: string | null },
>(photos: readonly T[]): T[] {
  return [
    ...photos.filter((photo) => photo.thumbnailUrl !== null),
    ...photos.filter(
      (photo) =>
        photo.thumbnailUrl === null && photo.mimeType?.startsWith("image/") === true
    ),
    ...photos.filter(
      (photo) =>
        photo.thumbnailUrl === null && photo.mimeType?.startsWith("image/") !== true
    ),
  ]
}

// ---------------------------------------------------------------------------
// Owner updates
// ---------------------------------------------------------------------------

export function ownerUpdateDocumentSelection(row: {
  readonly id: string
  readonly sourceSystem: string
  readonly fileName: string
  readonly mimeType: string | null
  readonly driveFileId: string | null
  readonly driveUrl: string | null
  readonly caption: string | null
  readonly capturedAt: string | null
}): OwnerUpdateDocumentSelection {
  return {
    id: row.id,
    sourceSystem: row.sourceSystem,
    fileName: row.fileName,
    mimeType: row.mimeType,
    driveFileId: row.driveFileId,
    driveUrl: row.driveUrl,
    caption: row.caption,
    capturedAt: row.capturedAt,
  }
}

/** A file belongs to an update when tied to a source log or captured in its period. */
export function isPhotoInOwnerUpdateScope(
  photo: {
    readonly dailyLogId: string | null
    readonly capturedAt: string | null
  },
  sourceDailyLogIds: ReadonlySet<string>,
  periodStart: string,
  periodEnd: string
): boolean {
  if (
    photo.dailyLogId !== null &&
    sourceDailyLogIds.has(photo.dailyLogId)
  ) {
    return true
  }

  const capturedDate = photo.capturedAt?.slice(0, 10) ?? null
  return (
    capturedDate !== null &&
    isDateWithinOwnerUpdatePeriod(capturedDate, periodStart, periodEnd)
  )
}

/** Ids of the logs dated inside the period. */
export function dailyLogIdsInPeriod(
  logs: readonly { readonly id: string; readonly logDate: string }[],
  periodStart: string | null,
  periodEnd: string | null
): Set<string> {
  return new Set(
    logs
      .filter((log) => isDateWithinOwnerUpdatePeriod(log.logDate, periodStart, periodEnd))
      .map((log) => log.id)
  )
}

/** "<label> Update - <date>" or "<label> Update - <first> to <last>". */
export function ownerUpdateTitleFromLogs(
  label: string,
  firstLogDate: string,
  lastLogDate: string
): string {
  return firstLogDate === lastLogDate
    ? `${label} Update - ${firstLogDate}`
    : `${label} Update - ${firstLogDate} to ${lastLogDate}`
}

/** The opening summary of a draft made from daily logs. */
export function ownerUpdateSummaryFromLogs(
  logs: readonly { readonly workCompleted: string }[]
): string {
  return logs
    .map((log) => log.workCompleted)
    .join(" ")
    .slice(0, 900)
}

/**
 * Saved schedule selections refreshed from the current schedule, matched by
 * id or by title and dates; the saved title and notes are kept.
 */
export function reconciledScheduleItems(
  selected: readonly OwnerUpdateScheduleSelection[],
  available: readonly OwnerUpdateScheduleSelection[]
): readonly OwnerUpdateScheduleSelection[] {
  const availableById = new Map(available.map((item) => [item.id, item]))
  return selected.map((item) => {
    const candidate =
      availableById.get(item.id) ??
      available.find(
        (availableItem) =>
          availableItem.title === item.title &&
          availableItem.startDate === item.startDate &&
          availableItem.endDate === item.endDate
      )
    return candidate === undefined
      ? item
      : { ...candidate, title: item.title, notes: item.notes }
  })
}

/**
 * Submitted to-dos kept only when they are still candidates, once each, with
 * the editor's title (when not blank), description and notes.
 */
export function reconcileSubmittedTodos(
  submitted: readonly {
    readonly id: string
    readonly title: string
    readonly description: string
    readonly notes: string
  }[],
  candidates: readonly OwnerUpdateTodoSelection[]
): OwnerUpdateTodoSelection[] {
  const todosById = new Map(candidates.map((item) => [item.id, item]))
  const seenTodoIds = new Set<string>()
  return submitted.flatMap((item) => {
    if (seenTodoIds.has(item.id)) return []
    seenTodoIds.add(item.id)
    const candidate = todosById.get(item.id)
    if (candidate === undefined) return []
    const editedTitle = item.title.trim()
    return [
      {
        ...candidate,
        title: editedTitle.length > 0 ? editedTitle : candidate.title,
        description: item.description.trim(),
        notes: item.notes.trim(),
      },
    ]
  })
}
