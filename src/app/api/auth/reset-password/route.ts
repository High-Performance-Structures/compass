import { NextRequest, NextResponse } from "next/server"
import { getWorkOS } from "@workos-inc/authkit-nextjs"
import { z } from "zod"

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
})

function mapWorkOSError(error: unknown): string {
  const err = error as { code?: string; message?: string }
  switch (err.code) {
    case "invalid_token":
      return "Invalid or expired reset link. Please request a new one."
    case "password_too_weak":
      return "Password does not meet security requirements."
    default:
      return err.message || "An error occurred. Please try again."
  }
}

export async function POST(request: NextRequest) {
  try {
    // validate input
    const body = await request.json()
    const parseResult = resetPasswordSchema.safeParse(body)

    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0]
      return NextResponse.json(
        { success: false, error: firstIssue?.message || "Invalid input" },
        { status: 400 }
      )
    }

    const { token, newPassword } = parseResult.data

    // check if workos is configured
    const isConfigured =
      process.env.WORKOS_API_KEY &&
      process.env.WORKOS_CLIENT_ID &&
      !process.env.WORKOS_API_KEY.includes("placeholder")

    if (!isConfigured) {
      return NextResponse.json({
        success: true,
        message: "Password reset successful (dev mode)",
      })
    }

    const workos = getWorkOS()
    await workos.userManagement.resetPassword({ token, newPassword })

    return NextResponse.json({
      success: true,
      message: "Password reset successful",
    })
  } catch (error) {
    console.error("Reset password error:", error)
    return NextResponse.json(
      { success: false, error: mapWorkOSError(error) },
      { status: 500 }
    )
  }
}
