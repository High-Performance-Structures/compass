"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { eq, and, desc, isNull, isNotNull, inArray } from "drizzle-orm"
import { getDb } from "@/db"
import { notifications } from "@/db/schema"
import type { Notification, NewNotification } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { randomUUID } from "crypto"

const MAX_OLD_NOTIFICATIONS = 10

async function purgeOldNotifications(
  db: ReturnType<typeof getDb>,
  userId: string,
): Promise<void> {
  const oldIds = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        isNotNull(notifications.clearedAt)
      )
    )
    .orderBy(desc(notifications.clearedAt))
    .offset(MAX_OLD_NOTIFICATIONS)

  if (oldIds.length > 0) {
    await db.delete(notifications).where(
      and(
        eq(notifications.userId, userId),
        inArray(
          notifications.id,
          oldIds.map((r) => r.id)
        )
      )
    )
  }
}

export async function getNotifications(): Promise<
  | { success: true; notifications: ReadonlyArray<Notification> }
  | { success: false; error: string }
> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Not authenticated" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, user.id),
          isNull(notifications.clearedAt)
        )
      )
      .orderBy(desc(notifications.createdAt))

    return { success: true, notifications: rows }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load notifications",
    }
  }
}

export async function getOldNotifications(): Promise<
  | { success: true; notifications: ReadonlyArray<Notification> }
  | { success: false; error: string }
> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Not authenticated" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, user.id),
          isNotNull(notifications.clearedAt)
        )
      )
      .orderBy(desc(notifications.clearedAt))
      .limit(MAX_OLD_NOTIFICATIONS)

    return { success: true, notifications: rows }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load old notifications",
    }
  }
}

export async function clearAllNotifications(): Promise<
  { success: true } | { success: false; error: string }
> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Not authenticated" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const now = new Date().toISOString()

    await db
      .update(notifications)
      .set({ clearedAt: now })
      .where(
        and(
          eq(notifications.userId, user.id),
          isNull(notifications.clearedAt)
        )
      )

    await purgeOldNotifications(db, user.id)

    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to clear notifications",
    }
  }
}

export async function clearNotification(
  id: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Not authenticated" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const now = new Date().toISOString()

    const updated = await db
      .update(notifications)
      .set({ clearedAt: now })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.userId, user.id),
          isNull(notifications.clearedAt)
        )
      )
      .returning({ id: notifications.id })

    if (updated.length === 0) {
      return { success: false, error: "Notification not found" }
    }

    await purgeOldNotifications(db, user.id)

    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to clear notification",
    }
  }
}

export async function createNotification(
  input: Omit<NewNotification, "id" | "userId" | "createdAt">,
): Promise<{ success: true; notification: Notification } | { success: false; error: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Not authenticated" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const notification: NewNotification = {
      id: randomUUID(),
      userId: user.id,
      createdAt: new Date().toISOString(),
      ...input,
    }

    const [created] = await db.insert(notifications).values(notification).returning()

    return { success: true, notification: created }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create notification",
    }
  }
}
