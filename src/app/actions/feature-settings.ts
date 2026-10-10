"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import { organizationFeatureSettings } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import {
  FEATURE_SETTINGS,
  canEditFeatureSettings,
  isFeatureSettingsKey,
  parseFeatureSettings,
} from "@/lib/feature-settings/registry"
import { isInternalStaffRole } from "@/lib/user-roles"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

export type FeatureSettingsEditorView = {
  readonly key: string
  readonly settings: Readonly<Record<string, unknown>>
  readonly defaults: Readonly<Record<string, unknown>>
  readonly customized: boolean
  readonly canEdit: boolean
}

async function context(): Promise<
  | { readonly ok: true; readonly db: ReturnType<typeof getDb>; readonly organizationId: string; readonly userId: string; readonly canEdit: boolean }
  | { readonly ok: false; readonly error: string }
> {
  const user = await getCurrentUser()
  if (!user?.organizationId || !isInternalStaffRole(user.role)) return { ok: false, error: "Company settings are available to office staff." }
  const { env } = await getCloudflareContext()
  return {
    ok: true,
    db: getDb(env.DB),
    organizationId: user.organizationId,
    userId: user.id,
    canEdit: user.isActive && canEditFeatureSettings(user.role) && !isDemoUser(user.id) && !isDemoOrg(user.organizationId),
  }
}

/** A feature's current settings and defaults for the Settings page. */
export async function getFeatureSettingsForEditor(key: string): Promise<Result<FeatureSettingsEditorView>> {
  try {
    if (!isFeatureSettingsKey(key)) return { success: false, error: "Unknown settings." }
    const ctx = await context()
    if (!ctx.ok) return { success: false, error: ctx.error }
    const row = await ctx.db
      .select({ value: organizationFeatureSettings.value })
      .from(organizationFeatureSettings)
      .where(and(eq(organizationFeatureSettings.organizationId, ctx.organizationId), eq(organizationFeatureSettings.featureKey, key)))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    return {
      success: true,
      data: {
        key,
        settings: parseFeatureSettings(key, row?.value),
        defaults: FEATURE_SETTINGS[key].defaults,
        customized: row !== null,
        canEdit: ctx.canEdit,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to load settings." }
  }
}

/** Saves a feature's settings for the company (admins only). */
export async function saveFeatureSettings(key: string, value: unknown): Promise<Result<null>> {
  try {
    if (!isFeatureSettingsKey(key)) return { success: false, error: "Unknown settings." }
    const ctx = await context()
    if (!ctx.ok) return { success: false, error: ctx.error }
    if (!ctx.canEdit) return { success: false, error: "Only admins can change company settings." }
    const parsed = FEATURE_SETTINGS[key].schema.safeParse(value)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the values and try again." }
    const now = new Date().toISOString()
    const json = JSON.stringify(parsed.data)
    await ctx.db
      .insert(organizationFeatureSettings)
      .values({ organizationId: ctx.organizationId, featureKey: key, value: json, updatedAt: now, updatedBy: ctx.userId })
      .onConflictDoUpdate({
        target: [organizationFeatureSettings.organizationId, organizationFeatureSettings.featureKey],
        set: { value: json, updatedAt: now, updatedBy: ctx.userId },
      })
    revalidatePath("/dashboard/settings")
    revalidatePath("/dashboard/office-maintenance/message-desk")
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to save settings." }
  }
}

/** Removes the company's custom values so the feature uses its defaults again. */
export async function resetFeatureSettings(key: string): Promise<Result<null>> {
  try {
    if (!isFeatureSettingsKey(key)) return { success: false, error: "Unknown settings." }
    const ctx = await context()
    if (!ctx.ok) return { success: false, error: ctx.error }
    if (!ctx.canEdit) return { success: false, error: "Only admins can change company settings." }
    await ctx.db
      .delete(organizationFeatureSettings)
      .where(and(eq(organizationFeatureSettings.organizationId, ctx.organizationId), eq(organizationFeatureSettings.featureKey, key)))
    revalidatePath("/dashboard/settings")
    revalidatePath("/dashboard/office-maintenance/message-desk")
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to reset settings." }
  }
}
