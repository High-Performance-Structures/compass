import { NextRequest, NextResponse } from "next/server"
import { authkit, handleAuthkitHeaders } from "@workos-inc/authkit-nextjs"

const publicPaths = [
  "/",
  "/login",
  "/signup",
  "/reset-password",
  "/verify-email",
  "/invite",
  "/callback",
]

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

const isWorkOSConfigured =
  process.env.WORKOS_API_KEY &&
  process.env.WORKOS_CLIENT_ID &&
  !process.env.WORKOS_API_KEY.includes("placeholder")

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (!isWorkOSConfigured) {
    return NextResponse.next()
  }

  const { session, headers } = await authkit(request)

  if (isPublicPath(pathname)) {
    return handleAuthkitHeaders(request, headers)
  }

  if (!session.user) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("from", pathname)
    return handleAuthkitHeaders(request, headers, { redirect: loginUrl.toString() })
  }

  return handleAuthkitHeaders(request, headers)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
