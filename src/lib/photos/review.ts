/**
 * Pure logic for the staff Photo Review page: filters, sorting, selection,
 * labels and upload messages. No React, database or network access.
 */
import { comparePhotoDates } from "@/lib/photos/date"
import { field } from "@/lib/shared/guards"

export type VisibilityFilter =
  | "all"
  | "internal"
  | "owner"
  | "subs_vendors"
  | "public"
  | "needs_review"
  | "approved"

export type PhotoSort = "newest" | "oldest" | "phase_newest" | "phase_oldest"

/** The fields of a library photo these rules read. */
export type ReviewPhoto = {
  readonly id: string
  readonly fileName: string
  readonly photoDate: string | null
  readonly schedulePhase: string
  readonly reviewStatus: string
  readonly ownerVisible: boolean
  readonly subVendorVisible: boolean
  readonly publicShareable: boolean
}

export const MAX_UPLOAD_FILE_BYTES = 50 * 1024 * 1024
/** The phase picker's "No phase" value. */
export const NO_PHASE_VALUE = "unassigned"

export function phaseLabel(value: string): string {
  return value.length > 0 ? value : "No phase"
}

/** "needs_review" → "Needs Review". */
export function statusLabel(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

export function kindLabel(value: string): string {
  return statusLabel(value)
}

export function sourceLabel(value: string): string {
  switch (value) {
    case "buildertrend":
      return "Buildertrend"
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

export function sourceInitial(value: string): string {
  switch (value) {
    case "buildertrend":
      return "B"
    case "google_drive":
      return "G"
    case "telegram":
      return "T"
    case "mobile":
      return "A"
    default:
      return "C"
  }
}

/** "900 KB" (rounded up) below a megabyte, "1.5 MB" above. */
export function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

/** Today's UTC date as "YYYY-MM-DD" for the upload date input. */
export function currentDateInputValue(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export function isInternalOnly(photo: ReviewPhoto): boolean {
  return (
    !photo.ownerVisible &&
    !photo.subVendorVisible &&
    !photo.publicShareable
  )
}

export function matchesVisibility(
  photo: ReviewPhoto,
  filter: VisibilityFilter
): boolean {
  switch (filter) {
    case "internal":
      return isInternalOnly(photo)
    case "owner":
      return photo.ownerVisible
    case "subs_vendors":
      return photo.subVendorVisible
    case "public":
      return photo.publicShareable
    case "needs_review":
      return photo.reviewStatus === "needs_review"
    case "approved":
      return photo.reviewStatus === "approved"
    case "all":
      return true
  }
}

export function visibilityFilterValue(value: string): VisibilityFilter {
  switch (value) {
    case "internal":
    case "owner":
    case "subs_vendors":
    case "public":
    case "needs_review":
    case "approved":
      return value
    default:
      return "all"
  }
}

export function photoSortValue(value: string): PhotoSort {
  switch (value) {
    case "oldest":
    case "phase_newest":
    case "phase_oldest":
      return value
    default:
      return "newest"
  }
}

function compareByDate(
  left: ReviewPhoto,
  right: ReviewPhoto,
  direction: "asc" | "desc"
): number {
  const result = comparePhotoDates(left.photoDate, right.photoDate, direction)
  if (result === 0) return left.fileName.localeCompare(right.fileName)
  return result
}

function compareByPhase(
  left: ReviewPhoto,
  right: ReviewPhoto,
  direction: "asc" | "desc"
): number {
  const phaseResult = left.schedulePhase.localeCompare(right.schedulePhase)
  if (phaseResult !== 0) return phaseResult
  return compareByDate(left, right, direction)
}

/** The photos matching the date, phase and visibility filters, in the chosen order. */
export function filterAndSortPhotos<T extends ReviewPhoto>(
  photos: readonly T[],
  filters: {
    readonly dateFilter: string
    readonly phaseFilter: string
    readonly visibilityFilter: VisibilityFilter
    readonly photoSort: PhotoSort
  }
): readonly T[] {
  const { dateFilter, phaseFilter, visibilityFilter, photoSort } = filters
  const filtered = photos.filter(
    (photo) =>
      (dateFilter.length === 0 || photo.photoDate === dateFilter) &&
      (phaseFilter === "all" ||
        (phaseFilter === NO_PHASE_VALUE
          ? photo.schedulePhase.length === 0
          : photo.schedulePhase === phaseFilter)) &&
      matchesVisibility(photo, visibilityFilter)
  )

  return [...filtered].sort((left, right) => {
    switch (photoSort) {
      case "oldest":
        return compareByDate(left, right, "asc")
      case "phase_newest":
        return compareByPhase(left, right, "desc")
      case "phase_oldest":
        return compareByPhase(left, right, "asc")
      case "newest":
        return compareByDate(left, right, "desc")
    }
  })
}

export type PhotoReviewCounts = {
  readonly total: number
  readonly needsReview: number
  readonly owner: number
  readonly subVendor: number
  readonly internal: number
}

export function photoReviewCounts(photos: readonly ReviewPhoto[]): PhotoReviewCounts {
  return {
    total: photos.length,
    needsReview: photos.filter(
      (photo) => photo.reviewStatus === "needs_review"
    ).length,
    owner: photos.filter((photo) => photo.ownerVisible).length,
    subVendor: photos.filter((photo) => photo.subVendorVisible).length,
    internal: photos.filter(isInternalOnly).length,
  }
}

/** The modifier keys of the click that toggled a photo. */
export type SelectionModifiers = {
  readonly shiftKey: boolean
  readonly metaKey: boolean
  readonly ctrlKey: boolean
}

/**
 * The selection after clicking a photo: shift-click adds the range from the
 * last clicked photo; any other click toggles the photo.
 */
export function nextSelectedIds(
  current: readonly string[],
  filteredPhotos: readonly { readonly id: string }[],
  photoId: string,
  event: SelectionModifiers,
  lastSelectedId: string | null
): readonly string[] {
  const next = new Set(current)

  if (event.shiftKey && lastSelectedId !== null) {
    const currentIndex = filteredPhotos.findIndex((photo) => photo.id === photoId)
    const lastIndex = filteredPhotos.findIndex(
      (photo) => photo.id === lastSelectedId
    )

    if (currentIndex >= 0 && lastIndex >= 0) {
      const start = Math.min(currentIndex, lastIndex)
      const end = Math.max(currentIndex, lastIndex)
      for (const photo of filteredPhotos.slice(start, end + 1)) {
        next.add(photo.id)
      }
      return [...next]
    }
  }

  // Cmd/Ctrl-click and a plain click both toggle the one photo.
  if (next.has(photoId)) {
    next.delete(photoId)
  } else {
    next.add(photoId)
  }

  return [...next]
}

/** The phase a photo shows after a phase change. */
export function photoWithPhase<T extends ReviewPhoto & {
  readonly schedulePhaseConfidence: number
  readonly schedulePhaseReason: string
}>(photo: T, phase: string): T {
  return {
    ...photo,
    schedulePhase: phase,
    schedulePhaseConfidence: phase.length > 0 ? 100 : 0,
    schedulePhaseReason:
      phase.length > 0
        ? "Phase was selected during upload or review."
        : "No phase assigned.",
  }
}

/** True when the upload route answered with success. */
export function photoUploadSucceeded(result: unknown): boolean {
  return field(result, "success") === true
}

/** The error a failed photo upload reported. */
export function photoUploadError(result: unknown): string {
  const error = field(result, "error")
  return typeof error === "string" ? error : "Unable to upload photo."
}
