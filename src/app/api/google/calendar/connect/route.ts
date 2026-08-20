import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import {
  getGoogleCalendarOAuthConfig,
} from "@/lib/google/calendar/config"
import { buildGoogleCalendarAuthorizationUrl } from "@/lib/google/calendar/oauth"
import { canConnectGoogleCalendar } from "@/lib/google/calendar/policy"
import { can } from "@/lib/permissions"

const OAUTH_STATE_COOKIE = "compass_google_calendar_oauth_state"

function settingsUrl(request: Request, status: string): URL {
  const url = new URL("/dashboard/settings", request.url)
  url.searchParams.set("google-calendar", status)
  return url
}

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser()
  if (
    !user ||
    !canConnectGoogleCalendar({ userId: user.id, role: user.role }) ||
    !can(user, "schedule", "read") ||
    !user.organizationId
  ) {
    return NextResponse.redirect(settingsUrl(request, "unauthorized"))
  }

  const { env } = await getCloudflareContext()
  const configuration = getGoogleCalendarOAuthConfig(env)
  if (!configuration.configured) {
    return NextResponse.redirect(settingsUrl(request, "not-configured"))
  }

  const state = crypto.randomUUID()
  const authorizationUrl = buildGoogleCalendarAuthorizationUrl(
    configuration.config,
    state,
    user.googleEmail ?? user.email,
  )
  const response = NextResponse.redirect(authorizationUrl)
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  })
  return response
}
