/*
 * Middleware rule for View as. Runs before auth on every request:
 * - "block-write": an /api request that is not a read, while viewing;
 * - "clear": a page load whose View as cookie is plainly over (developer
 *   mode off, or past its expiry). The page is sent through
 *   VIEW_AS_ENDED_PATH, which records the end in Activity, drops the cookie
 *   and returns the admin to the page as themselves;
 * - "signing-in": a sign-in POST (`isAuthSessionWritePath`); it runs as a
 *   normal sign-in with the View as cookie removed from the request and
 *   cleared on the response, and the token passed in VIEW_AS_ENDING_HEADER
 *   so the handler records the end (a sign-in GET is "clear");
 * - "pass": everything else.
 * Clearing reads the payload without the signature on purpose: it only ever
 * removes the cookie, never grants anything. The signed check is server side
 * (session.ts).
 */
import { DEVELOPER_MODE_COOKIE } from "@/lib/developer-mode"
import { isAuthSessionWritePath } from "@/lib/public-paths"
import { isRecord } from "@/lib/shared/guards"
import { VIEW_AS_COOKIE, VIEW_AS_ENDED_PATH } from "@/lib/view-as/constants"

type MiddlewareRequest = {
  readonly method: string
  readonly nextUrl: { readonly pathname: string }
  readonly cookies: { get(name: string): { readonly value: string } | undefined }
}

function unverifiedExpiry(token: string): number | null {
  const body = token.split(".")[0]
  if (!body) return null
  try {
    const parsed: unknown = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")))
    return isRecord(parsed) && typeof parsed.exp === "number" ? parsed.exp : null
  } catch {
    return null
  }
}

export function viewAsMiddlewareDecision(
  request: MiddlewareRequest,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): "pass" | "block-write" | "clear" | "signing-in" {
  const token = request.cookies.get(VIEW_AS_COOKIE)?.value
  if (!token) return "pass"
  // Signing in again (the admin's own WorkOS session lapsed mid-view) must
  // work, and ends the session with a record. A GET (the OAuth callbacks)
  // goes through /view-as/ended first; a POST runs without the View as
  // cookie, and its handler records the end (endViewAsOnSignIn).
  if (isAuthSessionWritePath(request.nextUrl.pathname)) return request.method === "GET" ? "clear" : "signing-in"
  const isRead = ["GET", "HEAD", "OPTIONS"].includes(request.method)
  if (request.nextUrl.pathname.startsWith("/api/") && !isRead) return "block-write"
  if (request.method !== "GET" || request.nextUrl.pathname.startsWith("/api/")) return "pass"
  if (request.nextUrl.pathname === VIEW_AS_ENDED_PATH) return "pass"
  const developerModeOn = request.cookies.get(DEVELOPER_MODE_COOKIE)?.value === "enabled"
  const expiry = unverifiedExpiry(token)
  if (!developerModeOn || expiry === null || expiry <= nowSeconds) return "clear"
  return "pass"
}

/**
 * Where /view-as/ended may send the admin back to: an absolute URL on this
 * same site, resolved the way the browser resolves it, so `/\evil.com`,
 * `/%09/evil.com` and `//evil.com` all fail the origin check. The resolved
 * URL itself is returned (never the path re-parsed), so a path such as
 * `/.//evil.com` cannot turn into a protocol-relative redirect. Anything
 * else returns to the dashboard.
 */
export function viewAsReturnUrl(next: string | null, requestUrl: string): URL {
  const base = new URL(requestUrl)
  const fallback = new URL("/dashboard", base)
  if (!next || !next.startsWith("/")) return fallback
  try {
    const target = new URL(next, base)
    return target.origin === base.origin ? target : fallback
  } catch {
    return fallback
  }
}

/** A Cookie request header without the named cookie. */
export function cookieHeaderWithout(header: string | null, name: string): string {
  return (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "" && part.split("=")[0]?.trim() !== name)
    .join("; ")
}
