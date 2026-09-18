import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import { z } from "zod/v4"

import { getDb } from "@/db"
import {
  notificationEvents,
  notificationPreferences,
  notificationRecipients,
  organizationMembers,
  users,
} from "@/db/schema"
import { feedbackServiceHealth } from "@/db/schema-jarvis"
import { getJarvisEnvValue } from "@/lib/jarvis/auth"

export const squareAuthObservationSchema = z
  .object({
    state: z.enum([
      "healthy",
      "credentials_rejected",
      "missing_credential",
      "unavailable",
      "location_mismatch",
    ]),
    checkedAt: z.iso.datetime(),
  })
  .strict()

export type SquareAuthObservation = z.infer<typeof squareAuthObservationSchema>
export type SquareAuthService = "square-invoice-auth" | "square-compass-auth"
const SOURCE_TYPE = "square_auth_health"
const MAX_AGE_MS = 5 * 60 * 1000

export async function recordSquareAuthObservation(
  env: CloudflareEnv,
  organizationId: string,
  service: SquareAuthService,
  observation: SquareAuthObservation
): Promise<void> {
  const db = getDb(env.DB)
  const healthy = observation.state === "healthy"
  const now = observation.checkedAt
  await db
    .insert(feedbackServiceHealth)
    .values({
      serviceName: service,
      organizationId,
      status: healthy ? "healthy" : "failed",
      lastHeartbeatAt: now,
      lastSuccessAt: healthy ? now : null,
      lastFailureAt: healthy ? null : now,
      consecutiveFailures: healthy ? 0 : 1,
      lastError: healthy ? null : observation.state,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: feedbackServiceHealth.serviceName,
      set: {
        organizationId,
        status: healthy ? "healthy" : "failed",
        lastHeartbeatAt: now,
        lastSuccessAt: healthy ? now : feedbackServiceHealth.lastSuccessAt,
        lastFailureAt: healthy ? feedbackServiceHealth.lastFailureAt : now,
        consecutiveFailures: healthy
          ? 0
          : sql`${feedbackServiceHealth.consecutiveFailures} + 1`,
        lastError: healthy ? null : observation.state,
        updatedAt: now,
      },
      // A delayed/replayed observation must never overwrite a newer check.
      setWhere: lt(feedbackServiceHealth.lastHeartbeatAt, now),
    })
}

export async function checkCompassSquareAuthentication(
  env: CloudflareEnv
): Promise<SquareAuthObservation> {
  const token = getJarvisEnvValue(env, "SQUARE_PRODUCTION_ACCESS_TOKEN")
  let state: SquareAuthObservation["state"] = "missing_credential"
  if (token) {
    let httpStatus: number | null = null
    try {
      const response = await fetch(
        "https://connect.squareup.com/v2/locations",
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Square-Version": "2026-08-19",
          },
          signal: AbortSignal.timeout(10_000),
          // Workers rejects "error" before sending. "manual" exposes 3xx as a
          // failed check without ever forwarding the bearer token elsewhere.
          redirect: "manual",
        }
      )
      httpStatus = response.status
      state =
        response.status === 401 || response.status === 403
          ? "credentials_rejected"
          : response.ok
            ? await locationState(response)
            : "unavailable"
      // Cleanup must not turn a known 401/403 into an availability diagnosis.
      if (!response.ok) await response.body?.cancel().catch(() => undefined)
      if (state !== "healthy") console.warn(JSON.stringify({ event: "square_auth_check_failed", state, httpStatus }))
    } catch (error) {
      console.warn(JSON.stringify({ event: "square_auth_check_failed", httpStatus, errorType: error instanceof TypeError ? "TypeError" : error instanceof DOMException ? "DOMException" : "Error" }))
      state = "unavailable"
    }
  }
  return { state, checkedAt: new Date().toISOString() }
}

