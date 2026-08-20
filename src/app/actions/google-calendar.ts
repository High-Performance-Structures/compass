"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  googleCalendarConnections,
  googleCalendarSelections,
  googleProjectCalendars,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { listGoogleCalendars } from "@/lib/google/calendar/client"
import {
  getGoogleCalendarOAuthConfig,
  googleCalendarTokenSalt,
} from "@/lib/google/calendar/config"
import { refreshGoogleAccessToken } from "@/lib/google/calendar/oauth"
import { hasRequiredGoogleCalendarScopes } from "@/lib/google/calendar/oauth"
import {
  canConnectGoogleCalendar,
  canManageOrganizationCalendars,
  canWriteGoogleCalendar,
} from "@/lib/google/calendar/policy"
import { syncGoogleCalendarSelection } from "@/lib/google/calendar/sync"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"

export type GoogleCalendarSelectionStatus = {
  readonly id: string
  readonly googleCalendarId: string
  readonly summary: string
  readonly description: string | null
  readonly timeZone: string | null
  readonly backgroundColor: string | null
  readonly accessRole: string
  readonly isPrimary: boolean
  readonly selected: boolean
  readonly importEvents: boolean
  readonly exportCompassEvents: boolean
  readonly isCompassDestination: boolean
  readonly calendarScope: string
  readonly internalVisibility: string
  readonly internalCanCreate: boolean
  readonly internalCanEdit: boolean
  readonly internalCanDelete: boolean
  readonly lastSyncedAt: string | null
  readonly lastError: string | null
}

export type GoogleCalendarConnectionStatus = {
  readonly configured: boolean
  readonly canConnect: boolean
  readonly canManageOrganizationCalendars: boolean
  readonly connected: boolean
  readonly requiresReconnect: boolean
  readonly isOrganizationCalendarOwner: boolean
  readonly organizationOwnerAccountEmail: string | null
  readonly accountEmail: string | null
  readonly status: string | null
  readonly calendarSyncEnabled: boolean
  readonly tasksSyncEnabled: boolean
  readonly lastSyncedAt: string | null
  readonly lastError: string | null
  readonly calendars: readonly GoogleCalendarSelectionStatus[]
}

type ActionResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

