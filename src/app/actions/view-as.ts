"use server"

/**
 * Developer View as: thin adapters over src/lib/view-as/service.ts. Start
 * sets the signed, httpOnly session cookie; exit clears it. Both are refused
 * or ignored as appropriate while a View as session is already running.
 */
import { cookies } from "next/headers"

import { actionFailure, errorMessage, type ActionDone, type ActionResult } from "@/lib/action-result"
import { getSignedInUser } from "@/lib/auth"
import { DEVELOPER_MODE_COOKIE, developerModeFromCookie } from "@/lib/developer-mode"
import { activeStaff } from "@/lib/domain/identity/reads"
import type { ViewAsPersonOption } from "@/lib/domain/identity/view-as-people"
import { orgContext } from "@/lib/server/action-context"
import { VIEW_AS_COOKIE, VIEW_AS_COOKIE_MAX_AGE_SECONDS } from "@/lib/view-as/constants"
import { beginViewAs, recordViewAsEnd, searchPeopleToViewAs } from "@/lib/view-as/service"
import { isInternalStaffRole } from "@/lib/user-roles"

/** The developer mode cookie, and whether a View as session is already running. */
async function sessionCookies(): Promise<{ readonly developerModeEnabled: boolean; readonly viewing: boolean }> {
  const cookieStore = await cookies()
  return {
    developerModeEnabled: developerModeFromCookie(cookieStore.get(DEVELOPER_MODE_COOKIE)?.value, true),
    viewing: Boolean(cookieStore.get(VIEW_AS_COOKIE)?.value),
  }
}

/** People of the admin's company matching a name or email. */
export async function searchViewAsPeopleAction(query: string): Promise<ActionResult<readonly ViewAsPersonOption[]>> {
  try {
    const session = await sessionCookies()
    if (session.viewing) return actionFailure("Exit View as first.")
    const context = await orgContext()
    if (!context.success) return context
    const result = await searchPeopleToViewAs(context.data, session.developerModeEnabled, query)
    return result.ok ? { success: true, data: result.value } : actionFailure(result.error)
  } catch (error) {
    return actionFailure(errorMessage(error, "Could not search people."))
  }
}

/** Start viewing Compass as this person, read only. The page then reloads to the dashboard. */
export async function startViewAs(targetUserId: string): Promise<ActionDone> {
  try {
    const session = await sessionCookies()
    if (session.viewing) return actionFailure("Exit View as first.")
    const context = await orgContext({ mutation: true })
    if (!context.success) return context
    const result = await beginViewAs(context.data, session.developerModeEnabled, targetUserId)
    if (!result.ok) return actionFailure(result.error)
    const cookieStore = await cookies()
    cookieStore.set(VIEW_AS_COOKIE, result.value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: VIEW_AS_COOKIE_MAX_AGE_SECONDS,
    })
    return { success: true }
  } catch (error) {
    return actionFailure(errorMessage(error, "Could not start View as."))
  }
}

/** Leave View as and return to the admin's own Compass. Always clears the cookie. */
export async function exitViewAs(): Promise<ActionDone> {
  const cookieStore = await cookies()
  const token = cookieStore.get(VIEW_AS_COOKIE)?.value
  if (!token) return { success: true }
  const admin = await getSignedInUser()
  cookieStore.delete(VIEW_AS_COOKIE)
  try {
    await recordViewAsEnd(token, admin)
    return { success: true }
  } catch (error) {
    console.error("Unable to record the end of View as", error)
    return actionFailure(errorMessage(error, "Left View as, but could not record it in Activity."))
  }
}

/** Company staff, for the View as setting's list of extra people. */
export async function getViewAsStaffOptions(): Promise<ActionResult<readonly { readonly id: string; readonly name: string }[]>> {
  const context = await orgContext()
  if (!context.success) return context
  if (!isInternalStaffRole(context.data.user.role)) return actionFailure("Only staff can see this.")
  return { success: true, data: await activeStaff(context.data.db, context.data.organizationId) }
}
