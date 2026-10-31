"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { morningPlanPreferences, myCompassCalendars } from "@/db/schema"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { upsertMorningPlanPreferences } from "@/lib/domain/settings/store"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { TodaysPlan, WeekLoad } from "@/lib/morning-plan/plan"
import { loadPlanForUser, loadTeamWorkload, type TeamWorkloadRow } from "@/lib/morning-plan/server"
import { canManageProjectRegistry } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

export type MorningPlanPreferences = {
  /** Whether the company lets people get a daily email/push of their plan. */
  readonly digestAllowed: boolean
  readonly digestEnabled: boolean
  readonly digestHour: number
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function staffOrganization(user: AuthUser): string | null {
  return user.organizationId && isInternalStaffRole(user.role) && !isDemoUser(user.id) ? user.organizationId : null
}

async function myOtherNames(db: ReturnType<typeof getDb>, userId: string): Promise<readonly string[]> {
  const [row] = await db
    .select({ otherNames: myCompassCalendars.otherNames })
    .from(myCompassCalendars)
    .where(eq(myCompassCalendars.userId, userId))
    .limit(1)
  if (!row) return []
  try {
    const parsed: unknown = JSON.parse(row.otherNames)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

/** The signed-in staff member's plan for today; null when it doesn't apply. */
export async function getMyTodaysPlan(): Promise<Result<{ readonly plan: TodaysPlan; readonly load: WeekLoad | null } | null>> {
  try {
    const user = await requireAuth()
    const organizationId = staffOrganization(user)
    if (!organizationId) return { success: true, data: null }
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const data = await loadPlanForUser(db, organizationId, {
      id: user.id,
      email: user.email,
      googleEmail: user.googleEmail ?? null,
      displayName: user.displayName,
      firstName: user.firstName,
      lastName: user.lastName,
      otherNames: await myOtherNames(db, user.id),
    })
    return { success: true, data }
  } catch (error) {
    return { success: false, error: message(error, "Today's plan couldn't be loaded.") }
  }
}

/** Staff whose week is over capacity, for people who manage the office. */
export async function getTeamWorkload(): Promise<Result<readonly TeamWorkloadRow[]>> {
  try {
    const user = await requireAuth()
    const organizationId = staffOrganization(user)
    if (!organizationId || !canManageProjectRegistry(user)) return { success: true, data: [] }
    const { env } = await getCloudflareContext()
    return { success: true, data: await loadTeamWorkload(getDb(env.DB), organizationId) }
  } catch (error) {
    return { success: false, error: message(error, "Team workload couldn't be loaded.") }
  }
}

export async function getMyMorningPlanPreferences(): Promise<Result<MorningPlanPreferences | null>> {
  try {
    const user = await requireAuth()
    const organizationId = staffOrganization(user)
    if (!organizationId) return { success: true, data: null }
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const settings = await readFeatureSettings(db, organizationId, "morning-plan")
    if (!settings.enabled) return { success: true, data: null }
    const [row] = await db
      .select({ digestEnabled: morningPlanPreferences.digestEnabled, digestHour: morningPlanPreferences.digestHour })
      .from(morningPlanPreferences)
      .where(eq(morningPlanPreferences.userId, user.id))
      .limit(1)
    return {
      success: true,
      data: {
        digestAllowed: settings.allowDailyDigest,
        digestEnabled: row?.digestEnabled ?? false,
        digestHour: row?.digestHour ?? 7,
      },
    }
  } catch (error) {
    return { success: false, error: message(error, "Your plan settings couldn't be loaded.") }
  }
}

export async function saveMyMorningPlanPreferences(input: {
  readonly digestEnabled: boolean
  readonly digestHour: number
}): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  try {
    const user = await requireAuth()
    const organizationId = staffOrganization(user)
    if (!organizationId) return { success: false, error: "Today's plan is for staff only." }
    if (!Number.isInteger(input.digestHour) || input.digestHour < 5 || input.digestHour > 11) {
      return { success: false, error: "Pick a time between 5 AM and 11 AM." }
    }
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const settings = await readFeatureSettings(db, organizationId, "morning-plan")
    if (input.digestEnabled && (!settings.enabled || !settings.allowDailyDigest)) {
      return { success: false, error: "Your company has turned off the daily plan email." }
    }
    const now = new Date().toISOString()
    await upsertMorningPlanPreferences(db, {
      userId: user.id,
      organizationId,
      change: { digestEnabled: input.digestEnabled, digestHour: input.digestHour },
      at: now,
    })
    revalidatePath("/dashboard/settings")
    return { success: true }
  } catch (error) {
    return { success: false, error: message(error, "Your plan settings couldn't be saved.") }
  }
}
