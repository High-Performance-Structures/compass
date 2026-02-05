import { NextRequest, NextResponse } from "next/server"
import { getWorkOS, saveSession } from "@workos-inc/authkit-nextjs"
import { ensureUserExists } from "@/lib/auth"

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")
  const state = request.nextUrl.searchParams.get("state")

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=missing_code", request.url)
    )
  }

  try {
    const workos = getWorkOS()

    // check if workos is configured (dev mode fallback)
    const isConfigured =
      process.env.WORKOS_API_KEY &&
      process.env.WORKOS_CLIENT_ID &&
      !process.env.WORKOS_API_KEY.includes("placeholder")

    if (!isConfigured) {
      return NextResponse.redirect(new URL("/dashboard", request.url))
    }

    const result = await workos.userManagement.authenticateWithCode({
      code,
      clientId: process.env.WORKOS_CLIENT_ID!,
    })

    // sync user to our database
    await ensureUserExists({
      id: result.user.id,
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      profilePictureUrl: result.user.profilePictureUrl,
    })

    // save session with BOTH access and refresh tokens
    await saveSession(
      {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
        impersonator: result.impersonator,
      },
      request
    )

    const redirectTo = state || "/dashboard"
    return NextResponse.redirect(new URL(redirectTo, request.url))
  } catch (error) {
    console.error("OAuth callback error:", error)
    return NextResponse.redirect(
      new URL("/login?error=auth_failed", request.url)
    )
  }
}
