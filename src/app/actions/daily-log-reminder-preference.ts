"use server"

import { upsertNotificationPreferences } from "@/lib/domain/notifications/store"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { notificationPreferences } from "@/db/schema"
import { isDemoUser } from "@/lib/demo"
import { reminderTimeFor, TIME_PATTERN } from "@/lib/daily-logs/reminders"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { isInternalStaffRole } from "@/lib/user-roles"
import { userContext } from "@/lib/server/action-context"

export type DailyLogReminderPreference = {
  /** The company lets staff pick their own time. */
  readonly allowed: boolean
  /** The person's own time, if they set one. */
  readonly ownTime: string | null
  /** The company's time for this person's group. */
  readonly companyTime: string
}

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

/** The signed-in person's daily log reminder time; null for people who aren't staff. */
export async function getDailyLogReminderPreference(): Promise<DailyLogReminderPreference | null> {
  // Signed-out callers throw "Unauthorized", as requireAuth did.
  const context = await userContext()
  if (!context.success) throw new Error(context.error)
  const { user, db } = context.data
  if (!user.organizationId || !isInternalStaffRole(user.role)) return null
  const [rules, row] = await Promise.all([
    readFeatureSettings(db, user.organizationId, "daily-log-reminders"),
    db
      .select({ time: notificationPreferences.dailyLogReminderTime })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, user.id))
      .limit(1),
  ])
  if (!rules.enabled) return null
  return {
    allowed: rules.staffPickOwnTime,
    ownTime: row[0]?.time ?? null,
    companyTime: reminderTimeFor({ ...rules, staffPickOwnTime: false }, user.role, null),
  }
}

/** Sets (or clears, with null) the person's own reminder time. */
export async function setDailyLogReminderTime(time: string | null): Promise<Result<null>> {
  try {
    const context = await userContext()
    // Signed out falls to the catch below, as requireAuth's throw did.
    if (!context.success) throw new Error(context.error)
    const { user, db } = context.data
    if (isDemoUser(user.id)) return { success: false, error: "Demo data cannot be changed." }
    if (!user.organizationId || !isInternalStaffRole(user.role)) return { success: false, error: "Daily log reminders are for staff." }
    if (time !== null && !TIME_PATTERN.test(time)) return { success: false, error: "Enter a time like 16:30." }
    const rules = await readFeatureSettings(db, user.organizationId, "daily-log-reminders")
    if (!rules.staffPickOwnTime) return { success: false, error: "Your company sets the reminder time." }
    const now = new Date().toISOString()
    await upsertNotificationPreferences(db, user.id, { dailyLogReminderTime: time, updatedAt: now })
    revalidatePath("/dashboard/settings")
    return { success: true, data: null }
  } catch (error) {
    console.error("Unable to save the daily log reminder time", error)
    return { success: false, error: "Unable to save the reminder time." }
  }
}
