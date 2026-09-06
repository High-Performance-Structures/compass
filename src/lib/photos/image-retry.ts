export const MAX_PHOTO_IMAGE_RETRIES = 2

export function nextPhotoImageRetryAttempt(
  currentAttempt: number
): number | null {
  if (currentAttempt < 0 || currentAttempt >= MAX_PHOTO_IMAGE_RETRIES) {
    return null
  }
  return currentAttempt + 1
}

export function photoImageSourceForRetry(
  source: string,
  retryAttempt: number
): string {
  if (retryAttempt <= 0) return source
  const separator = source.includes("?") ? "&" : "?"
  return `${source}${separator}image_retry=${retryAttempt}`
}
