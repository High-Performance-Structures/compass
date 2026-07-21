import { NextRequest, NextResponse } from "next/server"
import { getWorkOS, saveSession } from "@workos-inc/authkit-nextjs"
import { z } from "zod/v4"

import { ensureUserExists } from "@/lib/auth"
import { isWorkOSConfigured } from "@/lib/auth-config"

const mobileSessionSchema = z.object({
  code: z.string().min(8).max(2048),
  codeVerifier: z.string().min(43).max(128).regex(/^[A-Za-z0-9._~-]+$/),
})

export async function POST(request: NextRequest): Promise<Response> {
  if (!isWorkOSConfigured()) {
    return NextResponse.redirect(new URL("/login?error=auth_unavailable", request.url), 303)
  }

  const formData = await request.formData()
  const parsed = mobileSessionSchema.safeParse({
    code: formData.get("code"),
    codeVerifier: formData.get("codeVerifier"),
  })
  if (!parsed.success) {
    return NextResponse.redirect(new URL("/login?error=invalid_mobile_auth", request.url), 303)
  }

  try {
    const result = await getWorkOS().userManagement.authenticateWithCode({
      code: parsed.data.code,
      codeVerifier: parsed.data.codeVerifier,
      clientId: process.env.WORKOS_CLIENT_ID!,
    })

    await ensureUserExists({
      id: result.user.id,
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      profilePictureUrl: result.user.profilePictureUrl,
    })
    await saveSession(
      {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
        impersonator: result.impersonator,
        authenticationMethod: result.authenticationMethod,
      },
      request
    )

    return NextResponse.redirect(new URL("/dashboard/field", request.url), 303)
  } catch (error) {
    console.error("Mobile OAuth session exchange failed:", error)
    return NextResponse.redirect(new URL("/login?error=auth_failed", request.url), 303)
  }
}
