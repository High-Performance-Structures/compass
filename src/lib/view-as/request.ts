/*
 * Whether the current request is a View as request. Presence of the cookie
 * is enough to make the request read only (fail closed): an invalid or
 * expired token never re-enables writes, it only stops identity
 * substitution until the session is ended. Background work (cron, queues)
 * has no request and is never a View as request.
 *
 * next/headers is imported statically on purpose: a dynamic import here (db.ts
 * reaches this module from nearly every server chunk) gave every chunk its own
 * copy of Next's cookie parser (scripts/bundle-duplicates-check.mjs).
 */
import { cookies as requestCookies, headers as requestHeaders } from "next/headers"

import { VIEW_AS_COOKIE } from "@/lib/view-as/constants"
import type { GuardMode } from "@/lib/view-as/errors"

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
  return (await viewAsCookie()) !== null
}

/**
 * The View as cookie on this request: its value, "" when it can't be read
 * (fail closed: still treated as View as), or null when there is none.
 */
export async function viewAsCookie(): Promise<string | null> {
  let cookies: unknown = null
  try {
    cookies = requestCookies
  } catch {
    // No request API in this runtime (scripts, some test doubles).
  }
  if (typeof cookies !== "function") return null
  try {
    const store: unknown = await Reflect.apply(cookies, undefined, [])
    const get: unknown = typeof store === "object" && store !== null ? Reflect.get(store, "get") : null
    if (typeof get !== "function") return ""
    const entry: unknown = Reflect.apply(get, store, [VIEW_AS_COOKIE])
    const value: unknown = typeof entry === "object" && entry !== null ? Reflect.get(entry, "value") : null
    return typeof value === "string" && value !== "" ? value : null
  } catch (error) {
    return isOutsideRequestError(error) ? null : ""
  }
}

/** A server action invocation (Next sends the `next-action` header). */
export async function isServerActionRequest(): Promise<boolean> {
  try {
    return (await requestHeaders()).has("next-action")
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
    return (await requestHeaders()).has("next-action") ? "reject" : "skip"
  } catch {
    return "reject"
  }
}
