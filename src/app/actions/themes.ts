"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { eq, and } from "drizzle-orm"
import { getDb } from "@/db"
import {
  customThemes,
  userThemePreference,
} from "@/db/schema-theme"
import { getCurrentUser } from "@/lib/auth"
import { findPreset } from "@/lib/theme/presets"
import { revalidatePath } from "next/cache"

export async function getUserThemePreference(): Promise<
  | { readonly success: true; readonly data: { readonly activeThemeId: string } }
  | { readonly success: false; readonly error: string }
> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "not authenticated" }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

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
  const db = getDb(env.DB)

  const isPreset = findPreset(themeId) !== undefined
  if (!isPreset) {
    const custom = await db.query.customThemes.findFirst({
      where: (t, { eq: e, and: a }) =>
        a(e(t.id, themeId), e(t.userId, user.id)),
    })
    if (!custom) {
      return { success: false, error: "theme not found" }
    }
  }

  const now = new Date().toISOString()

  await db
    .insert(userThemePreference)
    .values({ userId: user.id, activeThemeId: themeId, updatedAt: now })
    .onConflictDoUpdate({
      target: userThemePreference.userId,
      set: { activeThemeId: themeId, updatedAt: now },
    })

  revalidatePath("/", "layout")
  return { success: true }
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
  const db = getDb(env.DB)

  const themes = await db.query.customThemes.findMany({
    where: (t, { eq: e }) => e(t.userId, user.id),
    orderBy: (t, { desc }) => desc(t.updatedAt),
  })

  return { success: true, data: themes }
}

export async function getCustomThemeById(
  themeId: string,
): Promise<
  | {
      readonly success: true
      readonly data: {
        readonly id: string
        readonly name: string
        readonly description: string
        readonly themeData: string
      }
    }
  | { readonly success: false; readonly error: string }
> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "not authenticated" }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const theme = await db.query.customThemes.findFirst({
    where: (t, { eq: e, and: a }) =>
      a(e(t.id, themeId), e(t.userId, user.id)),
  })

  if (!theme) {
    return { success: false, error: "theme not found" }
  }

  return {
    success: true,
    data: {
      id: theme.id,
      name: theme.name,
      description: theme.description,
      themeData: theme.themeData,
    },
  }
}

export async function saveCustomTheme(
  name: string,
  description: string,
  themeData: string,
  existingId?: string,
): Promise<
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }
> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "not authenticated" }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const now = new Date().toISOString()
  const id = existingId ?? crypto.randomUUID()

  if (existingId) {
    const existing = await db.query.customThemes.findFirst({
      where: (t, { eq: e, and: a }) =>
        a(e(t.id, existingId), e(t.userId, user.id)),
    })
    if (!existing) {
      return { success: false, error: "theme not found" }
    }
    await db
      .update(customThemes)
      .set({ name, description, themeData, updatedAt: now })
      .where(eq(customThemes.id, existingId))
  } else {
    await db.insert(customThemes).values({
      id,
      userId: user.id,
      name,
      description,
      themeData,
      createdAt: now,
      updatedAt: now,
    })
  }

  revalidatePath("/", "layout")
  return { success: true, id }
}

export async function deleteCustomTheme(
  themeId: string,
): Promise<
  | { readonly success: true }
  | { readonly success: false; readonly error: string }
> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "not authenticated" }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const existing = await db.query.customThemes.findFirst({
    where: (t, { eq: e, and: a }) =>
      a(e(t.id, themeId), e(t.userId, user.id)),
  })
  if (!existing) {
    return { success: false, error: "theme not found" }
  }

  await db
    .delete(customThemes)
    .where(
      and(
        eq(customThemes.id, themeId),
        eq(customThemes.userId, user.id),
      ),
    )

  // reset preference if it was pointing to the deleted theme
  const pref = await db.query.userThemePreference.findFirst({
    where: (p, { eq: e }) => e(p.userId, user.id),
  })
  if (pref?.activeThemeId === themeId) {
    const now = new Date().toISOString()
    await db
      .update(userThemePreference)
      .set({ activeThemeId: "native-compass", updatedAt: now })
      .where(eq(userThemePreference.userId, user.id))
  }

  revalidatePath("/", "layout")
  return { success: true }
}
