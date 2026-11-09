/**
 * RealtimeKit diagnostic log throttle (Office Talk).
 *
 * WHAT IS THROTTLED
 *   The Cloudflare RealtimeKit browser SDK uploads its own diagnostic logs
 *   (`POST https://api.realtime.cloudflare.com/logs`, a gzipped JSON batch of
 *   up to 50 entries every few seconds during a call). Our browser fetch
 *   wrapper routes them through `/api/realtimekit/logs`. Those uploads are
 *   answered with 204 by Compass and NOT forwarded to Cloudflare, except as
 *   described below. Nothing else that goes through the proxy is affected.
 *
 * WHY
 *   Since about 2026-11-09 14:00 UTC Cloudflare answered every log upload
 *   with HTTP 500, and Office Talk sent 500-900 of them an hour. Each one
 *   cost a Worker invocation that read the body and fetched upstream for
 *   nothing. The logs are only useful to Cloudflare support, so the owner
 *   decided (2026-11-09) to forward them at most about twice a day.
 *
 * HOW OFTEN LOGS STILL GO THROUGH
 *   One upload per company per LOG_FORWARD_INTERVAL_MS (12 hours, so about
 *   twice a day) is forwarded so Cloudflare keeps a sample. The window is
 *   shared by every Worker instance through a marker row in
 *   organization_feature_settings (key LOG_FORWARD_MARKER_KEY).
 *
 * WHEN THEY ARE FORWARDED IMMEDIATELY
 *   When Office Talk stops working for someone - the meeting fails to open
 *   after its retry, or the call's signaling or media connection reports
 *   "failed" - the meeting window marks that browser's next uploads as
 *   urgent (header URGENT_LOG_HEADER) for URGENT_LOG_WINDOW_MS. Urgent
 *   uploads skip the 12-hour window so Cloudflare gets the diagnostics, but
 *   are still capped: the browser tags at most URGENT_LOG_UPLOADS_PER_FAILURE
 *   uploads per failure, and the server forwards at most
 *   URGENT_LOG_FORWARDS_PER_USER_PER_HOUR per person per hour.
 *
 * Change the cadence by editing the constants below. This file is pure (no
 * database, network or server imports) so the browser can share it.
 */

/** Routine log uploads forwarded at most once per this many ms, per company. */
export const LOG_FORWARD_INTERVAL_MS = 12 * 60 * 60 * 1000

/** After an Office Talk failure, the browser marks uploads urgent for this long. */
export const URGENT_LOG_WINDOW_MS = 10 * 60 * 1000

/** At most this many uploads are marked urgent after one failure. */
export const URGENT_LOG_UPLOADS_PER_FAILURE = 3

/** Server cap on urgent forwards, per person per rolling hour. */
export const URGENT_LOG_FORWARDS_PER_USER_PER_HOUR = 5

/** Request header the browser adds to urgent log uploads. */
export const URGENT_LOG_HEADER = "x-compass-realtimekit-logs"
export const URGENT_LOG_HEADER_VALUE = "office-talk-failed"

/** organization_feature_settings key holding the last routine forward time. */
export const LOG_FORWARD_MARKER_KEY = "realtimekit-log-forward-marker"

const HOUR_MS = 60 * 60 * 1000

/** True for the SDK's diagnostic log upload (`POST /logs`). */
export function isRealtimeKitLogUpload(
  method: string,
  path: readonly string[]
): boolean {
  return method.toUpperCase() === "POST" && path.length === 1 && path[0] === "logs"
}

/** True when the browser marked this upload as sent after an Office Talk failure. */
export function isUrgentLogUpload(headers: Headers): boolean {
  return headers.get(URGENT_LOG_HEADER) === URGENT_LOG_HEADER_VALUE
}

/**
 * True when a routine upload may be forwarded: no forward recorded yet, an
 * unreadable marker, or the last one at least LOG_FORWARD_INTERVAL_MS ago.
 */
export function routineLogForwardDue(
  lastForwardedAt: string | null,
  nowMs: number
): boolean {
  if (!lastForwardedAt) return true
  const last = Date.parse(lastForwardedAt)
  if (!Number.isFinite(last)) return true
  return nowMs - last >= LOG_FORWARD_INTERVAL_MS
}

/** Earliest time the next routine forward is allowed after `lastForwardedAt`. */
export function nextRoutineLogForwardAt(
  lastForwardedAt: string | null,
  nowMs: number
): number {
  if (!lastForwardedAt) return nowMs
  const last = Date.parse(lastForwardedAt)
  if (!Number.isFinite(last)) return nowMs
  return last + LOG_FORWARD_INTERVAL_MS
}

/** Markers older than this ISO time are stale; a new forward may claim the window. */
export function routineLogForwardStaleBefore(nowMs: number): string {
  return new Date(nowMs - LOG_FORWARD_INTERVAL_MS).toISOString()
}

/**
 * Records an urgent forward for `userId` if they are under the hourly cap.
 * `ledger` maps user id to recent forward times (ms) and is updated in place.
 */
export function takeUrgentLogForward(
  ledger: Map<string, readonly number[]>,
  userId: string,
  nowMs: number
): boolean {
  const recent = (ledger.get(userId) ?? []).filter((at) => nowMs - at < HOUR_MS)
  if (recent.length >= URGENT_LOG_FORWARDS_PER_USER_PER_HOUR) {
    ledger.set(userId, recent)
    return false
  }
  ledger.set(userId, [...recent, nowMs])
  return true
}

/**
 * Browser side: diagnostics the meeting window records that mean Office Talk
 * stopped working - the meeting would not open after its retry, or the call's
 * signaling or media connection reported "failed".
 */
export function isOfficeTalkFailureDiagnostic(
  event: string,
  payload: Readonly<Record<string, unknown>>
): boolean {
  if (event === "open-failed") return true
  return (
    (event === "socket-connection" || event === "media-connection") &&
    payload.state === "failed"
  )
}

/** Browser side: urgent state after a failure. */
export type UrgentLogState = {
  readonly until: number
  readonly remaining: number
}

export function urgentLogStateAfterFailure(nowMs: number): UrgentLogState {
  return { until: nowMs + URGENT_LOG_WINDOW_MS, remaining: URGENT_LOG_UPLOADS_PER_FAILURE }
}

/**
 * Browser side: whether the next log upload should carry the urgent header,
 * and the state after it.
 */
export function takeUrgentLogTag(
  state: UrgentLogState | null,
  nowMs: number
): { readonly urgent: boolean; readonly next: UrgentLogState | null } {
  if (!state || nowMs >= state.until || state.remaining <= 0) {
    return { urgent: false, next: null }
  }
  const remaining = state.remaining - 1
  return { urgent: true, next: remaining > 0 ? { ...state, remaining } : null }
}
