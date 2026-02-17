import { NextRequest } from "next/server"
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
  "/demo",
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
    pathname.startsWith("/join/") ||
    bridgePaths.includes(pathname) ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/netsuite/") ||
    pathname.startsWith("/api/google/")
  )
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // get session and headers from authkit (handles token refresh automatically)
  const { session, headers } = await authkit(request)

  // allow public paths
  if (isPublicPath(pathname)) {
    return handleAuthkitHeaders(request, headers)
  }

  const hasDemoCookie =
    request.cookies.get("compass-demo")?.value === "true"

  // real session trumps demo cookie -- clear the stale cookie
  if (session.user && hasDemoCookie) {
    const response = handleAuthkitHeaders(request, headers)
    response.cookies.delete("compass-demo")
    return response
  }

  // demo sessions bypass auth (no real session present)
  if (hasDemoCookie) {
    return handleAuthkitHeaders(request, headers)
  }

  // redirect unauthenticated users to our custom login page
  if (!session.user) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("from", pathname)
    return handleAuthkitHeaders(request, headers, {
      redirect: loginUrl.toString(),
    })
  }

  // authenticated - continue with authkit headers
  return handleAuthkitHeaders(request, headers)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
