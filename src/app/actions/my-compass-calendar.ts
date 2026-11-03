"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { myCompassCalendarItems, myCompassCalendars, organizationCalendarSettings, organizationMembers, users } from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { insertMissingMyCompassCalendars, updateMyCompassCalendar } from "@/lib/domain/calendars/store"
import { canEditFeatureSettings } from "@/lib/feature-settings/registry"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import {
  removeMyCompassCalendar,
  syncMyCompassCalendar,
  userIsEligible,
  workspaceEmailFor,
} from "@/lib/my-compass-calendar/sync"
import { requireOrg } from "@/lib/org-scope"
import { isInternalStaffRole } from "@/lib/user-roles"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

export type MyCompassCalendarStatus =
  | { readonly available: false; readonly reason: string }
  | {
      readonly available: true
      readonly enabled: boolean
      readonly status: "pending" | "active" | "removed" | "error"
      readonly googleEmail: string
      readonly calendarUrl: string | null
      readonly itemCount: number
      readonly lastSyncedAt: string | null
      readonly lastError: string | null
      readonly otherNames: readonly string[]
    }

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function parseNames(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

type Context = {
  readonly db: ReturnType<typeof getDb>
  readonly env: CloudflareEnv
  readonly user: AuthUser
  readonly organizationId: string
}

async function context(): Promise<Context> {
  const user = await requireAuth()
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  return { db: getDb(env.DB), env, user, organizationId }
}

/** Why this person can't have a calendar, or their Workspace address and domain. */
async function eligibility(
  ctx: Context
): Promise<{ readonly ok: false; readonly reason: string } | { readonly ok: true; readonly email: string; readonly domain: string }> {
  const settings = await readFeatureSettings(ctx.db, ctx.organizationId, "my-compass-calendar")
  if (settings.mode === "off") return { ok: false, reason: "An administrator hasn't turned on My Compass calendars yet." }
  if (!userIsEligible(settings, ctx.user)) {
    return {
      ok: false,
      reason: isInternalStaffRole(ctx.user.role)
        ? "My Compass calendars are being tested with a few people first."
        : "My Compass calendars are for company staff.",
    }
  }
  const workspace = await ctx.db
    .select({ domain: googleAuth.workspaceDomain })
    .from(googleAuth)
    .where(eq(googleAuth.organizationId, ctx.organizationId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!workspace) return { ok: false, reason: "Google Workspace isn't connected for this company." }
  const email = workspaceEmailFor(ctx.user, workspace.domain)
  if (!email) {
    return { ok: false, reason: `Your Compass account isn't linked to a ${workspace.domain} Google account.` }
  }
  return { ok: true, email, domain: workspace.domain }
}

async function ensureRow(ctx: Context): Promise<typeof myCompassCalendars.$inferSelect> {
  const now = new Date().toISOString()
  await insertMissingMyCompassCalendars(ctx.db, { organizationId: ctx.organizationId, userIds: [ctx.user.id], now })
  const row = await ctx.db
    .select()
    .from(myCompassCalendars)
    .where(eq(myCompassCalendars.userId, ctx.user.id))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!row) throw new Error("Your calendar settings could not be saved.")
  return row
}

export async function getMyCompassCalendarStatus(): Promise<Result<MyCompassCalendarStatus>> {
  try {
    const ctx = await context()
    const eligible = await eligibility(ctx)
    if (!eligible.ok) return { success: true, data: { available: false, reason: eligible.reason } }
    const row = await ensureRow(ctx)
    const items = await ctx.db
      .select({ id: myCompassCalendarItems.id })
      .from(myCompassCalendarItems)
      .where(eq(myCompassCalendarItems.userId, ctx.user.id))
    const status = row.status === "active" || row.status === "removed" || row.status === "error" ? row.status : "pending"
    return {
      success: true,
      data: {
        available: true,
        enabled: row.enabled,
        status,
        googleEmail: eligible.email,
        calendarUrl: row.googleCalendarId
          ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(row.googleCalendarId)}`
          : null,
        itemCount: items.length,
        lastSyncedAt: row.lastSyncedAt,
        lastError: row.lastError,
        otherNames: parseNames(row.otherNames),
      },
    }
  } catch (error) {
    return { success: false, error: message(error, "Could not load your My Compass calendar.") }
  }
}

async function runSync(ctx: Context, domain: string): Promise<void> {
  const settings = await readFeatureSettings(ctx.db, ctx.organizationId, "my-compass-calendar")
  const timeZone =
    (
      await ctx.db
        .select({ timeZone: organizationCalendarSettings.timeZone })
        .from(organizationCalendarSettings)
        .where(eq(organizationCalendarSettings.organizationId, ctx.organizationId))
        .limit(1)
    )[0]?.timeZone ?? "America/Denver"
  await syncMyCompassCalendar({ db: ctx.db, env: ctx.env, settings, workspaceDomain: domain, timeZone, userId: ctx.user.id })
}

/** Turns this person's calendar on (creating it now) or off (removing it from Google). */
export async function setMyCompassCalendarEnabled(enabled: boolean): Promise<Result<null>> {
  try {
    const ctx = await context()
    if (isDemoUser(ctx.user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    const eligible = await eligibility(ctx)
    if (!eligible.ok) return { success: false, error: eligible.reason }
    await ensureRow(ctx)
    const now = new Date().toISOString()
    if (!enabled) {
      await removeMyCompassCalendar({ db: ctx.db, env: ctx.env, userId: ctx.user.id, status: "pending" })
      await updateMyCompassCalendar(ctx.db, ctx.user.id, { enabled: false, updatedAt: now })
    } else {
      await updateMyCompassCalendar(ctx.db, ctx.user.id, { enabled: true, status: "pending", lastError: null, updatedAt: now })
      await runSync(ctx, eligible.domain)
    }
    revalidatePath("/dashboard/settings")
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: message(error, "Could not update your My Compass calendar.") }
  }
}

export async function syncMyCompassCalendarNow(): Promise<Result<null>> {
  try {
    const ctx = await context()
    if (isDemoUser(ctx.user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    const eligible = await eligibility(ctx)
    if (!eligible.ok) return { success: false, error: eligible.reason }
    const row = await ensureRow(ctx)
    if (!row.enabled) return { success: false, error: "Turn on your My Compass calendar first." }
    await runSync(ctx, eligible.domain)
    revalidatePath("/dashboard/settings")
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: message(error, "Your My Compass calendar could not be updated.") }
  }
}

/** Other names this person appears as on assignments ("Wesley Jones" for Wes). */
export async function saveMyCompassCalendarNames(names: readonly string[]): Promise<Result<null>> {
  try {
    const ctx = await context()
    if (isDemoUser(ctx.user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    const cleaned = Array.from(new Set(names.map((name) => name.trim()).filter((name) => name.length >= 3))).slice(0, 10)
    if (cleaned.some((name) => name.length > 80)) return { success: false, error: "Keep each name under 80 characters." }
    await ensureRow(ctx)
    await updateMyCompassCalendar(ctx.db, ctx.user.id, { otherNames: JSON.stringify(cleaned), updatedAt: new Date().toISOString() })
    // Pick up newly matched items on the next run.
    await updateMyCompassCalendar(ctx.db, ctx.user.id, { lastSyncedAt: null })
    revalidatePath("/dashboard/settings")
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: message(error, "Could not save your names.") }
  }
}

/** Staff the administrator can add to the test group. */
export async function getMyCompassCalendarStaffOptions(): Promise<
  Result<readonly { readonly value: string; readonly label: string }[]>
> {
  try {
    const ctx = await context()
    if (!canEditFeatureSettings(ctx.user.role, "my-compass-calendar")) return { success: true, data: [] }
    const rows = await ctx.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
      })
      .from(users)
      .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
      .where(and(eq(organizationMembers.organizationId, ctx.organizationId), eq(users.isActive, true)))
    return {
      success: true,
      data: rows
        .filter((row) => isInternalStaffRole(row.role) && !isDemoUser(row.id))
        .map((row) => ({
          value: row.id,
          label: row.displayName?.trim() || [row.firstName, row.lastName].filter(Boolean).join(" ") || row.email,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    }
  } catch (error) {
    return { success: false, error: message(error, "Could not load staff.") }
  }
}
