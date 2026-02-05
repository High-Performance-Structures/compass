import { NextRequest, NextResponse } from "next/server"
import { getWorkOSClient } from "@/lib/workos-client"
import { ensureUserExists } from "@/lib/auth"
import { SESSION_COOKIE } from "@/lib/session"

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")
  const state = request.nextUrl.searchParams.get("state")

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=missing_code", request.url)
    )
  }

  try {
    const workos = getWorkOSClient()
    if (!workos) {
      return NextResponse.redirect(
        new URL("/dashboard", request.url)
      )
    }

    const result =
      await workos.userManagement.authenticateWithCode({
        code,
        clientId: process.env.WORKOS_CLIENT_ID!,
      })

    await ensureUserExists({
      id: result.user.id,
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      profilePictureUrl: result.user.profilePictureUrl,
    })

    const redirectTo = state || "/dashboard"
    const response = NextResponse.redirect(
      new URL(redirectTo, request.url)
    )

    response.cookies.set(SESSION_COOKIE, result.accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    })

    return response
  } catch (error) {
    console.error("OAuth callback error:", error)
    return NextResponse.redirect(
      new URL("/login?error=auth_failed", request.url)
    )
  }
}
