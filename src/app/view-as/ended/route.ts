/*
 * Where the middleware sends a page load whose View as session is over
 * (developer mode turned off, or the session ran out): record the end in
 * Activity for the admin who started it, drop the cookie, and go back to the
 * page as the admin. See src/lib/view-as/middleware.ts.
 */
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { getSignedInUser } from "@/lib/auth"
import { DEVELOPER_MODE_COOKIE } from "@/lib/developer-mode"
import { VIEW_AS_COOKIE } from "@/lib/view-as/constants"
import { recordViewAsEnd } from "@/lib/view-as/service"

export const dynamic = "force-dynamic"

/** Only same-site paths, never `//host` or an absolute URL. */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard"
}

export async function GET(request: Request): Promise<Response> {
  const cookieStore = await cookies()
  const token = cookieStore.get(VIEW_AS_COOKIE)?.value
  if (token) {
    const admin = await getSignedInUser()
    const reason = cookieStore.get(DEVELOPER_MODE_COOKIE)?.value === "enabled" ? "expired" : "developer_mode_off"
    try {
      await recordViewAsEnd(token, admin, reason)
    } catch (error) {
      console.error("Unable to record the end of View as", error)
    }
  }
  const response = NextResponse.redirect(new URL(safeNext(new URL(request.url).searchParams.get("next")), request.url))
  response.cookies.delete(VIEW_AS_COOKIE)
  return response
}