async function locationState(
  response: Response
): Promise<SquareAuthObservation["state"]> {
  if (!response.body) return "unavailable"
  const reader = response.body.getReader()
  const parts: string[] = []
  const decoder = new TextDecoder()
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > 128 * 1024) return "unavailable"
      parts.push(decoder.decode(next.value, { stream: true }))
    }
    parts.push(decoder.decode())
    const payload: unknown = JSON.parse(parts.join(""))
    if (typeof payload !== "object" || payload === null) return "unavailable"
    const locations: unknown = Reflect.get(payload, "locations")
    if (!Array.isArray(locations)) return "unavailable"
    const activeNames = locations.flatMap((location: unknown) => {
      if (
        typeof location !== "object" ||
        location === null ||
        Reflect.get(location, "status") !== "ACTIVE"
      )
        return []
      const name: unknown = Reflect.get(location, "name")
      return typeof name === "string" ? [name] : []
    })
    return ["HPS", "ORC", "Nu-Tech"].every(
      (name) => activeNames.filter((active) => active === name).length === 1
    )
      ? "healthy"
      : "location_mismatch"
  } catch {
    return "unavailable"
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function failureBody(state: string): string {
  if (state === "credentials_rejected")
    return "Square rejected the production credential (401/403). Replace the credential in the affected secret store, then allow the next check to verify recovery. No invoice or payment was changed by this check."
  if (state === "missing_credential")
    return "The production credential is missing. Restore it in the affected secret store. No invoice or payment was changed by this check."
  if (state === "location_mismatch")
    return "The production credential cannot see the configured active Square locations. Verify the account and location configuration before billing."
  if (state === "offline")
    return "The private Square authentication monitor has not reported for five minutes. Check the bridge, secret broker, and timer; this does not prove Square rejected the credential."
  return "The Square API could not be reached or returned an unexpected status. This is an availability problem, not confirmed credential rejection. The monitor will retry automatically."
}

export async function notifySquareAuthHealth(
  env: CloudflareEnv,
  organizationId: string,
  now = new Date()
): Promise<void> {
  const db = getDb(env.DB)
  // Establish a five-minute commissioning window even if secret injection fails
  // before the private monitor can send its very first report.
  await db
    .insert(feedbackServiceHealth)
    .values({
      serviceName: "square-invoice-auth",
      organizationId,
      status: "starting",
      lastHeartbeatAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    .onConflictDoNothing()
  const admins = await db
    .select({ userId: users.id, inApp: notificationPreferences.inAppEnabled })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .leftJoin(
      notificationPreferences,
      eq(notificationPreferences.userId, users.id)
    )
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(users.isActive, true),
        inArray(users.role, ["admin", "secondary_admin"])
      )
    )
  const recipients = admins.filter((admin) => admin.inApp !== false)
  const heartbeats = await db
    .select()
    .from(feedbackServiceHealth)
    .where(
      and(
        eq(feedbackServiceHealth.organizationId, organizationId),
        inArray(feedbackServiceHealth.serviceName, [
          "square-invoice-auth",
          "square-compass-auth",
        ])
      )
    )
  for (const heartbeat of heartbeats) {
    const label =
      heartbeat.serviceName === "square-invoice-auth"
        ? "Square invoice bridge"
        : "Compass Square payment reconciliation"
    const heartbeatAge = now.getTime() - Date.parse(heartbeat.lastHeartbeatAt)
    const fresh =
      Number.isFinite(heartbeatAge) &&
      heartbeatAge >= 0 &&
      heartbeatAge <= MAX_AGE_MS
    if (fresh && heartbeat.status === "starting") continue
    if (fresh && heartbeat.status === "healthy") {
      const recovery = alias(notificationEvents, "recovery")
      const failures = await db
        .select({
          id: notificationEvents.id,
          sourceId: notificationEvents.sourceId,
        })
        .from(notificationEvents)
        .leftJoin(
          recovery,
          eq(recovery.id, sql`${notificationEvents.id} || ':recovered'`)
        )
        .where(
          and(
            eq(notificationEvents.organizationId, organizationId),
            eq(notificationEvents.sourceType, SOURCE_TYPE),
            eq(notificationEvents.eventType, "square_auth.failed"),
            sql`${notificationEvents.sourceId} LIKE ${heartbeat.serviceName + ":%"}`,
            lt(notificationEvents.createdAt, heartbeat.lastSuccessAt ?? ""),
            isNull(recovery.id)
          )
        )
        .limit(50)
      for (const failure of failures) {
        await persistAlert(
          failure.id + ":recovered",
          failure.sourceId,
          `${label} authentication recovered`,
          "The production API check succeeded again. The regular billing/payment workflow remains responsible for processing outstanding records; this check does not post financial transactions.",
          "square_auth.recovered",
          failure.id
        )
      }
    } else {
      const state = fresh ? (heartbeat.lastError ?? "unavailable") : "offline"
      const incident = `${heartbeat.serviceName}:${state === "offline" ? heartbeat.lastHeartbeatAt : (heartbeat.lastSuccessAt ?? "never")}:${state}`
      await persistAlert(
        `${organizationId}:${incident}`,
        incident,
        `${label}: ${state === "offline" ? "monitor offline" : state === "credentials_rejected" || state === "missing_credential" ? "authentication needs attention" : "API check needs attention"}`,
        failureBody(state),
        "square_auth.failed",
        null
      )
    }
  }

  async function persistAlert(
    id: string,
    sourceId: string | null,
    title: string,
    body: string,
    eventType: string,
    resolvedEventId: string | null
  ): Promise<void> {
    const timestamp = now.toISOString()
    // Event and recipients commit atomically with deterministic IDs. Retries,
    // overlapping cron/report requests, and partial failures cannot spam alerts.
    await db.batch([
      db
        .insert(notificationEvents)
        .values({
          id,
          organizationId,
          projectId: null,
          eventType,
          sourceType: SOURCE_TYPE,
          sourceId,
          title,
          body,
          href: "/dashboard/automations",
          priority: resolvedEventId ? "normal" : "high",
          audience: "internal",
          createdBy: null,
          createdAt: timestamp,
        })
        .onConflictDoNothing(),
      ...recipients.map((recipient) =>
        db
          .insert(notificationRecipients)
          .values({
            id: `${id}:${recipient.userId}`,
            eventId: id,
            userId: recipient.userId,
            inApp: true,
            createdAt: timestamp,
          })
          .onConflictDoNothing()
      ),
      ...(resolvedEventId
        ? [
            db
              .update(notificationRecipients)
              .set({ dismissedAt: timestamp })
              .where(
                and(
                  eq(notificationRecipients.eventId, resolvedEventId),
                  isNull(notificationRecipients.dismissedAt)
                )
              ),
          ]
        : []),
    ])
  }
}
