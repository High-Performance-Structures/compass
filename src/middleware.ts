import { NextRequest, NextResponse } from "next/server"
import { authkit, handleAuthkitHeaders } from "@workos-inc/authkit-nextjs"
import {
  isDevAuthFallbackAllowed,
  isWorkOSConfigured,
} from "@/lib/auth-config"
import { legacyProjectResolutionPathname } from "@/lib/legacy-project-route"
import {
  isAuthSessionWritePath,
  isPublicPath,
} from "@/lib/public-paths"

import { AUDIENCE_SCOPE_HEADER, audienceScopeFromUrl } from "@/lib/project-audience-request"

function legacyResolutionUrl(request: NextRequest): URL | null {
  if (request.nextUrl.searchParams.get("legacyResolved") === "1") return null
  const pathname = legacyProjectResolutionPathname(
    request.nextUrl.pathname,
    request.nextUrl.search,
  )
  return pathname ? new URL(pathname, request.url) : null
}

export default async function middleware(incomingRequest: NextRequest) {
  // Never accept a caller-supplied effective identity header.
  const requestHeaders = new Headers(incomingRequest.headers)
  requestHeaders.delete(AUDIENCE_SCOPE_HEADER)
  const scope = audienceScopeFromUrl(incomingRequest.nextUrl)
  if (scope) requestHeaders.set(AUDIENCE_SCOPE_HEADER, JSON.stringify(scope))
  const request = new NextRequest(incomingRequest, { headers: requestHeaders })
  const { pathname } = request.nextUrl
  if (scope && pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    return NextResponse.json({ success: false, error: "Preview is read only." }, { status: 403 })
  }

  if (!isWorkOSConfigured()) {
    if (isDevAuthFallbackAllowed()) {
      const resolutionUrl = legacyResolutionUrl(request)
      if (resolutionUrl) return NextResponse.redirect(resolutionUrl)
      return NextResponse.next({ request: { headers: requestHeaders } })
    }

    if (isPublicPath(pathname)) {
      return NextResponse.next({ request: { headers: requestHeaders } })
    }

    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { success: false, error: "Authentication is not configured." },
        { status: 503 }
      )
    }

    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("error", "auth_unavailable")
    loginUrl.searchParams.set("from", `${pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(loginUrl)
  }

  // These handlers establish a new session themselves. Running AuthKit first
  // can append a stale-session deletion after their new Set-Cookie header,
  // especially immediately after a password reset revokes the old session.
  if (isAuthSessionWritePath(pathname)) {
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  const { session, headers } = await authkit(request)

  if (isPublicPath(pathname)) {
    return handleAuthkitHeaders(request, headers)
  }

  // The demo cookie only works with the local/E2E sign-in fallback above;
  // with WorkOS configured, every page needs a real session.
  if (!session.user) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("from", `${pathname}${request.nextUrl.search}`)
    return handleAuthkitHeaders(request, headers, { redirect: loginUrl.toString() })
  }

  const resolutionUrl = legacyResolutionUrl(request)
  if (resolutionUrl) {
    return handleAuthkitHeaders(request, headers, {
      redirect: resolutionUrl.toString(),
    })
  }

  return handleAuthkitHeaders(request, headers)
}

export const config = {
  matcher: [
    // API resource IDs may end in image extensions; always sanitize their scope.
    "/api/:path*",
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
