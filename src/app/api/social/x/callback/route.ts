import { type NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { socialAccounts } from "@/db/schema-social"
import { getCurrentUser } from "@/lib/auth"
import { encrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { can } from "@/lib/permissions"
import { getSocialConfig, socialTokenSalt } from "@/lib/social/config"
import {
  isExpectedXProfile,
  socialDepartment,
} from "@/lib/social/types"
import {
  exchangeXAuthorizationCode,
  getXIdentity,
} from "@/lib/social/x"
import { isInternalStaffRole } from "@/lib/user-roles"

const STATE_COOKIE = "compass_social_x_state"
const VERIFIER_COOKIE = "compass_social_x_verifier"
const DEPARTMENT_COOKIE = "compass_social_x_department"

function redirectAndClear(request: NextRequest, status: string): NextResponse {
  const url = new URL("/dashboard/settings", request.url)
  url.searchParams.set("social", status)
  const response = NextResponse.redirect(url)
  for (const name of [STATE_COOKIE, VERIFIER_COOKIE, DEPARTMENT_COOKIE]) {
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
  const codeVerifier = request.cookies.get(VERIFIER_COOKIE)?.value
  if (
    !user ||
    !user.organizationId ||
    !department ||
    !isInternalStaffRole(user.role) ||
    !can(user, "organization", "update") ||
    !returnedState ||
    !expectedState ||
    returnedState !== expectedState ||
    !codeVerifier
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
    if (!config.xClientId) return redirectAndClear(request, "x-not-configured")
    const redirectUri = `${config.publicBaseUrl}/api/social/x/callback`
    const grant = await exchangeXAuthorizationCode({
      clientId: config.xClientId,
      clientSecret: config.xClientSecret,
      redirectUri,
      code,
      codeVerifier,
    })
    const identity = await getXIdentity(grant.accessToken)
    if (!isExpectedXProfile(department, identity.username)) {
      return redirectAndClear(request, "x-profile-mismatch")
    }
    const db = getDb(env.DB)
    const existing = await db.select().from(socialAccounts).where(and(
      eq(socialAccounts.organizationId, user.organizationId),
      eq(socialAccounts.department, department),
      eq(socialAccounts.platform, "x"),
    )).get()
    const salt = socialTokenSalt({
      organizationId: user.organizationId,
      platform: "x",
      department,
    })
    const now = new Date()
    const refreshTokenEncrypted = grant.refreshToken
      ? await encrypt(grant.refreshToken, config.tokenEncryptionKey, salt)
      : existing?.refreshTokenEncrypted ?? null
    await db.insert(socialAccounts).values({
      id: existing?.id ?? crypto.randomUUID(),
      organizationId: user.organizationId,
      department,
      platform: "x",
      externalAccountId: identity.id,
      parentExternalAccountId: null,
      accountName: `@${identity.username}`,
      accessTokenEncrypted: await encrypt(grant.accessToken, config.tokenEncryptionKey, salt),
      refreshTokenEncrypted,
      tokenExpiresAt: new Date(now.getTime() + grant.expiresIn * 1000).toISOString(),
      grantedScopes: [...grant.scopes].sort().join(" "),
      status: "connected",
      connectedBy: user.id,
      connectedAt: now.toISOString(),
      lastPublishedAt: existing?.lastPublishedAt ?? null,
      lastError: null,
      createdAt: existing?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    }).onConflictDoUpdate({
      target: [
        socialAccounts.organizationId,
        socialAccounts.department,
        socialAccounts.platform,
      ],
      set: {
        externalAccountId: identity.id,
        accountName: `@${identity.username}`,
        accessTokenEncrypted: await encrypt(grant.accessToken, config.tokenEncryptionKey, salt),
        refreshTokenEncrypted,
        tokenExpiresAt: new Date(now.getTime() + grant.expiresIn * 1000).toISOString(),
        grantedScopes: [...grant.scopes].sort().join(" "),
        status: "connected",
        connectedBy: user.id,
        connectedAt: now.toISOString(),
        lastError: null,
        updatedAt: now.toISOString(),
      },
    }).run()
    return redirectAndClear(request, "x-connected")
  } catch (error) {
    console.error("X social connection failed", error)
    return redirectAndClear(request, "error")
  }
}
