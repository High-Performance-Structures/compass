/*
 * Where a View as session goes when it is over: the middleware sends page
 * loads here when the session expired or developer mode was turned off, and
 * the dashboard and portal layouts send any session that is no longer
 * allowed (setting off, admin demoted, person deactivated, company switched,
 * already ended). Records the end in Activity for the admin who started it,
 * drops the cookie, and goes back to the page as the admin.
 */
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { getSignedInUser, getViewAsState } from "@/lib/auth"
import { VIEW_AS_COOKIE } from "@/lib/view-as/constants"
import { viewAsReturnUrl } from "@/lib/view-as/middleware"
import { recordViewAsEnd } from "@/lib/view-as/service"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
  const cookieStore = await cookies()
  const token = cookieStore.get(VIEW_AS_COOKIE)?.value
  if (token) {
    try {
      const [admin, state] = await Promise.all([getSignedInUser(), getViewAsState()])
      await recordViewAsEnd(token, admin, state.kind === "invalid" ? state.code : "exit")
    } catch (error) {
      console.error("Unable to record the end of View as", error)
    }
  }
  const response = NextResponse.redirect(viewAsReturnUrl(new URL(request.url).searchParams.get("next"), request.url))
  response.cookies.delete(VIEW_AS_COOKIE)
  return response
}
