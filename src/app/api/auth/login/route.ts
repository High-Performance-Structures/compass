import { NextRequest, NextResponse } from "next/server"
import { getWorkOS, saveSession } from "@workos-inc/authkit-nextjs"
import { z } from "zod"
import { ensureUserExists } from "@/lib/auth"
import {
  isDevAuthFallbackAllowed,
  isWorkOSConfigured,
} from "@/lib/auth-config"

const WORKOS_AUTH_TIMEOUT_MS = 12_000

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

function workOSTimeoutError(label: string): Error {
  const error = new Error(
    `${label} is taking longer than expected. Please try again.`
  )
  error.name = "WorkOSTimeoutError"
  return error
}

async function withWorkOSTimeout<T>(
  operation: Promise<T>,
  label: string
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(workOSTimeoutError(label))
    }, WORKOS_AUTH_TIMEOUT_MS)
  })

  try {
    return await Promise.race([operation, timeoutPromise])
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout)
    }
  }
}

function mapWorkOSError(error: unknown): string {
  if (error instanceof Error && error.name === "WorkOSTimeoutError") {
    return error.message
  }

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
      return "Compass could not complete sign-in. Please try again."
  }
}

function statusForLoginError(error: unknown): number {
  if (error instanceof Error && error.name === "WorkOSTimeoutError") return 504

  const err = error as { code?: string }
  const isAuthError = [
    "invalid_credentials",
    "user_not_found",
    "expired_code",
    "invalid_code",
  ].includes(err.code || "")

  return isAuthError ? 401 : 500
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

    if (!isWorkOSConfigured()) {
      if (!isDevAuthFallbackAllowed()) {
        return NextResponse.json(
          { success: false, error: "Authentication is not configured." },
          { status: 503 }
        )
      }

      return NextResponse.json({
        success: true,
        redirectUrl: "/dashboard",
        devMode: true,
      })
    }

    const workos = getWorkOS()

    if (data.type === "password") {
      const result = await withWorkOSTimeout(
        workos.userManagement.authenticateWithPassword({
          email: data.email,
          password: data.password,
          clientId: process.env.WORKOS_CLIENT_ID!,
        }),
        "Password sign-in"
      )

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

      const response = NextResponse.json({
        success: true,
        redirectUrl: "/dashboard",
      })
      response.cookies.delete("compass-demo")
      return response
    }

    if (data.type === "passwordless_send") {
      const magicAuth = await withWorkOSTimeout(
        workos.userManagement.createMagicAuth({
          email: data.email,
        }),
        "Sign-in code delivery"
      )

      return NextResponse.json({
        success: true,
        magicAuthId: magicAuth.id,
      })
    }

    if (data.type === "passwordless_verify") {
      const result = await withWorkOSTimeout(
        workos.userManagement.authenticateWithMagicAuth({
          code: data.code,
          email: data.email,
          clientId: process.env.WORKOS_CLIENT_ID!,
        }),
        "Sign-in code verification"
      )

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

      const response = NextResponse.json({
        success: true,
        redirectUrl: "/dashboard",
      })
      response.cookies.delete("compass-demo")
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
      { status: statusForLoginError(error) }
    )
  }
}
