import "server-only"

import { and, eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { customThemes, userThemePreference } from "@/db/schema-theme"
import { findPreset } from "@/lib/theme/presets"
import { isDemoUser } from "@/lib/demo"

// User-scoped theme operations shared by the theme server actions (user from
// the session cookie) and the agent theme API (user from a verified agent
// token). Never export these from a "use server" module: a server action
// taking a userId would let any browser act as any user.

type Db = ReturnType<typeof getDb>

export async function setThemePreferenceForUser(
  db: Db,
  userId: string,
  themeId: string,
): Promise<
  | { readonly success: true }
  | { readonly success: false; readonly error: string }
> {
  const isPreset = findPreset(themeId) !== undefined
  if (!isPreset) {
    const custom = await db.query.customThemes.findFirst({
      where: (t, { eq: e, and: a }) =>
        a(e(t.id, themeId), e(t.userId, userId)),
    })
    if (!custom) {
      return { success: false, error: "theme not found" }
    }
  }

  if (isDemoUser(userId)) {
    return { success: true }
  }

  const now = new Date().toISOString()

  try {
    await db
      .insert(userThemePreference)
      .values({ userId, activeThemeId: themeId, updatedAt: now })
      .onConflictDoUpdate({
        target: userThemePreference.userId,
        set: { activeThemeId: themeId, updatedAt: now },
      })
  } catch {
    return { success: false, error: "Unable to save theme preference." }
  }

  return { success: true }
}

export async function listCustomThemesForUser(
  db: Db,
  userId: string,
): Promise<
  ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly description: string
    readonly themeData: string
    readonly createdAt: string
    readonly updatedAt: string
  }>
> {
  return db.query.customThemes.findMany({
    where: (t, { eq: e }) => e(t.userId, userId),
    orderBy: (t, { desc }) => desc(t.updatedAt),
  })
}

export async function getCustomThemeForUser(
  db: Db,
  userId: string,
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
  const theme = await db.query.customThemes.findFirst({
    where: (t, { eq: e, and: a }) =>
      a(e(t.id, themeId), e(t.userId, userId)),
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

export async function saveCustomThemeForUser(
  db: Db,
  userId: string,
  theme: {
    readonly name: string
    readonly description: string
    readonly themeData: string
    readonly existingId?: string
  },
): Promise<
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }
> {
  if (isDemoUser(userId)) {
    return { success: false, error: "DEMO_READ_ONLY" }
  }

  const { name, description, themeData, existingId } = theme
  const now = new Date().toISOString()
  const id = existingId ?? crypto.randomUUID()

  if (existingId) {
    const existing = await db.query.customThemes.findFirst({
      where: (t, { eq: e, and: a }) =>
        a(e(t.id, existingId), e(t.userId, userId)),
    })
    if (!existing) {
      return { success: false, error: "theme not found" }
    }
    await db
      .update(customThemes)
      .set({ name, description, themeData, updatedAt: now })
      .where(
        and(eq(customThemes.id, existingId), eq(customThemes.userId, userId)),
      )
  } else {
    await db.insert(customThemes).values({
      id,
      userId,
      name,
      description,
      themeData,
      createdAt: now,
      updatedAt: now,
    })
  }

  return { success: true, id }
}
