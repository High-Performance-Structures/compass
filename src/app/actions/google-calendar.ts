"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { googleCalendarConnections } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import {
  getGoogleCalendarOAuthConfig,
  googleCalendarTokenSalt,
} from "@/lib/google/calendar/config"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"

export type GoogleCalendarConnectionStatus = {
  readonly configured: boolean
  readonly canConnect: boolean
  readonly connected: boolean
  readonly accountEmail: string | null
  readonly status: string | null
  readonly calendarSyncEnabled: boolean
  readonly tasksSyncEnabled: boolean
  readonly lastSyncedAt: string | null
  readonly lastError: string | null
}

function canConnectGoogleCalendar(input: {
  readonly userId: string
  readonly role: string
}): boolean {
  return !isDemoUser(input.userId) && isInternalStaffRole(input.role)
}

export async function getGoogleCalendarConnectionStatus(): Promise<GoogleCalendarConnectionStatus> {
  const user = await requireAuth()
  requirePermission(user, "schedule", "read")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const configuration = getGoogleCalendarOAuthConfig(env)
  const db = getDb(env.DB)
  const connection = await db
    .select({
      googleAccountEmail: googleCalendarConnections.googleAccountEmail,
      status: googleCalendarConnections.status,
      calendarSyncEnabled: googleCalendarConnections.calendarSyncEnabled,
      tasksSyncEnabled: googleCalendarConnections.tasksSyncEnabled,
      lastSyncedAt: googleCalendarConnections.lastSyncedAt,
      lastError: googleCalendarConnections.lastError,
    })
    .from(googleCalendarConnections)
    .where(
      and(
        eq(googleCalendarConnections.organizationId, organizationId),
        eq(googleCalendarConnections.userId, user.id),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  return {
    configured: configuration.configured,
    canConnect: canConnectGoogleCalendar({
      userId: user.id,
      role: user.role,
    }),
    connected: connection !== null,
    accountEmail: connection?.googleAccountEmail ?? null,
    status: connection?.status ?? null,
    calendarSyncEnabled: connection?.calendarSyncEnabled ?? false,
    tasksSyncEnabled: connection?.tasksSyncEnabled ?? false,
    lastSyncedAt: connection?.lastSyncedAt ?? null,
    lastError: connection?.lastError ?? null,
  }
}

export async function disconnectGoogleCalendar(): Promise<
  | { readonly success: true; readonly revoked: boolean }
  | { readonly success: false; readonly error: string }
> {
  try {
    const user = await requireAuth()
    requirePermission(user, "schedule", "read")
    if (
      !canConnectGoogleCalendar({
        userId: user.id,
        role: user.role,
      })
    ) {
      return { success: false, error: "Google Calendar is staff-only." }
    }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const connection = await db
      .select({
        id: googleCalendarConnections.id,
        refreshTokenEncrypted:
          googleCalendarConnections.refreshTokenEncrypted,
      })
      .from(googleCalendarConnections)
      .where(
        and(
          eq(googleCalendarConnections.organizationId, organizationId),
          eq(googleCalendarConnections.userId, user.id),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!connection) return { success: true, revoked: true }

    let revoked = false
    const configuration = getGoogleCalendarOAuthConfig(env)
    if (configuration.configured) {
      try {
        const refreshToken = await decrypt(
          connection.refreshTokenEncrypted,
          configuration.config.tokenEncryptionKey,
          googleCalendarTokenSalt(user.id),
        )
        const response = await fetch(
          "https://oauth2.googleapis.com/revoke",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ token: refreshToken }),
          },
        )
        revoked = response.ok
      } catch {
        revoked = false
      }
    }

    await db
      .delete(googleCalendarConnections)
      .where(eq(googleCalendarConnections.id, connection.id))
      .run()
    revalidatePath("/dashboard/settings")
    return { success: true, revoked }
  } catch {
    return {
      success: false,
      error: "Google Calendar could not be disconnected.",
    }
  }
}
