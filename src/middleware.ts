import { NextRequest, NextResponse } from "next/server"
import { authkit, handleAuthkitHeaders } from "@workos-inc/authkit-nextjs"
import { isLocalDevelopment, isWorkOSConfigured } from "@/lib/auth-config"

const publicPaths = [
  "/",
  "/login",
  "/signup",
  "/reset-password",
  "/verify-email",
  "/invite",
  "/callback",
  "/demo",
  "/manifest.json",
]

const bridgePaths = [
  "/api/bridge/register",
  "/api/bridge/tools",
  "/api/bridge/context",
]

const machineAuthPaths = [
  "/api/email/gmail-sync",
]

function isPublicPath(pathname: string): boolean {
  return (
    publicPaths.includes(pathname) ||
    bridgePaths.includes(pathname) ||
    machineAuthPaths.includes(pathname) ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/netsuite/") ||
    pathname.startsWith("/api/google/")
  )
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (!isWorkOSConfigured()) {
    if (isLocalDevelopment()) {
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
