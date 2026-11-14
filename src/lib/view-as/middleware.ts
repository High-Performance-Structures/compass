/*
 * Middleware rule for View as. Runs before auth on every request:
 * - "block-write": an /api request that is not a read, while viewing;
 * - "clear": a page load whose View as cookie is plainly over (developer
 *   mode off, or past its expiry). The page is sent through
 *   VIEW_AS_ENDED_PATH, which records the end in Activity, drops the cookie
 *   and returns the admin to the page as themselves;
 * - "pass": everything else.
 * Clearing reads the payload without the signature on purpose: it only ever
 * removes the cookie, never grants anything. The signed check is server side
 * (session.ts).
 */
import { DEVELOPER_MODE_COOKIE } from "@/lib/developer-mode"
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
): "pass" | "block-write" | "clear" {
  const token = request.cookies.get(VIEW_AS_COOKIE)?.value
  if (!token) return "pass"
  const isRead = ["GET", "HEAD", "OPTIONS"].includes(request.method)
  if (request.nextUrl.pathname.startsWith("/api/") && !isRead) return "block-write"
  if (request.method !== "GET" || request.nextUrl.pathname.startsWith("/api/")) return "pass"
  if (request.nextUrl.pathname === VIEW_AS_ENDED_PATH) return "pass"
  const developerModeOn = request.cookies.get(DEVELOPER_MODE_COOKIE)?.value === "enabled"
  const expiry = unverifiedExpiry(token)
  if (!developerModeOn || expiry === null || expiry <= nowSeconds) return "clear"
  return "pass"
}
