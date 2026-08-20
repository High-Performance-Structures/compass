export const FIELD_NOTIFICATION_REFRESH_DELAYS_MS: readonly number[] = [
  0,
  1_000,
  3_000,
]

export function fieldPacketRefreshUrl(
  liveUrl: string,
  projectId: string,
  requestId: number
): string {
  const url = new URL(
    `/api/field/projects/${encodeURIComponent(projectId)}`,
    liveUrl
  )
  url.searchParams.set("refresh", String(requestId))
  return url.toString()
}

export function shouldLockFieldAppAfterBackground(
  biometricEnabled: boolean,
  elapsedMs: number,
  lockThresholdMs: number
): boolean {
  return biometricEnabled && elapsedMs > lockThresholdMs
}
