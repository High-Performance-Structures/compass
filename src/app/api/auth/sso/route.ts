import { NextRequest, NextResponse } from "next/server"
import { getWorkOS } from "@workos-inc/authkit-nextjs"

const VALID_PROVIDERS = [
  "GoogleOAuth",
  "MicrosoftOAuth",
  "GitHubOAuth",
  "AppleOAuth",
] as const

type Provider = (typeof VALID_PROVIDERS)[number]

export async function GET(request: NextRequest) {
  const provider = request.nextUrl.searchParams.get("provider")
  const from = request.nextUrl.searchParams.get("from")

  if (!provider || !VALID_PROVIDERS.includes(provider as Provider)) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_provider", request.url)
    )
  }

  // check if workos is configured (dev mode fallback)
  const isConfigured =
    process.env.WORKOS_API_KEY &&
    process.env.WORKOS_CLIENT_ID &&
    !process.env.WORKOS_API_KEY.includes("placeholder")

  if (!isConfigured) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  const workos = getWorkOS()

  const authorizationUrl = workos.userManagement.getAuthorizationUrl({
    provider: provider as Provider,
    clientId: process.env.WORKOS_CLIENT_ID!,
    redirectUri: process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI!,
    state: from || "/dashboard",
  })

  return NextResponse.redirect(authorizationUrl)
}
