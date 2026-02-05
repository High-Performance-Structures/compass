import { NextRequest, NextResponse } from "next/server"
import { getWorkOSClient } from "@/lib/workos-client"

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

  if (
    !provider ||
    !VALID_PROVIDERS.includes(provider as Provider)
  ) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_provider", request.url)
    )
  }

  const workos = getWorkOSClient()
  if (!workos) {
    return NextResponse.redirect(
      new URL("/dashboard", request.url)
    )
  }

  const authorizationUrl =
    workos.userManagement.getAuthorizationUrl({
      provider: provider as Provider,
      clientId: process.env.WORKOS_CLIENT_ID!,
      redirectUri: process.env.WORKOS_REDIRECT_URI!,
      state: from || "/dashboard",
    })

  return NextResponse.redirect(authorizationUrl)
}
