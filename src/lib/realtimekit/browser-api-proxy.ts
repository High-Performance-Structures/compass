"use client"

import {
  URGENT_LOG_HEADER,
  URGENT_LOG_HEADER_VALUE,
  isOfficeTalkFailureDiagnostic,
  takeUrgentLogTag,
  urgentLogStateAfterFailure,
  type UrgentLogState,
} from "@/lib/realtimekit/log-upload-throttle"

const REALTIMEKIT_API_ORIGIN = "https://api.realtime.cloudflare.com"
const COMPASS_REALTIMEKIT_PROXY_PREFIX = "/api/realtimekit"
const REALTIMEKIT_DIAGNOSTIC_URLS = [
  `${REALTIMEKIT_API_ORIGIN}/logs`,
  `${REALTIMEKIT_API_ORIGIN}/telemetry`,
] as const

let originalFetch: typeof fetch | null = null
let installCount = 0
/** Urgent tagging state per upload URL, so logs and telemetry each get their share. */
const urgentLogStates = new Map<string, UrgentLogState>()

/**
 * Called for each meeting-window diagnostic. When one shows Office Talk
 * stopped working (the meeting would not open, or the call's connection
 * failed), tag the SDK's next few log and telemetry uploads so the server forwards them to
 * Cloudflare despite the log throttle.
 */
export function noteRealtimeKitDiagnostic(
  event: string,
  payload: Readonly<Record<string, unknown>>
): void {
  if (!isOfficeTalkFailureDiagnostic(event, payload)) return
  const state = urgentLogStateAfterFailure(Date.now())
  for (const url of REALTIMEKIT_DIAGNOSTIC_URLS) urgentLogStates.set(url, state)
}

/** Adds the urgent header to a log or telemetry upload while a failure window is open. */
function withUrgentLogHeader(
  originalUrl: string,
  input: RequestInfo | URL,
  init: RequestInit | undefined
): RequestInit | undefined {
  const url = REALTIMEKIT_DIAGNOSTIC_URLS.find((candidate) => originalUrl.startsWith(candidate))
  if (!url) return init
  const tag = takeUrgentLogTag(urgentLogStates.get(url) ?? null, Date.now())
  if (tag.next) urgentLogStates.set(url, tag.next)
  else urgentLogStates.delete(url)
  if (!tag.urgent) return init
  // init.headers replaces a Request's own headers, so start from those.
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined)
  )
  headers.set(URGENT_LOG_HEADER, URGENT_LOG_HEADER_VALUE)
  return { ...init, headers }
}

function recordProxyEvent(event: Readonly<Record<string, unknown>>): void {
  if (typeof document === "undefined") return
  const attribute = "data-compass-realtimekit-proxy-diagnostics"
  const existing = document.documentElement.getAttribute(attribute)
  let parsed: unknown = []
  try {
    parsed = existing ? JSON.parse(existing) : []
  } catch {
    parsed = []
  }
  const current = Array.isArray(parsed) ? parsed : []
  const next = [...current, event].slice(-20)
  document.documentElement.setAttribute(attribute, JSON.stringify(next))
}

function proxyUrlForRealtimeKit(url: URL): string {
  if (url.origin !== REALTIMEKIT_API_ORIGIN) return url.toString()
  return `${COMPASS_REALTIMEKIT_PROXY_PREFIX}${url.pathname}${url.search}`
}

function proxiedInput(input: RequestInfo | URL): RequestInfo | URL {
  if (input instanceof Request) {
    const proxiedUrl = proxyUrlForRealtimeKit(new URL(input.url))
    return proxiedUrl === input.url ? input : new Request(proxiedUrl, input)
  }

  if (input instanceof URL) {
    return proxyUrlForRealtimeKit(input)
  }

  try {
    return proxyUrlForRealtimeKit(new URL(input))
  } catch {
    return input
  }
}

export function installRealtimeKitBrowserApiProxy(): () => void {
  installCount += 1
  if (!originalFetch) {
    originalFetch = globalThis.fetch.bind(globalThis)
    globalThis.fetch = async (input, init) => {
      const fetchImpl = originalFetch
      if (!fetchImpl) return globalThis.fetch(input, init)
      const nextInput = proxiedInput(input)
      const originalUrl =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.toString()
            : input
      const proxiedUrl =
        nextInput instanceof Request
          ? nextInput.url
          : nextInput instanceof URL
            ? nextInput.toString()
            : nextInput
      const proxied = originalUrl !== proxiedUrl
      if (proxied) {
        recordProxyEvent({ event: "rewrite", originalUrl, proxiedUrl })
      }
      try {
        const response = await fetchImpl(
          nextInput,
          proxied ? withUrgentLogHeader(originalUrl, nextInput, init) : init
        )
        if (proxied) {
          recordProxyEvent({
            event: "response",
            proxiedUrl,
            status: response.status,
            ok: response.ok,
          })
        }
        return response
      } catch (error) {
        if (proxied) {
          recordProxyEvent({
            event: "error",
            proxiedUrl,
            message: error instanceof Error ? error.message : String(error),
          })
        }
        throw error
      }
    }
  }

  return () => {
    installCount = Math.max(installCount - 1, 0)
    if (installCount > 0 || !originalFetch) return
    globalThis.fetch = originalFetch
    originalFetch = null
  }
}
