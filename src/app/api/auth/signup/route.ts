import { NextRequest, NextResponse } from "next/server"
import { getWorkOS } from "@workos-inc/authkit-nextjs"
import { z } from "zod"
import {
  isDevAuthFallbackAllowed,
  isWorkOSConfigured,
} from "@/lib/auth-config"

// input validation schema
const signupRequestSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  firstName: z
    .string()
    .min(1, "First name is required")
    .max(50, "First name must be 50 characters or less"),
  lastName: z
    .string()
    .min(1, "Last name is required")
    .max(50, "Last name must be 50 characters or less"),
})

function mapWorkOSError(error: unknown): string {
  const err = error as { code?: string; message?: string }
  switch (err.code) {
    case "user_exists":
      return "An account with this email already exists"
    case "password_too_weak":
      return "Password does not meet security requirements"
    default:
      return err.message || "An error occurred. Please try again."
  }
}

export async function POST(request: NextRequest) {
  try {
    // validate input
    const body = await request.json()
    const parseResult = signupRequestSchema.safeParse(body)

    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0]
      return NextResponse.json(
        { success: false, error: firstIssue?.message || "Invalid input" },
        { status: 400 }
      )
    }

    const { email, password, firstName, lastName } = parseResult.data

    if (!isWorkOSConfigured()) {
      if (!isDevAuthFallbackAllowed()) {
        return NextResponse.json(
          { success: false, error: "Authentication is not configured." },
          { status: 503 }
        )
      }

      return NextResponse.json({
        success: true,
        userId: "dev-user-" + Date.now(),
        message: "Account created (dev mode)",
      })
    }

    const workos = getWorkOS()

    const user = await workos.userManagement.createUser({
      email,
      password,
      firstName,
      lastName,
      emailVerified: false,
    })

    await workos.userManagement.sendVerificationEmail({
      userId: user.id,
    })

    return NextResponse.json({
      success: true,
      userId: user.id,
      message: "Account created. Please check your email to verify.",
    })
  } catch (error) {
    console.error("Signup error:", error)
    return NextResponse.json(
      { success: false, error: mapWorkOSError(error) },
      { status: 500 }
    )
  }
}
