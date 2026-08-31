import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { can } from "@/lib/permissions"
import { getSocialConfig } from "@/lib/social/config"
import { buildMetaAuthorizationUrl } from "@/lib/social/meta"
import { socialDepartment } from "@/lib/social/types"
import { isInternalStaffRole } from "@/lib/user-roles"

const STATE_COOKIE = "compass_social_meta_state"
const DEPARTMENT_COOKIE = "compass_social_meta_department"

function settingsUrl(request: Request, status: string): URL {
  const url = new URL("/dashboard/settings", request.url)
  url.searchParams.set("social", status)
  return url
}

export async function GET(request: Request): Promise<Response> {
  const department = socialDepartment(new URL(request.url).searchParams.get("department") ?? "")
  const user = await getCurrentUser()
  if (
    !user ||
    !user.organizationId ||
    !department ||
    !isInternalStaffRole(user.role) ||
    !can(user, "organization", "update")
  ) {
    return NextResponse.redirect(settingsUrl(request, "unauthorized"))
  }

  try {
    const { env } = await getCloudflareContext()
    const config = getSocialConfig(env, request.url)
    if (!config.metaAppId || !config.metaAppSecret) {
      return NextResponse.redirect(settingsUrl(request, "meta-not-configured"))
    }
    const state = crypto.randomUUID()
    const redirectUri = `${config.publicBaseUrl}/api/social/meta/callback`
    const response = NextResponse.redirect(buildMetaAuthorizationUrl({
      apiVersion: config.metaApiVersion,
      appId: config.metaAppId,
      redirectUri,
      state,
    }))
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge: 10 * 60,
    }
    response.cookies.set(STATE_COOKIE, state, cookieOptions)
    response.cookies.set(DEPARTMENT_COOKIE, department, cookieOptions)
    return response
  } catch {
    return NextResponse.redirect(settingsUrl(request, "meta-not-configured"))
  }
}
