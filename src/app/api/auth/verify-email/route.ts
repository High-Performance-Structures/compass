import { NextRequest, NextResponse } from "next/server"
import { getWorkOS } from "@workos-inc/authkit-nextjs"
import { z } from "zod"

const verifyEmailSchema = z.object({
  code: z.string().min(1, "Verification code is required"),
  userId: z.string().min(1, "User ID is required"),
})

function mapWorkOSError(error: unknown): string {
  const err = error as { code?: string; message?: string }
  switch (err.code) {
    case "invalid_code":
      return "Invalid verification code. Please try again."
    case "expired_code":
      return "Code expired. Please request a new one."
    default:
      return err.message || "An error occurred. Please try again."
  }
}

export async function POST(request: NextRequest) {
  try {
    // validate input
    const body = await request.json()
    const parseResult = verifyEmailSchema.safeParse(body)

    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0]
      return NextResponse.json(
        { success: false, error: firstIssue?.message || "Invalid input" },
        { status: 400 }
      )
    }

    const { code, userId } = parseResult.data

    // check if workos is configured
    const isConfigured =
      process.env.WORKOS_API_KEY &&
      process.env.WORKOS_CLIENT_ID &&
      !process.env.WORKOS_API_KEY.includes("placeholder")

    if (!isConfigured) {
      return NextResponse.json({
        success: true,
        message: "Email verified (dev mode)",
      })
    }

    const workos = getWorkOS()
    await workos.userManagement.verifyEmail({ userId, code })

    return NextResponse.json({
      success: true,
      message: "Email verified successfully",
    })
  } catch (error) {
    console.error("Email verification error:", error)
    return NextResponse.json(
      { success: false, error: mapWorkOSError(error) },
      { status: 500 }
    )
  }
}
