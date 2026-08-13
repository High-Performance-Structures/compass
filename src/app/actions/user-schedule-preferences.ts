"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { userSchedulePreferences } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import {
  DEFAULT_GANTT_SCROLL_MODE,
  isGanttScrollMode,
  type GanttScrollMode,
} from "@/lib/schedule/gantt-interaction-mode"

export type UserSchedulePreferences = {
  readonly ganttScrollMode: GanttScrollMode
}

type SchedulePreferenceActionResult =
  | { readonly success: true; readonly data: UserSchedulePreferences }
  | { readonly success: false; readonly error: string }

const defaultPreferences: UserSchedulePreferences = {
  ganttScrollMode: DEFAULT_GANTT_SCROLL_MODE,
}

export async function getUserSchedulePreferences(): Promise<UserSchedulePreferences> {
  try {
    const user = await requireAuth()
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const row = await db
      .select({ ganttScrollMode: userSchedulePreferences.ganttScrollMode })
      .from(userSchedulePreferences)
      .where(eq(userSchedulePreferences.userId, user.id))
      .get()

    return row && isGanttScrollMode(row.ganttScrollMode)
      ? { ganttScrollMode: row.ganttScrollMode }
      : defaultPreferences
  } catch (error) {
    console.warn("Unable to load user Schedule preferences", error)
    return defaultPreferences
  }
}

export async function updateGanttScrollMode(
  ganttScrollMode: GanttScrollMode
): Promise<SchedulePreferenceActionResult> {
  if (!isGanttScrollMode(ganttScrollMode)) {
    return { success: false, error: "Choose a valid Gantt scrolling mode." }
  }

  try {
    const user = await requireAuth()
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const now = new Date().toISOString()

    await db
      .insert(userSchedulePreferences)
      .values({
        userId: user.id,
        ganttScrollMode,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userSchedulePreferences.userId,
        set: { ganttScrollMode, updatedAt: now },
      })

    revalidatePath("/dashboard/schedule")
    return { success: true, data: { ganttScrollMode } }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to save the Gantt scrolling mode.",
    }
  }
}
