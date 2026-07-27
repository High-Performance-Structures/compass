"use server"

import { and, desc, eq, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  notificationEvents,
  notificationPreferences,
  notificationRecipients,
} from "@/db/schema"
import { getCurrentUser, requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isMissingNotificationTableError } from "@/lib/notifications/events"
import { isValidTimeZone } from "@/lib/work-calendar"

export type NotificationPreferenceState = {
  readonly inAppEnabled: boolean
  readonly emailEnabled: boolean
  readonly pushEnabled: boolean
  readonly weeklyDigestEnabled: boolean
  readonly rfiEnabled: boolean
  readonly ownerUpdateEnabled: boolean
  readonly scheduleEnabled: boolean
  readonly poEnabled: boolean
  readonly timeZone: string
}

export type NotificationCenterItem = {
  readonly id: string
  readonly eventId: string
  readonly title: string
  readonly body: string
  readonly href: string
  readonly priority: string
  readonly eventType: string
  readonly projectId: string | null
  readonly readAt: string | null
  readonly createdAt: string
}

type NotificationActionResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

type NotificationPreferencesResult =
  | { readonly success: true; readonly data: NotificationPreferenceState }
  | { readonly success: false; readonly error: string }

type NotificationCenterResult =
  | {
      readonly success: true
      readonly data: {
        readonly unreadCount: number
        readonly items: readonly NotificationCenterItem[]
      }
    }
  | { readonly success: false; readonly error: string }

const DEFAULT_PREFERENCES: NotificationPreferenceState = {
  inAppEnabled: true,
  emailEnabled: true,
  pushEnabled: true,
  weeklyDigestEnabled: false,
  rfiEnabled: true,
  ownerUpdateEnabled: true,
  scheduleEnabled: true,
  poEnabled: true,
  timeZone: "America/Denver",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function envString(env: unknown, key: string): string | null {
  if (!isRecord(env)) return process.env[key] ?? null
  const value = env[key]
  return typeof value === "string" && value.trim().length > 0
    ? value
    : process.env[key] ?? null
}

function preferenceFromRow(
  row: typeof notificationPreferences.$inferSelect | null
): NotificationPreferenceState {
  if (!row) return DEFAULT_PREFERENCES
  return {
    inAppEnabled: row.inAppEnabled,
    emailEnabled: row.emailEnabled,
    pushEnabled: row.pushEnabled,
    weeklyDigestEnabled: row.weeklyDigestEnabled,
    rfiEnabled: row.rfiEnabled,
    ownerUpdateEnabled: row.ownerUpdateEnabled,
    scheduleEnabled: row.scheduleEnabled,
    poEnabled: row.poEnabled,
    timeZone: row.timeZone,
  }
}

async function getPreferenceForUser(
  db: ReturnType<typeof getDb>,
  userId: string
): Promise<NotificationPreferenceState> {
  const row = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  return preferenceFromRow(row)
}

export async function getNotificationPreferences(): Promise<NotificationPreferencesResult> {
  try {
    const user = await requireAuth()
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const data = await getPreferenceForUser(db, user.id)
    return { success: true, data }
  } catch (error) {
    if (isMissingNotificationTableError(error)) {
      return { success: true, data: DEFAULT_PREFERENCES }
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load notification preferences",
    }
  }
}

export async function updateNotificationPreferences(
  input: NotificationPreferenceState
): Promise<NotificationActionResult> {
  try {
    const timeZone = input.timeZone.trim()
    if (!isValidTimeZone(timeZone)) {
      return { success: false, error: "Choose a valid timezone." }
    }
    const user = await requireAuth()
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const now = new Date().toISOString()

    await db
      .insert(notificationPreferences)
      .values({
        userId: user.id,
        ...input,
        timeZone,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: {
          ...input,
          timeZone,
          updatedAt: now,
        },
      })

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to update notification preferences",
    }
  }
}

export async function getNotificationCenter(): Promise<NotificationCenterResult> {
  try {
    const user = await requireAuth()
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const rows = await db
      .select({
        id: notificationRecipients.id,
        eventId: notificationEvents.id,
        title: notificationEvents.title,
        body: notificationEvents.body,
        href: notificationEvents.href,
        priority: notificationEvents.priority,
        eventType: notificationEvents.eventType,
        projectId: notificationEvents.projectId,
        readAt: notificationRecipients.readAt,
        createdAt: notificationRecipients.createdAt,
      })
      .from(notificationRecipients)
      .innerJoin(
        notificationEvents,
        eq(notificationEvents.id, notificationRecipients.eventId)
      )
      .where(
        and(
          eq(notificationRecipients.userId, user.id),
          eq(notificationRecipients.inApp, true),
          isNull(notificationRecipients.dismissedAt)
        )
      )
      .orderBy(desc(notificationRecipients.createdAt))
      .limit(100)

    return {
      success: true,
      data: {
        unreadCount: rows.filter((row) => row.readAt === null).length,
        items: rows,
      },
    }
  } catch (error) {
    if (isMissingNotificationTableError(error)) {
      return { success: true, data: { unreadCount: 0, items: [] } }
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load notifications",
    }
  }
}

export async function markNotificationRead(
  recipientId: string
): Promise<NotificationActionResult> {
  try {
    const user = await requireAuth()
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const now = new Date().toISOString()

    await db
      .update(notificationRecipients)
      .set({ readAt: now })
      .where(
        and(
          eq(notificationRecipients.id, recipientId),
          eq(notificationRecipients.userId, user.id)
        )
      )

    revalidatePath("/", "layout")
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to mark notification read",
    }
  }
}

export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  try {
    const user = await requireAuth()
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const now = new Date().toISOString()

    await db
      .update(notificationRecipients)
      .set({ readAt: now })
      .where(
        and(
          eq(notificationRecipients.userId, user.id),
          isNull(notificationRecipients.readAt)
        )
      )

    revalidatePath("/", "layout")
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to mark notifications read",
    }
  }
}

export async function getNotificationDebugStatus(): Promise<{
  readonly signedIn: boolean
  readonly configuredEmail: boolean
}> {
  const user = await getCurrentUser()
  const { env } = await getCloudflareContext()
  return {
    signedIn: user !== null,
    configuredEmail: envString(env, "RESEND_API_KEY") !== null,
  }
}
