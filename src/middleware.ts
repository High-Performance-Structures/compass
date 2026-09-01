import { NextRequest, NextResponse } from "next/server"
import { authkit, handleAuthkitHeaders } from "@workos-inc/authkit-nextjs"
import {
  isDevAuthFallbackAllowed,
  isWorkOSConfigured,
} from "@/lib/auth-config"
import { legacyProjectResolutionPathname } from "@/lib/legacy-project-route"
import { isPublicPath } from "@/lib/public-paths"

function legacyResolutionUrl(request: NextRequest): URL | null {
  if (request.nextUrl.searchParams.get("legacyResolved") === "1") return null
  const pathname = legacyProjectResolutionPathname(
    request.nextUrl.pathname,
    request.nextUrl.search,
  )
  return pathname ? new URL(pathname, request.url) : null
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (!isWorkOSConfigured()) {
    if (isDevAuthFallbackAllowed()) {
      const resolutionUrl = legacyResolutionUrl(request)
      if (resolutionUrl) return NextResponse.redirect(resolutionUrl)
      return NextResponse.next()
    }

    if (isPublicPath(pathname)) {
      return NextResponse.next()
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

  const { session, headers } = await authkit(request)

  if (isPublicPath(pathname)) {
    return handleAuthkitHeaders(request, headers)
  }

  if (!session.user) {
    const isDemoSession = request.cookies.get("compass-demo")?.value === "true"
    if (isDemoSession) {
      const resolutionUrl = legacyResolutionUrl(request)
      if (resolutionUrl) {
        return handleAuthkitHeaders(request, headers, {
          redirect: resolutionUrl.toString(),
        })
      }
      return handleAuthkitHeaders(request, headers)
    }

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
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
