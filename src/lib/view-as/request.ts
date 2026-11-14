/*
 * Whether the current request is a View as request. Presence of the cookie
 * is enough to make the request read only (fail closed): an invalid or
 * expired token never re-enables writes, it only stops identity
 * substitution until the session is ended. Background work (cron, queues)
 * has no request and is never a View as request.
 *
 * next/headers is loaded on first use: db.ts imports this module, and db.ts
 * is reachable from bundles where a static next/headers import is refused.
 */

import { VIEW_AS_COOKIE } from "@/lib/view-as/constants"
import type { GuardMode } from "@/lib/view-as/write-guard"

/**
 * Next's error when a request API is called with no request at all (cron,
 * queue consumers, scripts): code E251, "was called outside a request scope".
 */
export function isOutsideRequestError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return Reflect.get(error, "__NEXT_ERROR_CODE") === "E251" || error.message.includes("outside a request scope")
}

/**
 * Whether this request carries the View as cookie. Work scheduled from a
 * View as request (ctx.waitUntil) keeps the request's async context, so it
 * still sees the cookie; bindings it captured earlier are already read only.
 * Only "no request at all" counts as not viewing; any other failure to
 * read the cookie fails closed and treats the request as View as.
 */
export async function isViewAsRequest(): Promise<boolean> {
  let cookies: unknown = null
  try {
    cookies = Reflect.get(await import("next/headers"), "cookies")
  } catch {
    // No request API in this runtime (scripts, some test doubles).
  }
  if (typeof cookies !== "function") return false
  try {
    const store: unknown = await Reflect.apply(cookies, undefined, [])
    const get: unknown = typeof store === "object" && store !== null ? Reflect.get(store, "get") : null
    if (typeof get !== "function") return true
    const entry: unknown = Reflect.apply(get, store, [VIEW_AS_COOKIE])
    const value: unknown = typeof entry === "object" && entry !== null ? Reflect.get(entry, "value") : null
    return typeof value === "string" && value !== ""
  } catch (error) {
    return !isOutsideRequestError(error)
  }
}

/** A server action invocation (Next sends the `next-action` header). */
export async function isServerActionRequest(): Promise<boolean> {
  try {
    const { headers } = await import("next/headers")
    return (await headers()).has("next-action")
  } catch {
    return false
  }
}

/**
 * How blocked writes behave on this View as request: a server action (the
 * `next-action` header) is told it failed; a page render or GET route has
 * the write dropped quietly so the screen still renders. Unknown: reject.
 */
export async function viewAsGuardMode(): Promise<GuardMode> {
  try {
    const { headers } = await import("next/headers")
    return (await headers()).has("next-action") ? "reject" : "skip"
  } catch {
    return "reject"
  }
}
