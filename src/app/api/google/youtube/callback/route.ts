import { and, eq } from "drizzle-orm"
import { type NextRequest, NextResponse } from "next/server"

import { getDb } from "@/db"
import { youtubeChannelConnections } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { encrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { getGoogleAccountIdentity } from "@/lib/google/calendar/oauth"
import {
  exchangeYoutubeAuthorizationCode,
  getAuthorizedYoutubeChannel,
  getYoutubeOAuthConfig,
  hasRequiredYoutubeScopes,
  youtubeChannelKey,
  youtubeTokenSalt,
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

function redirectAndClear(
  request: NextRequest,
  projectId: string | null,
  status: string
): NextResponse {
  const response = NextResponse.redirect(redirectUrl(request, projectId, status))
  response.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
  response.cookies.set(CHANNEL_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
  response.cookies.set(PROJECT_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
  return response
}

export async function GET(request: NextRequest): Promise<Response> {
  const projectId = request.cookies.get(PROJECT_COOKIE)?.value ?? null
  const channelKey = youtubeChannelKey(
    request.cookies.get(CHANNEL_COOKIE)?.value ?? null
  )
  const user = await getCurrentUser()
  if (
    !user ||
    isDemoUser(user.id) ||
    !isInternalStaffRole(user.role) ||
    !can(user, "project", "update") ||
    !user.organizationId ||
    !channelKey
  ) {
    return redirectAndClear(request, projectId, "unauthorized")
  }
  const returnedState = request.nextUrl.searchParams.get("state")
  const expectedState = request.cookies.get(STATE_COOKIE)?.value
  if (!returnedState || !expectedState || returnedState !== expectedState) {
    return redirectAndClear(request, projectId, "invalid-state")
  }
  if (request.nextUrl.searchParams.get("error")) {
    return redirectAndClear(request, projectId, "cancelled")
  }
  const code = request.nextUrl.searchParams.get("code")
  if (!code) return redirectAndClear(request, projectId, "missing-code")

  try {
    const { env } = await getCloudflareContext()
    const config = getYoutubeOAuthConfig(env, request.url)
    const db = getDb(env.DB)
    const [existing] = await db
      .select()
      .from(youtubeChannelConnections)
      .where(
        and(
          eq(youtubeChannelConnections.organizationId, user.organizationId),
          eq(youtubeChannelConnections.channelKey, channelKey)
        )
      )
      .limit(1)
    const grant = await exchangeYoutubeAuthorizationCode({ config, code })
    if (!hasRequiredYoutubeScopes(grant.scopes)) {
      return redirectAndClear(request, projectId, "missing-scopes")
    }
    const identity = await getGoogleAccountIdentity(grant.accessToken)
    if (!identity.emailVerified) {
      return redirectAndClear(request, projectId, "email-not-verified")
    }
    const channel = await getAuthorizedYoutubeChannel(grant.accessToken)
    const refreshTokenEncrypted = grant.refreshToken
      ? await encrypt(
          grant.refreshToken,
          config.tokenEncryptionKey,
          youtubeTokenSalt(user.organizationId, channelKey)
        )
      : existing?.refreshTokenEncrypted ?? null
    if (!refreshTokenEncrypted) {
      return redirectAndClear(request, projectId, "missing-refresh-token")
    }
    const now = new Date().toISOString()
    await db
      .insert(youtubeChannelConnections)
      .values({
        id: existing?.id ?? crypto.randomUUID(),
        organizationId: user.organizationId,
        channelKey,
        channelId: channel.id,
        channelTitle: channel.title,
        googleAccountEmail: identity.email,
        refreshTokenEncrypted,
        grantedScopes: [...grant.scopes].sort().join(" "),
        status: "connected",
        connectedBy: user.id,
        connectedAt: now,
        lastUploadAt: existing?.lastUploadAt ?? null,
        lastError: null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          youtubeChannelConnections.organizationId,
          youtubeChannelConnections.channelKey,
        ],
        set: {
          channelId: channel.id,
          channelTitle: channel.title,
          googleAccountEmail: identity.email,
          refreshTokenEncrypted,
          grantedScopes: [...grant.scopes].sort().join(" "),
          status: "connected",
          connectedBy: user.id,
          connectedAt: now,
          lastError: null,
          updatedAt: now,
        },
      })
      .run()
    return redirectAndClear(request, projectId, "connected")
  } catch (error) {
    console.error("YouTube channel connection failed", error)
    return redirectAndClear(request, projectId, "error")
  }
}
