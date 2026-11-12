import { NextRequest, NextResponse } from "next/server"
import { getWorkOS } from "@workos-inc/authkit-nextjs"
import { z } from "zod"

import { firstNameSchema, lastNameSchema, newPasswordSchema } from "@/lib/validations/auth"
import {
  isDevAuthFallbackAllowed,
  isWorkOSConfigured,
} from "@/lib/auth-config"

// input validation schema
const signupRequestSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: newPasswordSchema,
  firstName: firstNameSchema,
  lastName: lastNameSchema,
})

/** Shown when the email already has a sign-in (WorkOS only says "Could not create user."). */
const EXISTING_ACCOUNT_MESSAGE =
  "You already have a Compass sign-in with this email. Sign in instead, or use \"Forgot password\" to set a new password."

function errorField(error: unknown, field: "code" | "message"): string | null {
  if (typeof error !== "object" || error === null || !(field in error)) return null
  const value: unknown = Reflect.get(error, field)
  return typeof value === "string" ? value : null
}

function mapWorkOSError(error: unknown): string {
  switch (errorField(error, "code")) {
    case "user_exists":
    case "email_not_available":
      return EXISTING_ACCOUNT_MESSAGE
    case "password_too_weak":
      return "Password does not meet security requirements"
    default:
      return errorField(error, "message") || "An error occurred. Please try again."
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

    // Someone invited earlier already has a sign-in; creating another fails
    // with a bare "Could not create user.", so say what to do instead.
    const existing = await workos.userManagement.listUsers({ email, limit: 1 })
    if (existing.data.length > 0) {
      return NextResponse.json({ success: false, error: EXISTING_ACCOUNT_MESSAGE }, { status: 409 })
    }

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
