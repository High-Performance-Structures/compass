import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import {
  buildYoutubeAuthorizationUrl,
  getYoutubeOAuthConfig,
  youtubeChannelKey,
} from "@/lib/google/youtube"
import { can } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"

const STATE_COOKIE = "compass_youtube_oauth_state"
const CHANNEL_COOKIE = "compass_youtube_oauth_channel"
const PROJECT_COOKIE = "compass_youtube_oauth_project"

function redirectUrl(request: Request, projectId: string | null, status: string): URL {
  const path = projectId
    ? `/dashboard/projects/${encodeURIComponent(projectId)}/videos`
    : "/dashboard/projects"
  const url = new URL(path, request.url)
  url.searchParams.set("youtube", status)
  return url
}

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url)
  const channelKey = youtubeChannelKey(requestUrl.searchParams.get("channel"))
  const projectId = requestUrl.searchParams.get("project")
  const user = await getCurrentUser()
  if (
    !user ||
    isDemoUser(user.id) ||
    !isInternalStaffRole(user.role) ||
    !can(user, "project", "update") ||
    !user.organizationId ||
    !channelKey
  ) {
    return NextResponse.redirect(redirectUrl(request, projectId, "unauthorized"))
  }

  try {
    const { env } = await getCloudflareContext()
    const config = getYoutubeOAuthConfig(env, request.url)
    const state = crypto.randomUUID()
    const response = NextResponse.redirect(
      buildYoutubeAuthorizationUrl({
        config,
        state,
        loginHint: user.googleEmail ?? user.email,
      })
    )
    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60,
    })
    response.cookies.set(CHANNEL_COOKIE, channelKey, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60,
    })
    if (projectId) {
      response.cookies.set(PROJECT_COOKIE, projectId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 10 * 60,
      })
    }
    return response
  } catch {
    return NextResponse.redirect(redirectUrl(request, projectId, "not-configured"))
  }
}
