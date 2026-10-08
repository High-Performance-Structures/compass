"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import { travelChargeSettings } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { isInternalStaffRole } from "@/lib/user-roles"
import {
  canEditTravelCharges,
  DEFAULT_TRAVEL_CHARGE_SETTINGS,
  parseTravelChargeSettings,
  travelChargeSettingsSchema,
  type TravelChargeSettings,
} from "@/lib/portfolio-map/travel-zones"

export type TravelChargeSettingsView = {
  readonly settings: TravelChargeSettings
  readonly isDefault: boolean
  readonly updatedAt: string | null
  readonly canEdit: boolean
}

type ActionResult = { readonly success: true } | { readonly success: false; readonly error: string }

type Access =
  | { readonly ok: true; readonly db: ReturnType<typeof getDb>; readonly organizationId: string; readonly userId: string; readonly canEdit: boolean }
  | { readonly ok: false; readonly error: string }

async function access(): Promise<Access> {
  const user = await getCurrentUser()
  if (!user?.organizationId || !isInternalStaffRole(user.role)) {
    return { ok: false, error: "Zone charges are available to office staff." }
  }
  const { env } = await getCloudflareContext()
  if (!env?.DB) return { ok: false, error: "The database is not available." }
  return {
    ok: true,
    db: getDb(env.DB),
    organizationId: user.organizationId,
    userId: user.id,
    canEdit: user.isActive && canEditTravelCharges(user.role) && !isDemoUser(user.id) && !isDemoOrg(user.organizationId),
  }
}

export async function getTravelChargeSettings(): Promise<
  { readonly success: true; readonly view: TravelChargeSettingsView } | { readonly success: false; readonly error: string }
> {
  try {
    const context = await access()
    if (!context.ok) return { success: false, error: context.error }
    const rows = await context.db
      .select()
      .from(travelChargeSettings)
      .where(eq(travelChargeSettings.organizationId, context.organizationId))
      .limit(1)
    const row = rows[0]
    let settings = DEFAULT_TRAVEL_CHARGE_SETTINGS
    if (row) {
      try {
        settings = parseTravelChargeSettings(JSON.parse(row.settingsJson))
      } catch {
        settings = DEFAULT_TRAVEL_CHARGE_SETTINGS
      }
    }
    return {
      success: true,
      view: { settings, isDefault: !row, updatedAt: row?.updatedAt ?? null, canEdit: context.canEdit },
    }
  } catch (error) {
    console.error("Travel charge settings failed", error)
    return { success: false, error: "Zone charges could not be loaded." }
  }
}

export async function saveTravelChargeSettings(input: unknown): Promise<ActionResult> {
  try {
    const context = await access()
    if (!context.ok) return { success: false, error: context.error }
    if (!context.canEdit) return { success: false, error: "Your role cannot change zone charges." }
    const parsed = travelChargeSettingsSchema.safeParse(input)
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Check the zone charge values." }
    }
    const values = {
      settingsJson: JSON.stringify(parsed.data),
      updatedAt: new Date().toISOString(),
      updatedBy: context.userId,
    }
    await context.db
      .insert(travelChargeSettings)
      .values({ organizationId: context.organizationId, ...values })
      .onConflictDoUpdate({ target: travelChargeSettings.organizationId, set: values })
    revalidatePath("/dashboard")
    return { success: true }
  } catch (error) {
    console.error("Saving travel charge settings failed", error)
    return { success: false, error: "Zone charges could not be saved." }
  }
}

/** Remove the organization's rates so the built-in defaults apply again. */
export async function resetTravelChargeSettings(): Promise<ActionResult> {
  try {
    const context = await access()
    if (!context.ok) return { success: false, error: context.error }
    if (!context.canEdit) return { success: false, error: "Your role cannot change zone charges." }
    await context.db
      .delete(travelChargeSettings)
      .where(eq(travelChargeSettings.organizationId, context.organizationId))
    revalidatePath("/dashboard")
    return { success: true }
  } catch (error) {
    console.error("Resetting travel charge settings failed", error)
    return { success: false, error: "Zone charges could not be reset." }
  }
}
