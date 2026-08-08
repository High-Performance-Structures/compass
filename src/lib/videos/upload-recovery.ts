export const VIDEO_UPLOAD_COMPLETION_RETRY_DELAYS_MS = [
  1_000,
  2_000,
  3_000,
  4_000,
  5_000,
] as const

export function shouldAttemptBrowserUploadRecovery(input: {
  readonly uploadedBytes: number
  readonly fileSize: number
}): boolean {
  // Browsers sometimes omit the final progress event when Drive closes the
  // resumable request after receiving the body. Restrict recovery to the last
  // one percent so a genuinely interrupted transfer still fails promptly.
  return (
    input.fileSize > 0 && input.uploadedBytes * 100 >= input.fileSize * 99
  )
}
