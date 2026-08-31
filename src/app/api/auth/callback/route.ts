import { NextRequest, NextResponse } from "next/server"
import { getWorkOS, saveSession } from "@workos-inc/authkit-nextjs"
import { ensureUserExists } from "@/lib/auth"
import {
  isDevAuthFallbackAllowed,
  isWorkOSConfigured,
} from "@/lib/auth-config"

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")
  const state = request.nextUrl.searchParams.get("state")
  const authError = request.nextUrl.searchParams.get("error")

  if (state?.startsWith("mobile.")) {
    const callbackUrl = new URL("compass://auth/callback")
    callbackUrl.searchParams.set("state", state.slice("mobile.".length))
    if (code) callbackUrl.searchParams.set("code", code)
    if (authError || !code) callbackUrl.searchParams.set("error", authError ?? "missing_code")
    return new Response(null, {
      status: 302,
      headers: {
        "Cache-Control": "no-store",
        Location: callbackUrl.toString(),
      },
    })
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=missing_code", request.url)
    )
  }

  try {
    if (!isWorkOSConfigured()) {
      if (!isDevAuthFallbackAllowed()) {
        return NextResponse.redirect(
          new URL("/login?error=auth_unavailable", request.url)
        )
      }

      return NextResponse.redirect(new URL("/dashboard", request.url))
    }

    const workos = getWorkOS()

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
    const response = NextResponse.redirect(new URL(redirectTo, request.url))
    response.cookies.delete("compass-demo")
    return response
  } catch (error) {
    console.error("OAuth callback error:", error)
    return NextResponse.redirect(
      new URL("/login?error=auth_failed", request.url)
    )
  }
}
