"use client"

const REALTIMEKIT_API_ORIGIN = "https://api.realtime.cloudflare.com"
const COMPASS_REALTIMEKIT_PROXY_PREFIX = "/api/realtimekit"

let originalFetch: typeof fetch | null = null
let installCount = 0

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
        const response = await fetchImpl(nextInput, init)
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
