import { NextRequest, NextResponse } from "next/server"
import { authkit, handleAuthkitHeaders } from "@workos-inc/authkit-nextjs"

// public routes that don't require authentication
const publicPaths = [
  "/",
  "/login",
  "/signup",
  "/reset-password",
  "/verify-email",
  "/invite",
  "/callback",
]

// bridge routes use their own API key auth
const bridgePaths = [
  "/api/bridge/register",
  "/api/bridge/tools",
  "/api/bridge/context",
]

function isPublicPath(pathname: string): boolean {
  return (
    publicPaths.includes(pathname) ||
    bridgePaths.includes(pathname) ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/netsuite/") ||
    pathname.startsWith("/api/google/")
  )
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // DEVELOPMENT BYPASS: Skip all authentication in development mode
  if (process.env.BYPASS_AUTH === "true") {
    // Allow all paths through without authentication
    return NextResponse.next()
  }

  // get session and headers from authkit (handles token refresh automatically)
  const { session, headers } = await authkit(request)

  // allow public paths
  if (isPublicPath(pathname)) {
    return handleAuthkitHeaders(request, headers)
  }

  // redirect unauthenticated users to our custom login page
  if (!session.user) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("from", pathname)
    return handleAuthkitHeaders(request, headers, { redirect: loginUrl.toString() })
  }

  // authenticated - continue with authkit headers
  return handleAuthkitHeaders(request, headers)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
