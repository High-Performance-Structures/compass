import { NextRequest, NextResponse } from "next/server"
import { getWorkOS, saveSession } from "@workos-inc/authkit-nextjs"
import { z } from "zod"
import { ensureUserExists } from "@/lib/auth"

// input validation schema
const loginRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("password"),
    email: z.string().email("Please enter a valid email address"),
    password: z.string().min(1, "Password is required"),
  }),
  z.object({
    type: z.literal("passwordless_send"),
    email: z.string().email("Please enter a valid email address"),
  }),
  z.object({
    type: z.literal("passwordless_verify"),
    email: z.string().email("Please enter a valid email address"),
    code: z.string().min(1, "Verification code is required"),
  }),
])

function mapWorkOSError(error: unknown): string {
  const err = error as { code?: string; message?: string }
  switch (err.code) {
    case "invalid_credentials":
      return "Invalid email or password"
    case "user_not_found":
      return "No account found with this email"
    case "expired_code":
      return "Code expired. Please request a new one."
    case "invalid_code":
      return "Invalid code. Please try again."
    default:
      return err.message || "An error occurred. Please try again."
  }
}

export async function POST(request: NextRequest) {
  try {
    // validate input
    const body = await request.json()
    const parseResult = loginRequestSchema.safeParse(body)

    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0]
      return NextResponse.json(
        { success: false, error: firstIssue?.message || "Invalid input" },
        { status: 400 }
      )
    }

    const data = parseResult.data
    const workos = getWorkOS()

    // check if workos is configured (dev mode fallback)
    const isConfigured =
      process.env.WORKOS_API_KEY &&
      process.env.WORKOS_CLIENT_ID &&
      !process.env.WORKOS_API_KEY.includes("placeholder")

    if (!isConfigured) {
      return NextResponse.json({
        success: true,
        redirectUrl: "/dashboard",
        devMode: true,
      })
    }

    if (data.type === "password") {
      const result = await workos.userManagement.authenticateWithPassword({
        email: data.email,
        password: data.password,
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

      // save session with BOTH access and refresh tokens (fixes 30-second logout)
      await saveSession(
        {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          user: result.user,
          impersonator: result.impersonator,
        },
        request
      )

      return NextResponse.json({
        success: true,
        redirectUrl: "/dashboard",
      })
    }

    if (data.type === "passwordless_send") {
      const magicAuth = await workos.userManagement.createMagicAuth({
        email: data.email,
      })

      return NextResponse.json({
        success: true,
        magicAuthId: magicAuth.id,
      })
    }

    if (data.type === "passwordless_verify") {
      const result = await workos.userManagement.authenticateWithMagicAuth({
        code: data.code,
        email: data.email,
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

      return NextResponse.json({
        success: true,
        redirectUrl: "/dashboard",
      })
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
