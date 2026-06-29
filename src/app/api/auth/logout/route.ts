import { NextResponse, type NextRequest } from "next/server"

const DEFAULT_WORKOS_COOKIE_NAME = "wos-session"
const PKCE_COOKIE_PREFIX = "wos-auth-verifier"

function cookieSameSite(): "lax" | "strict" | "none" | undefined {
  const sameSite = process.env.WORKOS_COOKIE_SAMESITE

  if (sameSite === "lax" || sameSite === "strict" || sameSite === "none") {
    return sameSite
  }

  return undefined
}

function expireCookie(response: NextResponse, name: string): void {
  response.cookies.set({
    name,
    value: "",
    domain: process.env.WORKOS_COOKIE_DOMAIN,
    path: "/",
    sameSite: cookieSameSite(),
    secure: true,
    httpOnly: true,
    maxAge: 0,
  })
}

export function GET(request: NextRequest): NextResponse {
  const loginUrl = new URL("/login", request.url)
  loginUrl.searchParams.set("logged_out", "1")

  const response = NextResponse.redirect(loginUrl)
  const sessionCookieName =
    process.env.WORKOS_COOKIE_NAME ?? DEFAULT_WORKOS_COOKIE_NAME

  expireCookie(response, sessionCookieName)

  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith(PKCE_COOKIE_PREFIX)) {
      expireCookie(response, cookie.name)
    }
  }

  return response
}
