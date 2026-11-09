/**
 * How a Compass update reaches tabs that are already open.
 *
 * When a new version goes live (`bun run deploy`, see
 * docs/architecture/server-bundle.md "Updates and open tabs"):
 *
 * 1. The deploy keeps the previous Worker version in the deployment at 0% of
 *    traffic. New page loads get the new version at once.
 * 2. Every open tab tags its own requests with Cloudflare's version-override
 *    header (src/lib/deployment/version-pin.ts), so Save and every other server
 *    action keeps reaching the version that drew the page. Without this, a
 *    deploy changes Next.js server action IDs and old tabs' saves fail.
 * 3. Each tab polls /api/deployment-version. When the answer comes from a
 *    newer version, the tab shows "Compass will update in 2 minutes — save your
 *    work now" and counts down to UPDATE_COUNTDOWN_MS after the moment the new
 *    version went live, so every tab shows the same time.
 * 4. When the countdown ends the notice asks for a refresh. The tab keeps
 *    reaching its old version for OLD_VERSION_GRACE_AFTER_COUNTDOWN_MS more, so
 *    a save started at the last second still lands, then stops.
 *
 * Change the window here; nothing else needs to change.
 */

/** How long open tabs are told they have before refreshing. */
export const UPDATE_COUNTDOWN_MS = 2 * 60_000

/** A tab that only notices late still gets at least this long. */
export const MIN_LATE_NOTICE_MS = 30_000

/**
 * After its countdown ends a tab keeps asking for its old version this much
 * longer, then lets its requests reach the new version (saves would then fail
 * and the unsaved-text safety net takes over).
 */
export const OLD_VERSION_GRACE_AFTER_COUNTDOWN_MS = 5 * 60_000

export type ServerVersionInfo = {
  readonly deploymentId: string
  /** Cloudflare Worker version id, null outside Cloudflare (local dev). */
  readonly versionId: string | null
  /** Worker script name, used as the key of the version-override header. */
  readonly workerName: string | null
  /** When this version was uploaded (ISO), close to when it went live. */
  readonly liveAt: string | null
  /** Server clock when the answer was made (ISO), to correct tab clock skew. */
  readonly serverNow: string
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

export function parseServerVersionInfo(value: unknown): ServerVersionInfo | null {
  if (typeof value !== "object" || value === null) return null
  const deploymentId = stringOrNull(Reflect.get(value, "deploymentId"))
  const serverNow = stringOrNull(Reflect.get(value, "serverNow"))
  if (deploymentId === null) return null
  return {
    deploymentId,
    versionId: stringOrNull(Reflect.get(value, "versionId")),
    workerName: stringOrNull(Reflect.get(value, "workerName")),
    liveAt: stringOrNull(Reflect.get(value, "liveAt")),
    serverNow: serverNow ?? new Date(0).toISOString(),
  }
}

/**
 * The moment (on this tab's clock) the countdown reaches zero.
 *
 * The deadline is UPDATE_COUNTDOWN_MS after the new version went live, measured
 * on the server's clock and moved onto the tab's clock, so all tabs agree. A tab
 * that notices with less than MIN_LATE_NOTICE_MS left gets MIN_LATE_NOTICE_MS.
 */
export function updateDeadline(
  info: Pick<ServerVersionInfo, "liveAt" | "serverNow">,
  receivedAtMs: number
): number {
  const liveAtMs = info.liveAt === null ? Number.NaN : Date.parse(info.liveAt)
  const serverNowMs = Date.parse(info.serverNow)
  const remaining =
    Number.isFinite(liveAtMs) && Number.isFinite(serverNowMs) && serverNowMs > 0
      ? liveAtMs + UPDATE_COUNTDOWN_MS - serverNowMs
      : UPDATE_COUNTDOWN_MS
  return receivedAtMs + Math.max(Math.min(remaining, UPDATE_COUNTDOWN_MS), MIN_LATE_NOTICE_MS)
}

export function remainingMs(deadlineMs: number, nowMs: number): number {
  return Math.max(0, deadlineMs - nowMs)
}

/** "1:05" style, rounded up so the notice never shows 0:00 early. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

/** Whether a tab should still route its requests to its own (older) version. */
export function shouldKeepOldVersion(
  deadlineMs: number | null,
  nowMs: number
): boolean {
  return (
    deadlineMs === null ||
    nowMs < deadlineMs + OLD_VERSION_GRACE_AFTER_COUNTDOWN_MS
  )
}

/**
 * Cloudflare's version-override header value (an RFC 8941 dictionary):
 * `compass="<version id>"`. Cloudflare ignores it when that version is no
 * longer in the deployment and routes the request normally.
 */
export function versionOverrideHeaderValue(
  workerName: string,
  versionId: string
): string | null {
  if (!/^[a-z][a-z0-9_-]*$/.test(workerName)) return null
  if (!/^[0-9a-f-]{8,64}$/i.test(versionId)) return null
  return `${workerName}="${versionId}"`
}

export const VERSION_OVERRIDE_HEADER = "Cloudflare-Workers-Version-Overrides"
