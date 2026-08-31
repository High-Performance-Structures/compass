import { type NextRequest, NextResponse } from "next/server"

import { getDb } from "@/db"
import { socialConnectionDrafts } from "@/db/schema-social"
import { getCurrentUser } from "@/lib/auth"
import { encrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { can } from "@/lib/permissions"
import { getSocialConfig } from "@/lib/social/config"
import {
  exchangeMetaAuthorizationCode,
  getManagedMetaPages,
  hasRequiredMetaCandidateScopes,
} from "@/lib/social/meta"
import {
  isExpectedFacebookPage,
  isExpectedInstagramProfile,
  socialDepartment,
} from "@/lib/social/types"
import { isInternalStaffRole } from "@/lib/user-roles"

const STATE_COOKIE = "compass_social_meta_state"
const DEPARTMENT_COOKIE = "compass_social_meta_department"

function redirectAndClear(
  request: NextRequest,
  status: string,
  draftId?: string,
): NextResponse {
  const url = new URL("/dashboard/settings", request.url)
  url.searchParams.set("social", status)
  if (draftId) url.searchParams.set("social-draft", draftId)
  const response = NextResponse.redirect(url)
  for (const name of [STATE_COOKIE, DEPARTMENT_COOKIE]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    })
  }
  return response
}

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getCurrentUser()
  const department = socialDepartment(request.cookies.get(DEPARTMENT_COOKIE)?.value ?? "")
  const returnedState = request.nextUrl.searchParams.get("state")
  const expectedState = request.cookies.get(STATE_COOKIE)?.value
  if (
    !user ||
    !user.organizationId ||
    !department ||
    !isInternalStaffRole(user.role) ||
    !can(user, "organization", "update") ||
    !returnedState ||
    !expectedState ||
    returnedState !== expectedState
  ) {
    return redirectAndClear(request, "unauthorized")
  }
  if (request.nextUrl.searchParams.get("error")) {
    return redirectAndClear(request, "cancelled")
  }
  const code = request.nextUrl.searchParams.get("code")
  if (!code) return redirectAndClear(request, "missing-code")

  try {
    const { env } = await getCloudflareContext()
    const config = getSocialConfig(env, request.url)
    if (!config.metaAppId || !config.metaAppSecret) {
      return redirectAndClear(request, "meta-not-configured")
    }
    const redirectUri = `${config.publicBaseUrl}/api/social/meta/callback`
    const userAccessToken = await exchangeMetaAuthorizationCode({
      apiVersion: config.metaApiVersion,
      appId: config.metaAppId,
      appSecret: config.metaAppSecret,
      redirectUri,
      code,
    })
    const discoveredCandidates = await getManagedMetaPages({
      apiVersion: config.metaApiVersion,
      appId: config.metaAppId,
      appSecret: config.metaAppSecret,
      userAccessToken,
    })
    if (discoveredCandidates.length === 0) {
      return redirectAndClear(request, "no-meta-pages")
    }
    const expectedPageCandidates = discoveredCandidates.filter((candidate) =>
      isExpectedFacebookPage(department, candidate.pageName)
    )
    if (
      expectedPageCandidates.length > 0 &&
      !expectedPageCandidates.some((candidate) =>
        isExpectedInstagramProfile(department, candidate.instagramUsername) &&
        hasRequiredMetaCandidateScopes(candidate)
      )
    ) {
      return redirectAndClear(request, "meta-permissions-missing")
    }
    const candidates = discoveredCandidates.filter(hasRequiredMetaCandidateScopes)
    if (candidates.length === 0) {
      return redirectAndClear(request, "meta-permissions-missing")
    }

    const id = crypto.randomUUID()
    const now = new Date()
    const db = getDb(env.DB)
    await db.insert(socialConnectionDrafts).values({
      id,
      organizationId: user.organizationId,
      userId: user.id,
      provider: "meta",
      department,
      candidatesEncrypted: await encrypt(
        JSON.stringify(candidates),
        config.tokenEncryptionKey,
        `compass-social-draft:${id}`,
      ),
      expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
      createdAt: now.toISOString(),
    }).run()
    return redirectAndClear(request, "select-meta-page", id)
  } catch (error) {
    console.error("Meta social connection failed", error)
    return redirectAndClear(request, "error")
  }
}
