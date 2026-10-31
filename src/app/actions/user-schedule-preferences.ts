"use server"

import { eq } from "drizzle-orm"

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
