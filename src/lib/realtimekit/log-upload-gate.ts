import { withAuth } from "@workos-inc/authkit-nextjs"
import { and, eq } from "drizzle-orm"
import { cookies } from "next/headers"

import { organizationFeatureSettings } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { claimOrganizationFeatureSettingWindow } from "@/lib/domain/settings/store"
import { canUseOfficeTalk } from "@/lib/permissions"
import {
  LOG_FORWARD_INTERVAL_MS,
  LOG_FORWARD_MARKER_KEY,
  isUrgentLogUpload,
  nextRoutineLogForwardAt,
  routineLogForwardStaleBefore,
  takeUrgentLogForward,
} from "@/lib/realtimekit/log-upload-throttle"
import { userContext } from "@/lib/server/action-context"

/**
 * Server side of the RealtimeKit log throttle; the rule and its reasons are
 * in ./log-upload-throttle.ts. Answers each SDK log upload with "forward" or
 * a response to return without touching the body.
 *
 * Log uploads arrive every few seconds per caller, so the expensive parts are
 * remembered per Worker isolate: whether a signed-in session may use Office
 * Talk (rechecked every AUTH_CACHE_MS) and when each company's next routine
 * forward is allowed. D1 is only read or written when an isolate does not yet
 * know the company's window, which is at most a few times per window.
 */

const AUTH_CACHE_MS = 10 * 60 * 1000
const RACE_RETRY_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 500

type AuthEntry = {
  readonly allowed: boolean
  readonly userId: string
  readonly organizationId: string | null
  readonly expiresAt: number
}

const authCache = new Map<string, AuthEntry>()
const nextForwardAtByOrganization = new Map<string, number>()
const urgentForwards = new Map<string, readonly number[]>()

function remember<V>(map: Map<string, V>, key: string, value: V): void {
  if (map.size >= MAX_CACHE_ENTRIES) map.clear()
  map.set(key, value)
}

type LogUploadDecision = "forward" | Response

function noContent(): Response {
  return new Response(null, { status: 204 })
}

async function sessionCacheKey(workosUserId: string): Promise<string> {
  const store = await cookies()
  const activeOrg = store.get("compass-active-org")?.value ?? ""
  const demo = store.get("compass-demo")?.value ?? ""
  return JSON.stringify([workosUserId, activeOrg, demo])
}

async function officeTalkUploader(nowMs: number): Promise<AuthEntry | null> {
  const session = await withAuth()
  if (!session.user) return null
  const key = await sessionCacheKey(session.user.id)
  const cached = authCache.get(key)
  if (cached && cached.expiresAt > nowMs) return cached

  const user = await getCurrentUser()
  if (!user) return null
  const entry: AuthEntry = {
    allowed: canUseOfficeTalk(user),
    userId: user.id,
    organizationId: user.organizationId,
    expiresAt: nowMs + AUTH_CACHE_MS,
  }
  remember(authCache, key, entry)
  return entry
}

/** Claims the company's routine window in D1, or learns when it reopens. */
async function claimRoutineForward(
  organizationId: string,
  nowMs: number
): Promise<boolean> {
  const context = await userContext()
  if (!context.success) return false
  const { db, user } = context.data
  const claimed = await claimOrganizationFeatureSettingWindow(db, {
    organizationId,
    featureKey: LOG_FORWARD_MARKER_KEY,
    claimedAt: new Date(nowMs).toISOString(),
    staleBefore: routineLogForwardStaleBefore(nowMs),
    updatedBy: user.id,
  })
  if (claimed) {
    remember(nextForwardAtByOrganization, organizationId, nowMs + LOG_FORWARD_INTERVAL_MS)
    return true
  }
  const marker = await db
    .select({ value: organizationFeatureSettings.value })
    .from(organizationFeatureSettings)
    .where(
      and(
        eq(organizationFeatureSettings.organizationId, organizationId),
        eq(organizationFeatureSettings.featureKey, LOG_FORWARD_MARKER_KEY)
      )
    )
    .get()
  const reopensAt = nextRoutineLogForwardAt(marker?.value ?? null, nowMs)
  remember(
    nextForwardAtByOrganization,
    organizationId,
    reopensAt > nowMs ? reopensAt : nowMs + RACE_RETRY_MS
  )
  return false
}

export async function decideRealtimeKitLogUpload(
  request: Request
): Promise<LogUploadDecision> {
  const nowMs = Date.now()
  const uploader = await officeTalkUploader(nowMs)
  if (!uploader) return Response.json({ error: "Unauthorized" }, { status: 401 })
  if (!uploader.allowed) return Response.json({ error: "Forbidden" }, { status: 403 })

  if (
    isUrgentLogUpload(request.headers) &&
    takeUrgentLogForward(urgentForwards, uploader.userId, nowMs)
  ) {
    return "forward"
  }

  const { organizationId } = uploader
  if (!organizationId) return noContent()
  const nextForwardAt = nextForwardAtByOrganization.get(organizationId)
  if (nextForwardAt !== undefined && nowMs < nextForwardAt) return noContent()

  try {
    return (await claimRoutineForward(organizationId, nowMs)) ? "forward" : noContent()
  } catch (error) {
    // Losing a diagnostic sample is fine; never fail the caller over it.
    console.warn("RealtimeKit log throttle could not read its marker", error)
    remember(nextForwardAtByOrganization, organizationId, nowMs + RACE_RETRY_MS)
    return noContent()
  }
}
