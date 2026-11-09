/**
 * Keeps an open tab talking to the Compass version that drew it.
 *
 * During an update (see src/lib/deployment/update-window.ts) the deploy leaves
 * the previous Worker version in Cloudflare's deployment at 0% of traffic.
 * Cloudflare still sends a request to that version when the request carries
 * the header `Cloudflare-Workers-Version-Overrides: compass="<version id>"`.
 *
 * This module wraps `window.fetch` once so every same-origin request from this
 * tab (server actions, page data, API calls) carries that header for the
 * tab's own version. While the tab's version is the live one the header just
 * names the live version, so it changes nothing. After an update it is what
 * keeps Save working in tabs that were already open.
 *
 * Limits: only requests made with fetch are tagged. Script and image tags,
 * EventSource and WebSockets go to the newest version. The version-check
 * request is never tagged, because it must reach the newest version to learn
 * about an update. Cloudflare ignores the header once the old version has left
 * the deployment (a second deploy, or a deploy that did not use
 * `bun run deploy`), and the request then reaches the newest version.
 */

import {
  VERSION_OVERRIDE_HEADER,
  versionOverrideHeaderValue,
} from "@/lib/deployment/update-window"

export const DEPLOYMENT_VERSION_PATH = "/api/deployment-version"

let pinnedHeaderValue: string | null = null
let installed = false

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (typeof input === "string") return new URL(input, window.location.href)
    if (input instanceof URL) return input
    return new URL(input.url, window.location.href)
  } catch {
    return null
  }
}

export function shouldTagRequest(url: URL | null, origin: string): boolean {
  return (
    url !== null &&
    url.origin === origin &&
    url.pathname !== DEPLOYMENT_VERSION_PATH
  )
}

function installFetchWrapper(): void {
  if (installed || typeof window === "undefined") return
  installed = true
  const originalFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const headerValue = pinnedHeaderValue
    if (
      headerValue === null ||
      !shouldTagRequest(requestUrl(input), window.location.origin)
    ) {
      return originalFetch(input, init)
    }
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    headers.set(VERSION_OVERRIDE_HEADER, headerValue)
    return originalFetch(input, { ...init, headers })
  }
}

/** Route this tab's requests to `versionId` of `workerName` from now on. */
export function pinTabToVersion(workerName: string, versionId: string): void {
  const value = versionOverrideHeaderValue(workerName, versionId)
  if (value === null) return
  installFetchWrapper()
  pinnedHeaderValue = value
}

/** Stop asking for a particular version; requests reach the newest one. */
export function unpinTabVersion(): void {
  pinnedHeaderValue = null
}
