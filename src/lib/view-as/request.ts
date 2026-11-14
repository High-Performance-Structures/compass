/*
 * Whether the current request is a View as request. Presence of the cookie
 * is enough to make the request read only (fail closed): an invalid or
 * expired token never re-enables writes, it only stops identity
 * substitution until the person exits. Background work (cron, queues) has no
 * request cookies and is never a View as request.
 */
// next/headers is loaded on first use: db.ts imports this module, and db.ts
// is reachable from bundles where a static next/headers import is refused.

import { VIEW_AS_COOKIE } from "@/lib/view-as/constants"
import type { GuardMode } from "@/lib/view-as/write-guard"

/** The raw View as cookie on this request, or null. */
async function viewAsCookieValue(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers")
    const value = (await cookies()).get(VIEW_AS_COOKIE)?.value
    return value ? value : null
  } catch {
    // cookies() throws outside a request (cron, queue consumers, build).
    return null
  }
}

export async function isViewAsRequest(): Promise<boolean> {
  return (await viewAsCookieValue()) !== null
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
