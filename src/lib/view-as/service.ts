/*
 * View as start, exit and person search, behind the thin actions in
 * src/app/actions/view-as.ts. Starting checks the admin may use it (role,
 * company setting, developer mode), that the person belongs to the company,
 * records the start in Activity and only then hands back the signed session
 * token. Exit records the end. The viewed person is never notified.
 */
import { getDb } from "@/db"
import { getSignedInUser, type AuthUser } from "@/lib/auth"
import { getUnguardedCloudflareContext } from "@/lib/db"
import { searchViewAsPeople, viewAsDisplayNames, type ViewAsPersonOption } from "@/lib/domain/identity/view-as-people"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { OrgContext } from "@/lib/server/action-context"
import { isViewAsSessionEnded, writeViewAsActivity, type ViewAsEndReason } from "@/lib/view-as/audit"
import { VIEW_AS_COOKIE, VIEW_AS_MAX_AGE_SECONDS } from "@/lib/view-as/constants"
import { canViewTargetRole, viewAsPermission } from "@/lib/view-as/policy"
import { viewAsSecret, viewAsTargetUser } from "@/lib/view-as/session"
import { signViewAsToken, verifyViewAsToken } from "@/lib/view-as/token"

type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

/** The company's View as setting and developer mode, applied to this admin. */
async function checkAllowed(context: OrgContext, developerModeEnabled: boolean): Promise<Outcome<null>> {
  const settings = await readFeatureSettings(context.db, context.organizationId, "view-as")
  const permission = viewAsPermission({ user: context.user, settings, developerModeEnabled })
  return permission.allowed ? { ok: true, value: null } : { ok: false, error: permission.reason }
}

export async function searchPeopleToViewAs(
  context: OrgContext,
  developerModeEnabled: boolean,
  query: string,
): Promise<Outcome<readonly ViewAsPersonOption[]>> {
  const allowed = await checkAllowed(context, developerModeEnabled)
  if (!allowed.ok) return allowed
  if (query.trim().length < 2) return { ok: true, value: [] }
  const people = await searchViewAsPeople(context.db, {
    organizationId: context.organizationId,
    query: query.slice(0, 80),
    excludeUserId: context.user.id,
  })
  // Same privilege ceiling as starting: nobody broader than the viewer.
  return { ok: true, value: people.filter((person) => canViewTargetRole(context.user, person.role)) }
}

/** Checks everything, records the start, and returns the cookie value to set. */
export async function beginViewAs(
  context: OrgContext,
  developerModeEnabled: boolean,
  targetUserId: string,
  now: Date = new Date(),
): Promise<Outcome<string>> {
  const allowed = await checkAllowed(context, developerModeEnabled)
  if (!allowed.ok) return allowed
  const { user: admin, db, organizationId } = context
  if (targetUserId === admin.id) return { ok: false, error: "That's you. Choose someone else to view as." }
  const target = await viewAsTargetUser(db, targetUserId, organizationId, admin)
  if (!target.ok) return { ok: false, error: target.reason }
  const secret = viewAsSecret(context.env)
  if (!secret) return { ok: false, error: "View as is not configured on this server." }

  const seconds = Math.floor(now.getTime() / 1000)
  const sessionId = crypto.randomUUID()
  const token = await signViewAsToken(
    { v: 1, sid: sessionId, adminId: admin.id, targetId: target.user.id, orgId: organizationId, iat: seconds, exp: seconds + VIEW_AS_MAX_AGE_SECONDS },
    secret,
  )
  // No view goes unrecorded: if Activity cannot be written, do not start.
  await writeViewAsActivity(db, {
    kind: "start",
    sessionId,
    organizationId,
    admin,
    target: { id: target.user.id, name: target.user.displayName || target.user.email, role: target.user.role },
    at: now.toISOString(),
  })
  return { ok: true, value: token }
}

/**
 * Records the end of a View as session that this same signed-in admin
 * started. The request still carries the cookie, so its bindings are read
 * only; the entry is written with the real ones.
 */
export async function recordViewAsEnd(token: string, admin: AuthUser | null, endedBy: ViewAsEndReason = "exit"): Promise<void> {
  // Called again on failure by Exit (a second try), so it must stay idempotent.
  const { env } = await getUnguardedCloudflareContext()
  const secret = viewAsSecret(env)
  const payload = secret ? await verifyViewAsToken(token, secret, undefined, { allowExpired: true }) : null
  if (!payload || !admin || admin.id !== payload.adminId) return
  const db = getDb(env.DB)
  // One end per session, however many ways it ends.
  if (await isViewAsSessionEnded(db, payload)) return
  const names = await viewAsDisplayNames(db, [payload.targetId])
  await writeViewAsActivity(db, {
    kind: "end",
    sessionId: payload.sid,
    organizationId: payload.orgId,
    admin,
    target: { id: payload.targetId, name: names.get(payload.targetId) ?? "someone", role: "" },
    at: new Date().toISOString(),
    endedBy,
  })
}

/** Signing out ends any View as session too: record it and drop the cookie. */
export async function endViewAsOnSignOut(): Promise<void> {
  try {
    const { cookies } = await import("next/headers")
    const cookieStore = await cookies()
    const token = cookieStore.get(VIEW_AS_COOKIE)?.value
    if (!token) return
    const admin = await getSignedInUser()
    cookieStore.delete(VIEW_AS_COOKIE)
    await recordViewAsEnd(token, admin, "signed_out")
  } catch (error) {
    console.error("Unable to end View as on sign-out", error)
  }
}
