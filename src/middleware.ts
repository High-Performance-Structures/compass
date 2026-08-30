import { NextRequest, NextResponse } from "next/server"
import { authkit, handleAuthkitHeaders } from "@workos-inc/authkit-nextjs"
import {
  isDevAuthFallbackAllowed,
  isWorkOSConfigured,
} from "@/lib/auth-config"
import { decodedLegacyProjectPathname } from "@/lib/legacy-project-route"
import { isPublicPath } from "@/lib/public-paths"

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const decodedLegacyPathname = decodedLegacyProjectPathname(pathname)
  if (decodedLegacyPathname) {
    const decodedUrl = request.nextUrl.clone()
    decodedUrl.pathname = decodedLegacyPathname
    return NextResponse.redirect(decodedUrl)
  }

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

    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("error", "auth_unavailable")
    loginUrl.searchParams.set("from", pathname)
    return NextResponse.redirect(loginUrl)
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

    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("from", pathname)
    return handleAuthkitHeaders(request, headers, { redirect: loginUrl.toString() })
  }

  return handleAuthkitHeaders(request, headers)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
