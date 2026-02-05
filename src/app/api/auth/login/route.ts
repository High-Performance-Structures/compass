import { NextRequest, NextResponse } from "next/server"
import { getWorkOSClient, mapWorkOSError } from "@/lib/workos-client"
import { ensureUserExists } from "@/lib/auth"
import { SESSION_COOKIE } from "@/lib/session"

export async function POST(request: NextRequest) {
  try {
    const workos = getWorkOSClient()
    const body = (await request.json()) as {
      type: string
      email: string
      password?: string
      code?: string
    }
    const { type, email, password, code } = body

    if (!workos) {
      return NextResponse.json({
        success: true,
        redirectUrl: "/dashboard",
        devMode: true,
      })
    }

    if (type === "password") {
      const result =
        await workos.userManagement.authenticateWithPassword({
          email,
          password: password!,
          clientId: process.env.WORKOS_CLIENT_ID!,
        })

      await ensureUserExists({
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        profilePictureUrl: result.user.profilePictureUrl,
      })

      const response = NextResponse.json({
        success: true,
        redirectUrl: "/dashboard",
      })

      response.cookies.set(SESSION_COOKIE, result.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      })

      return response
    }

    if (type === "passwordless_send") {
      const magicAuth =
        await workos.userManagement.createMagicAuth({ email })

      return NextResponse.json({
        success: true,
        magicAuthId: magicAuth.id,
      })
    }

    if (type === "passwordless_verify") {
      const result =
        await workos.userManagement.authenticateWithMagicAuth({
          code: code!,
          email,
          clientId: process.env.WORKOS_CLIENT_ID!,
        })

      await ensureUserExists({
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        profilePictureUrl: result.user.profilePictureUrl,
      })

      const response = NextResponse.json({
        success: true,
        redirectUrl: "/dashboard",
      })

      response.cookies.set(SESSION_COOKIE, result.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      })

      return response
    }

    return NextResponse.json(
      { success: false, error: "Invalid login type" },
      { status: 400 }
    )
  } catch (error) {
    console.error("Login error:", error)
    return NextResponse.json(
      { success: false, error: mapWorkOSError(error) },
      { status: 500 }
    )
  }
}