async function ownConnection(
  organizationId: string,
  userId: string,
): Promise<{ readonly id: string; readonly refreshTokenEncrypted: string } | null> {
  const { env } = await getCloudflareContext()
  return getDb(env.DB)
    .select({
      id: googleCalendarConnections.id,
      refreshTokenEncrypted: googleCalendarConnections.refreshTokenEncrypted,
    })
    .from(googleCalendarConnections)
    .where(
      and(
        eq(googleCalendarConnections.organizationId, organizationId),
        eq(googleCalendarConnections.userId, userId),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

async function connectionAccessToken(input: {
  readonly env: object
  readonly userId: string
  readonly refreshTokenEncrypted: string
}): Promise<string> {
  const configuration = getGoogleCalendarOAuthConfig(input.env)
  if (!configuration.configured) throw new Error("Google Calendar OAuth is not configured.")
  const refreshToken = await decrypt(
    input.refreshTokenEncrypted,
    configuration.config.tokenEncryptionKey,
    googleCalendarTokenSalt(input.userId),
  )
  return (await refreshGoogleAccessToken(configuration.config, refreshToken)).accessToken
}

export async function getGoogleCalendarConnectionStatus(): Promise<GoogleCalendarConnectionStatus> {
  const user = await requireAuth()
  requirePermission(user, "schedule", "read")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const connection = await db
    .select({
      id: googleCalendarConnections.id,
      accountEmail: googleCalendarConnections.googleAccountEmail,
      status: googleCalendarConnections.status,
      calendarSyncEnabled: googleCalendarConnections.calendarSyncEnabled,
      tasksSyncEnabled: googleCalendarConnections.tasksSyncEnabled,
      lastSyncedAt: googleCalendarConnections.lastSyncedAt,
      lastError: googleCalendarConnections.lastError,
      grantedScopes: googleCalendarConnections.grantedScopes,
      isOrganizationCalendarOwner:
        googleCalendarConnections.isOrganizationCalendarOwner,
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
  const organizationOwner = await db
    .select({ accountEmail: googleCalendarConnections.googleAccountEmail })
    .from(googleCalendarConnections)
    .where(
      and(
        eq(googleCalendarConnections.organizationId, organizationId),
        eq(googleCalendarConnections.isOrganizationCalendarOwner, true),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  const calendars = connection
    ? await db
        .select({
          id: googleCalendarSelections.id,
          googleCalendarId: googleCalendarSelections.googleCalendarId,
          summary: googleCalendarSelections.summary,
          description: googleCalendarSelections.description,
          timeZone: googleCalendarSelections.timeZone,
          backgroundColor: googleCalendarSelections.backgroundColor,
          accessRole: googleCalendarSelections.accessRole,
          isPrimary: googleCalendarSelections.isPrimary,
          selected: googleCalendarSelections.selected,
          importEvents: googleCalendarSelections.importEvents,
          exportCompassEvents: googleCalendarSelections.exportCompassEvents,
          isCompassDestination: googleCalendarSelections.isCompassDestination,
          calendarScope: googleCalendarSelections.calendarScope,
          internalVisibility: googleCalendarSelections.internalVisibility,
          internalCanCreate: googleCalendarSelections.internalCanCreate,
          internalCanEdit: googleCalendarSelections.internalCanEdit,
          internalCanDelete: googleCalendarSelections.internalCanDelete,
          lastSyncedAt: googleCalendarSelections.lastSyncedAt,
          lastError: googleCalendarSelections.lastError,
        })
        .from(googleCalendarSelections)
        .where(eq(googleCalendarSelections.connectionId, connection.id))
        .orderBy(googleCalendarSelections.summary)
    : []
  return {
    configured: getGoogleCalendarOAuthConfig(env).configured,
    canConnect: canConnectGoogleCalendar({ userId: user.id, role: user.role }),
    canManageOrganizationCalendars: canManageOrganizationCalendars(user.role),
    connected: connection !== null,
    requiresReconnect:
      connection !== null &&
      !hasRequiredGoogleCalendarScopes(
        connection.grantedScopes.split(/\s+/).filter(Boolean),
      ),
    isOrganizationCalendarOwner:
      connection?.isOrganizationCalendarOwner ?? false,
    organizationOwnerAccountEmail: organizationOwner?.accountEmail ?? null,
    accountEmail: connection?.accountEmail ?? null,
    status: connection?.status ?? null,
    calendarSyncEnabled: connection?.calendarSyncEnabled ?? false,
    tasksSyncEnabled: connection?.tasksSyncEnabled ?? false,
    lastSyncedAt: connection?.lastSyncedAt ?? null,
    lastError: connection?.lastError ?? null,
    calendars,
  }
}

export async function refreshGoogleCalendarList(): Promise<ActionResult> {
  try {
    const user = await requireAuth()
    requirePermission(user, "schedule", "read")
    const organizationId = requireOrg(user)
    if (!canConnectGoogleCalendar({ userId: user.id, role: user.role })) {
      return { success: false, error: "Google Calendar is staff-only." }
    }
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const connection = await ownConnection(organizationId, user.id)
    if (!connection) return { success: false, error: "Connect Google Calendar first." }
    const token = await connectionAccessToken({
      env,
      userId: user.id,
      refreshTokenEncrypted: connection.refreshTokenEncrypted,
    })
    const calendars = await listGoogleCalendars(token)
    const now = new Date().toISOString()
    for (const calendar of calendars) {
      await db
        .insert(googleCalendarSelections)
        .values({
          id: crypto.randomUUID(),
          connectionId: connection.id,
          googleCalendarId: calendar.id,
          summary: calendar.summary,
          description: calendar.description,
          timeZone: calendar.timeZone,
          backgroundColor: calendar.backgroundColor,
          accessRole: calendar.accessRole,
          isPrimary: calendar.primary,
          selected: false,
          importEvents: false,
          exportCompassEvents: false,
          isCompassDestination: false,
          calendarScope: "personal",
          internalVisibility: "busy",
          internalCanCreate: false,
          internalCanEdit: false,
          internalCanDelete: false,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [googleCalendarSelections.connectionId, googleCalendarSelections.googleCalendarId],
          set: {
            summary: calendar.summary,
            description: calendar.description,
            timeZone: calendar.timeZone,
            backgroundColor: calendar.backgroundColor,
            accessRole: calendar.accessRole,
            isPrimary: calendar.primary,
            updatedAt: now,
          },
        })
    }
    revalidatePath("/dashboard/settings")
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Calendars could not be loaded." }
  }
}

export type GoogleCalendarSelectionConfiguration = {
  readonly selectionId: string
  readonly selected: boolean
  readonly importEvents: boolean
  readonly exportCompassEvents: boolean
  readonly isCompassDestination: boolean
  readonly calendarScope: "personal" | "organization"
  readonly internalVisibility: "busy" | "details"
  readonly internalCanCreate: boolean
  readonly internalCanEdit: boolean
  readonly internalCanDelete: boolean
}

export async function configureGoogleCalendarSelection(
  input: GoogleCalendarSelectionConfiguration,
): Promise<ActionResult> {
  try {
    const user = await requireAuth()
    requirePermission(user, "schedule", "read")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const selection = await db
      .select({
        id: googleCalendarSelections.id,
        connectionId: googleCalendarSelections.connectionId,
        accessRole: googleCalendarSelections.accessRole,
      })
      .from(googleCalendarSelections)
      .innerJoin(googleCalendarConnections, eq(googleCalendarConnections.id, googleCalendarSelections.connectionId))
      .where(
        and(
          eq(googleCalendarSelections.id, input.selectionId),
          eq(googleCalendarConnections.organizationId, organizationId),
          eq(googleCalendarConnections.userId, user.id),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!selection) return { success: false, error: "Calendar was not found." }
    const organizationCalendar = input.calendarScope === "organization"
    if (organizationCalendar && !canManageOrganizationCalendars(user.role)) {
      return { success: false, error: "Only an administrator or developer can publish an organization calendar." }
    }
    const requestsWrite =
      input.exportCompassEvents || input.isCompassDestination || input.internalCanCreate ||
      input.internalCanEdit || input.internalCanDelete
    if (requestsWrite && !canWriteGoogleCalendar(selection.accessRole)) {
      return { success: false, error: "The connected Google account has read-only access to this calendar." }
    }
    const now = new Date().toISOString()
    await db
      .update(googleCalendarSelections)
      .set({
        selected: input.selected,
        importEvents: input.selected && input.importEvents,
        exportCompassEvents: input.selected && input.exportCompassEvents,
        isCompassDestination: input.selected && input.isCompassDestination,
        calendarScope: input.calendarScope,
        internalVisibility: organizationCalendar ? input.internalVisibility : "busy",
        internalCanCreate: organizationCalendar && input.internalCanCreate,
        internalCanEdit: organizationCalendar && input.internalCanEdit,
        internalCanDelete: organizationCalendar && input.internalCanDelete,
        updatedAt: now,
      })
      .where(eq(googleCalendarSelections.id, selection.id))
    const enabled = await db
      .select({ id: googleCalendarSelections.id })
      .from(googleCalendarSelections)
      .where(
        and(
          eq(googleCalendarSelections.connectionId, selection.connectionId),
          eq(googleCalendarSelections.selected, true),
          eq(googleCalendarSelections.importEvents, true),
        ),
      )
      .limit(1)
      .then((rows) => rows.length > 0)
    await db
      .update(googleCalendarConnections)
      .set({ calendarSyncEnabled: enabled, updatedAt: now })
      .where(eq(googleCalendarConnections.id, selection.connectionId))
    revalidatePath("/dashboard/settings")
    revalidatePath("/dashboard/schedule")
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Calendar settings could not be saved." }
  }
}

export async function syncSelectedGoogleCalendar(selectionId: string): Promise<
  | { readonly success: true; readonly imported: number; readonly updated: number; readonly conflicts: number }
  | { readonly success: false; readonly error: string }
> {
  try {
    const user = await requireAuth()
    requirePermission(user, "schedule", "read")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const selection = await db
      .select({
        ownerUserId: googleCalendarConnections.userId,
        calendarScope: googleCalendarSelections.calendarScope,
        importEvents: googleCalendarSelections.importEvents,
      })
      .from(googleCalendarSelections)
      .innerJoin(googleCalendarConnections, eq(googleCalendarConnections.id, googleCalendarSelections.connectionId))
      .where(
        and(
          eq(googleCalendarSelections.id, selectionId),
          eq(googleCalendarConnections.organizationId, organizationId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!selection || !selection.importEvents) {
      return { success: false, error: "Enable event import for this calendar first." }
    }
    if (selection.ownerUserId !== user.id && !canManageOrganizationCalendars(user.role)) {
      return { success: false, error: "You cannot sync another user's calendar." }
    }
    if (selection.calendarScope === "organization" && !canManageOrganizationCalendars(user.role)) {
      return { success: false, error: "You cannot sync an organization calendar." }
    }
    const result = await syncGoogleCalendarSelection(db, env, selectionId)
    revalidatePath("/dashboard/settings")
    revalidatePath("/dashboard/schedule")
    return { success: true, ...result }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Google Calendar sync failed." }
  }
}

export async function disconnectGoogleCalendar(): Promise<
  | { readonly success: true; readonly revoked: boolean }
  | { readonly success: false; readonly error: string }
> {
  try {
    const user = await requireAuth()
    requirePermission(user, "schedule", "read")
    if (!canConnectGoogleCalendar({ userId: user.id, role: user.role })) {
      return { success: false, error: "Google Calendar is staff-only." }
    }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const connection = await ownConnection(organizationId, user.id)
    if (!connection) return { success: true, revoked: true }
    const managedProjectCalendar = await db
      .select({ id: googleProjectCalendars.id })
      .from(googleProjectCalendars)
      .where(eq(googleProjectCalendars.ownerConnectionId, connection.id))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (managedProjectCalendar) {
      return {
        success: false,
        error: "This account owns managed project calendars. Delete those calendars before disconnecting this Google account.",
      }
    }
    let revoked = false
    const configuration = getGoogleCalendarOAuthConfig(env)
    if (configuration.configured) {
      try {
        const refreshToken = await decrypt(
          connection.refreshTokenEncrypted,
          configuration.config.tokenEncryptionKey,
          googleCalendarTokenSalt(user.id),
        )
        revoked = (
          await fetch("https://oauth2.googleapis.com/revoke", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token: refreshToken }),
          })
        ).ok
      } catch {
        revoked = false
      }
    }
    await db.delete(googleCalendarConnections).where(eq(googleCalendarConnections.id, connection.id)).run()
    revalidatePath("/dashboard/settings")
    revalidatePath("/dashboard/schedule")
    return { success: true, revoked }
  } catch {
    return { success: false, error: "Google Calendar could not be disconnected." }
  }
}
