import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { SESSION_COOKIE, isTokenExpired } from "@/lib/session"

const isWorkOSConfigured =
  process.env.WORKOS_API_KEY &&
  process.env.WORKOS_CLIENT_ID &&
  !process.env.WORKOS_API_KEY.includes("placeholder")

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (!isWorkOSConfigured) {
    return NextResponse.next()
  }

  const publicRoutes = [
    "/login",
    "/signup",
    "/reset-password",
    "/verify-email",
    "/invite",
    "/api/auth",
    "/callback",
  ]

  if (
    publicRoutes.some((route) => pathname.startsWith(route))
  ) {
    return NextResponse.next()
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value

  if (!token || isTokenExpired(token)) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("from", pathname)
    const response = NextResponse.redirect(loginUrl)
    if (token) response.cookies.delete(SESSION_COOKIE)
    return response
  }

  const response = NextResponse.next()
  response.headers.set("X-Frame-Options", "DENY")
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  )
  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
