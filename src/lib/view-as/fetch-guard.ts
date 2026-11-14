/*
 * Outside-service guard for View as. The database guard stops Compass
 * records changing; this stops side effects outside Compass while viewing:
 * Gmail sends, Drive uploads, push notices, Sage bridge calls, GitHub and
 * anything else reached with fetch() using a write method. It also keeps
 * Gmail and Google Calendar contents out of View as entirely (approved scope:
 * external mail and calendar contents are not shown).
 *
 * Installed once per worker from getCloudflareContext(). The check runs per
 * request through cookies(), so only requests that carry the View as cookie
 * are affected. Sign-in token refreshes stay allowed so the admin's own
 * session and Drive reads keep working.
 *
 * Like the database guard, a refused request in a server action throws; while
 * a page renders it gets a 403 response instead (and a log line), so the
 * screen degrades the way it would for any failed outside call.
 */
import { VIEW_AS_READ_ONLY_MESSAGE } from "@/lib/view-as/constants"
import { ViewAsReadOnlyError, type GuardMode } from "@/lib/view-as/errors"

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * Token endpoints: a POST that only exchanges credentials, never changes data.
 * WorkOS is allowed exactly one: the session refresh authkit-nextjs makes
 * (`authenticateWithRefreshToken` posts to /user_management/authenticate).
 * Every other WorkOS write (update or delete a user, send an invitation or
 * a verification email, change a password) is refused while viewing.
 */
function isTokenEndpoint(url: URL): boolean {
  if (url.hostname === "api.workos.com") return url.pathname === "/user_management/authenticate"
  if (url.hostname === "oauth2.googleapis.com") return url.pathname === "/token"
  return url.hostname === "www.googleapis.com" && url.pathname === "/oauth2/v4/token"
}

/** External mail and calendar contents are never fetched while viewing, not even to read. */
function isPrivateMailOrCalendar(url: URL): boolean {
  if (url.hostname === "gmail.googleapis.com") return true
  return url.hostname === "www.googleapis.com" && (url.pathname.startsWith("/calendar/") || url.pathname.startsWith("/gmail/"))
}

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (input instanceof URL) return input
    if (typeof input === "string") return new URL(input)
    return new URL(input.url)
  } catch {
    return null
  }
}

function requestMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET")
  return method.toUpperCase()
}

/**
 * Why this outside request is refused while viewing, or null when it may
 * proceed. Pure, so the rule is unit tested.
 */
export function viewAsFetchRefusal(input: RequestInfo | URL, init?: RequestInit): string | null {
  const url = requestUrl(input)
  // Relative URLs are same-app requests; the app's own guards apply to them.
  if (!url) return null
  if (isPrivateMailOrCalendar(url)) return "Gmail and Google Calendar are not shown in View as"
  if (READ_METHODS.has(requestMethod(input, init))) return null
  if (isTokenEndpoint(url)) return null
  return `outside ${url.hostname} write`
}

const INSTALLED = Symbol.for("compass.viewAsFetchGuard")

/** The answer a refused request gets while a page renders. */
function refusedResponse(refusal: string): Response {
  console.warn(`View as dropped an outside request: ${refusal}`)
  return Response.json({ success: false, error: { message: VIEW_AS_READ_ONLY_MESSAGE } }, { status: 403 })
}

/**
 * Wrap globalThis.fetch once. The request checks are injected so this module
 * stays free of next/headers and the wrapper can be tested.
 */
export function installViewAsFetchGuard(
  isViewAsRequest: () => Promise<boolean>,
  guardMode: () => Promise<GuardMode> = async () => "reject",
): void {
  const current = globalThis.fetch
  if (typeof current !== "function" || Reflect.get(current, INSTALLED) === true) return
  const guarded: typeof fetch = async (input, init) => {
    const refusal = viewAsFetchRefusal(input, init)
    if (refusal && (await isViewAsRequest())) {
      if ((await guardMode()) === "skip") return refusedResponse(refusal)
      throw new ViewAsReadOnlyError(refusal)
    }
    return current(input, init)
  }
  // Keep flags other code sets on fetch (Next marks its patched fetch).
  for (const key of Reflect.ownKeys(current)) {
    if (key === "length" || key === "name" || key === "prototype") continue
    Reflect.set(guarded, key, Reflect.get(current, key))
  }
  Reflect.set(guarded, INSTALLED, true)
  globalThis.fetch = guarded
}
