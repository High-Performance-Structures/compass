import { and, eq } from "drizzle-orm"
import { type NextRequest, NextResponse } from "next/server"

import { getDb } from "@/db"
import { googleCalendarConnections } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { encrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import {
  getGoogleCalendarOAuthConfig,
  googleCalendarTokenSalt,
} from "@/lib/google/calendar/config"
import {
  exchangeGoogleAuthorizationCode,
  getGoogleAccountIdentity,
  hasRequiredGoogleCalendarScopes,
} from "@/lib/google/calendar/oauth"
import { canConnectGoogleCalendar } from "@/lib/google/calendar/policy"
import { can } from "@/lib/permissions"

const OAUTH_STATE_COOKIE = "compass_google_calendar_oauth_state"

function settingsUrl(request: Request, status: string): URL {
  const url = new URL("/dashboard/settings", request.url)
  url.searchParams.set("google-calendar", status)
  return url
}

function redirectAndClearState(
  request: Request,
  status: string,
): NextResponse {
  const response = NextResponse.redirect(settingsUrl(request, status))
  response.cookies.set(OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
  return response
}

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getCurrentUser()
  if (
    !user ||
    !canConnectGoogleCalendar({ userId: user.id, role: user.role }) ||
    !can(user, "schedule", "read") ||
    !user.organizationId
  ) {
    return redirectAndClearState(request, "unauthorized")
  }

  const returnedState = request.nextUrl.searchParams.get("state")
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value
  if (
    !returnedState ||
    !expectedState ||
    returnedState !== expectedState
  ) {
    return redirectAndClearState(request, "invalid-state")
  }

  const oauthError = request.nextUrl.searchParams.get("error")
  if (oauthError) {
    return redirectAndClearState(request, "cancelled")
  }
  const code = request.nextUrl.searchParams.get("code")
  if (!code) {
    return redirectAndClearState(request, "missing-code")
  }

  try {
    const { env } = await getCloudflareContext()
    const configuration = getGoogleCalendarOAuthConfig(env)
    if (!configuration.configured) {
      return redirectAndClearState(request, "not-configured")
    }

    const db = getDb(env.DB)
    const existingConnection = await db
      .select({
        id: googleCalendarConnections.id,
        refreshTokenEncrypted:
          googleCalendarConnections.refreshTokenEncrypted,
        createdAt: googleCalendarConnections.createdAt,
      })
      .from(googleCalendarConnections)
      .where(
        and(
          eq(
            googleCalendarConnections.organizationId,
            user.organizationId,
          ),
          eq(googleCalendarConnections.userId, user.id),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

    const grant = await exchangeGoogleAuthorizationCode(
      configuration.config,
      code,
    )
    if (!hasRequiredGoogleCalendarScopes(grant.scopes)) {
      return redirectAndClearState(request, "missing-scopes")
    }
    const identity = await getGoogleAccountIdentity(grant.accessToken)
    if (!identity.emailVerified) {
      return redirectAndClearState(request, "email-not-verified")
    }

    const encryptedRefreshToken = grant.refreshToken
      ? await encrypt(
          grant.refreshToken,
          configuration.config.tokenEncryptionKey,
          googleCalendarTokenSalt(user.id),
        )
      : existingConnection?.refreshTokenEncrypted ?? null
    if (!encryptedRefreshToken) {
      return redirectAndClearState(request, "missing-refresh-token")
    }

    const now = new Date().toISOString()
    const connectionId =
      existingConnection?.id ?? crypto.randomUUID()
    await db
      .insert(googleCalendarConnections)
      .values({
        id: connectionId,
        organizationId: user.organizationId,
        userId: user.id,
        googleAccountId: identity.subject,
        googleAccountEmail: identity.email,
        refreshTokenEncrypted: encryptedRefreshToken,
        grantedScopes: [...grant.scopes].sort().join(" "),
        status: "connected",
        calendarSyncEnabled: false,
        tasksSyncEnabled: false,
        connectedAt: now,
        lastSyncedAt: null,
        lastError: null,
        createdAt: existingConnection?.createdAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          googleCalendarConnections.organizationId,
          googleCalendarConnections.userId,
        ],
        set: {
          googleAccountId: identity.subject,
          googleAccountEmail: identity.email,
          refreshTokenEncrypted: encryptedRefreshToken,
          grantedScopes: [...grant.scopes].sort().join(" "),
          status: "connected",
          connectedAt: now,
          lastError: null,
          updatedAt: now,
        },
      })
      .run()

    return redirectAndClearState(request, "connected")
  } catch {
    return redirectAndClearState(request, "error")
  }
}
