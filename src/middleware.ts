import { NextRequest, NextResponse } from "next/server"
import {
  applyResponseHeaders,
  authkit,
  handleAuthkitHeaders,
  partitionAuthkitHeaders,
} from "@workos-inc/authkit-nextjs"
import {
  isDevAuthFallbackAllowed,
  isWorkOSConfigured,
} from "@/lib/auth-config"
import { isPublicPath } from "@/lib/public-paths"

export function unauthenticatedApiResponse(
  request: NextRequest,
  authkitHeaders: Headers
): NextResponse {
  const { responseHeaders } = partitionAuthkitHeaders(request, authkitHeaders)
  return applyResponseHeaders(
    NextResponse.json(
      { success: false, error: "Authentication required." },
      { status: 401 }
    ),
    responseHeaders
  )
}

export function unauthenticatedPageUrl(
  request: NextRequest,
  error?: string
): URL {
  const loginUrl = new URL("/login", request.url)
  loginUrl.searchParams.set("from", request.nextUrl.pathname)
  if (error) loginUrl.searchParams.set("error", error)

  const nativePlatform = request.nextUrl.searchParams.get("nativePlatform")
  if (nativePlatform === "ios" || nativePlatform === "android") {
    loginUrl.searchParams.set("nativePlatform", nativePlatform)
  }

  return loginUrl
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (!isWorkOSConfigured()) {
    if (isDevAuthFallbackAllowed()) {
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

    return NextResponse.redirect(
      unauthenticatedPageUrl(request, "auth_unavailable")
    )
  }

  const { session, headers } = await authkit(request)

  if (isPublicPath(pathname)) {
    return handleAuthkitHeaders(request, headers)
  }

  if (!session.user) {
    const isDemoSession = request.cookies.get("compass-demo")?.value === "true"
    if (isDemoSession) {
      return handleAuthkitHeaders(request, headers)
    }

    if (pathname.startsWith("/api/")) {
      return unauthenticatedApiResponse(request, headers)
    }

    const loginUrl = unauthenticatedPageUrl(request)
    return handleAuthkitHeaders(request, headers, { redirect: loginUrl.toString() })
  }

  return handleAuthkitHeaders(request, headers)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
