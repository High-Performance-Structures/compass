/** Record creation is an import/upload event, not evidence of when a photo was taken. */
export function resolveProjectPhotoDate(value: {
  readonly capturedAt: string | null
  readonly logDate: string | null
}): string | null {
  if (value.capturedAt) return value.capturedAt.slice(0, 10)
  if (value.logDate) return value.logDate
  return null
}

/** Keep undated photos after dated photos in either chronological direction. */
export function comparePhotoDates(
  left: string | null,
  right: string | null,
  direction: "asc" | "desc"
): number {
  if (left === null) return right === null ? 0 : 1
  if (right === null) return -1
  const comparison = left.localeCompare(right)
  return direction === "asc" ? comparison : -comparison
}
