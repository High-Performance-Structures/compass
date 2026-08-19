import { NextRequest, NextResponse } from "next/server"
import { getWorkOS } from "@workos-inc/authkit-nextjs"
import {
  isDevAuthFallbackAllowed,
  isWorkOSConfigured,
} from "@/lib/auth-config"

const VALID_PROVIDERS = [
  "GoogleOAuth",
  "MicrosoftOAuth",
  "GitHubOAuth",
  "AppleOAuth",
] as const

type Provider = (typeof VALID_PROVIDERS)[number]

function isProvider(value: string | null): value is Provider {
  return value !== null && VALID_PROVIDERS.some((provider) => provider === value)
}

export async function GET(request: NextRequest) {
  const provider = request.nextUrl.searchParams.get("provider")
  const from = request.nextUrl.searchParams.get("from")
  const mobile = request.nextUrl.searchParams.get("mobile") === "1"
  const codeChallenge = request.nextUrl.searchParams.get("code_challenge")
  const mobileState = request.nextUrl.searchParams.get("state")

  if (!isProvider(provider)) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_provider", request.url)
    )
  }

  if (!isWorkOSConfigured()) {
    if (!isDevAuthFallbackAllowed()) {
      return NextResponse.redirect(
        new URL("/login?error=auth_unavailable", request.url)
      )
    }

    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  const workos = getWorkOS()

  // derive origin from Host header (nextUrl.origin is wrong on CF Workers)
  const host = request.headers.get("host")
  const proto = request.headers.get("x-forwarded-proto") || "https"
  const origin = host ? `${proto}://${host}` : request.nextUrl.origin
  const redirectUri = `${origin}/api/auth/callback`

  const validChallenge = codeChallenge?.match(/^[A-Za-z0-9_-]{43}$/)?.[0] ?? null
  const validMobileState = mobileState?.match(/^[A-Za-z0-9_-]{32,128}$/)?.[0] ?? null
  if (mobile && (!validChallenge || !validMobileState)) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_mobile_auth", request.url)
    )
  }

  const authorizationUrl = mobile && validChallenge && validMobileState
    ? workos.userManagement.getAuthorizationUrl({
        provider,
        clientId: process.env.WORKOS_CLIENT_ID!,
        redirectUri,
        state: `mobile.${validMobileState}`,
        codeChallenge: validChallenge,
        codeChallengeMethod: "S256",
      })
    : workos.userManagement.getAuthorizationUrl({
        provider,
        clientId: process.env.WORKOS_CLIENT_ID!,
        redirectUri,
        state: from || "/dashboard",
      })

  return NextResponse.redirect(authorizationUrl)
}
