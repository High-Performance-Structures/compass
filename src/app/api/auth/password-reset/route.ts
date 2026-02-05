import { NextRequest, NextResponse } from "next/server"
import { getWorkOS } from "@workos-inc/authkit-nextjs"
import { z } from "zod"

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

    // check if workos is configured
    const isConfigured =
      process.env.WORKOS_API_KEY &&
      process.env.WORKOS_CLIENT_ID &&
      !process.env.WORKOS_API_KEY.includes("placeholder")

    if (!isConfigured) {
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
