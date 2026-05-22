import { NextRequest, NextResponse } from "next/server"
import { getWorkOS } from "@workos-inc/authkit-nextjs"
import { z } from "zod"
import {
  isDevAuthFallbackAllowed,
  isWorkOSConfigured,
} from "@/lib/auth-config"

const passwordResetSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
})

export async function POST(request: NextRequest) {
  try {
    // validate input
    const body = await request.json()
    const parseResult = passwordResetSchema.safeParse(body)

    if (!parseResult.success) {
      // still return success to prevent email enumeration
      return NextResponse.json({
        success: true,
        message: "If an account exists, a reset link has been sent",
      })
    }

    const { email } = parseResult.data

    if (!isWorkOSConfigured()) {
      if (!isDevAuthFallbackAllowed()) {
        return NextResponse.json(
          { success: false, error: "Authentication is not configured." },
          { status: 503 }
        )
      }

      return NextResponse.json({
        success: true,
        message: "Password reset link sent (dev mode)",
      })
    }

    const workos = getWorkOS()
    await workos.userManagement.createPasswordReset({ email })

    return NextResponse.json({
      success: true,
      message: "If an account exists, a reset link has been sent",
    })
  } catch (error) {
    console.error("Password reset error:", error)
    // always return success to prevent email enumeration
    return NextResponse.json({
      success: true,
      message: "If an account exists, a reset link has been sent",
    })
  }
}
