"use server"

import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import {
  deleteCustomTheme as deleteStoredCustomTheme,
  resetUserThemePreference,
} from "@/lib/domain/settings/store"
import { getCurrentUser } from "@/lib/auth"
import { listCustomThemesForUser, setThemePreferenceForUser } from "@/lib/theme/user-themes"
import { revalidatePath } from "next/cache"
import { isDemoUser } from "@/lib/demo"
import { userContext } from "@/lib/server/action-context"

export async function getUserThemePreference(): Promise<
  | { readonly success: true; readonly data: { readonly activeThemeId: string } }
  | { readonly success: false; readonly error: string }
> {
  const context = await userContext()
  if (!context.success) return { success: false, error: "not authenticated" }
  const { user, db } = context.data

  const pref = await db.query.userThemePreference.findFirst({
    where: (p, { eq: e }) => e(p.userId, user.id),
  })

  return {
    success: true,
    data: { activeThemeId: pref?.activeThemeId ?? "native-compass" },
  }
}

export async function setUserThemePreference(
  themeId: string,
): Promise<
  | { readonly success: true }
  | { readonly success: false; readonly error: string }
> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "not authenticated" }

  const { env } = await getCloudflareContext()
  const result = await setThemePreferenceForUser(
    getDb(env.DB),
    user.id,
    themeId,
  )
  if (result.success && !isDemoUser(user.id)) {
    revalidatePath("/", "layout")
  }
  return result
}

export async function getCustomThemes(): Promise<
  | {
      readonly success: true
      readonly data: ReadonlyArray<{
        readonly id: string
        readonly name: string
        readonly description: string
        readonly themeData: string
        readonly createdAt: string
        readonly updatedAt: string
      }>
    }
  | { readonly success: false; readonly error: string }
> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "not authenticated" }

  const { env } = await getCloudflareContext()
  const themes = await listCustomThemesForUser(getDb(env.DB), user.id)
  return { success: true, data: themes }
}

export async function deleteCustomTheme(
  themeId: string,
): Promise<
  | { readonly success: true }
  | { readonly success: false; readonly error: string }
> {
  const context = await userContext()
  if (!context.success) return { success: false, error: "not authenticated" }
  const { user, db } = context.data

  if (isDemoUser(user.id)) {
    return { success: false, error: "DEMO_READ_ONLY" }
  }

  const existing = await db.query.customThemes.findFirst({
    where: (t, { eq: e, and: a }) =>
      a(e(t.id, themeId), e(t.userId, user.id)),
  })
  if (!existing) {
    return { success: false, error: "theme not found" }
  }

  await deleteStoredCustomTheme(db, user.id, themeId)

  // reset preference if it was pointing to the deleted theme
  const pref = await db.query.userThemePreference.findFirst({
    where: (p, { eq: e }) => e(p.userId, user.id),
  })
  if (pref?.activeThemeId === themeId) {
    const now = new Date().toISOString()
    await resetUserThemePreference(db, user.id, "native-compass", now)
  }

  revalidatePath("/", "layout")
  return { success: true }
}
