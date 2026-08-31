import { NextRequest, NextResponse } from "next/server"
import { authkit, handleAuthkitHeaders } from "@workos-inc/authkit-nextjs"
import {
  isDemoSessionAllowed,
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
    const response = handleAuthkitHeaders(request, headers)
    if (
      request.cookies.get("compass-demo")?.value === "true" &&
      !isDemoSessionAllowed("true")
    ) {
      response.cookies.delete("compass-demo")
    }
    return response
  }

  if (!session.user) {
    const demoCookie = request.cookies.get("compass-demo")?.value
    const isDemoSession = isDemoSessionAllowed(demoCookie)
    if (isDemoSession) {
      return handleAuthkitHeaders(request, headers)
    }

    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("from", pathname)
    const response = handleAuthkitHeaders(request, headers, {
      redirect: loginUrl.toString(),
    })
    if (demoCookie === "true") response.cookies.delete("compass-demo")
    return response
  }

  const response = handleAuthkitHeaders(request, headers)
  if (request.cookies.get("compass-demo")?.value === "true") {
    response.cookies.delete("compass-demo")
  }
  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
