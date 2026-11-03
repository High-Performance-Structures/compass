"use client"

import { useEffect, useState } from "react"
import {
  RECENT_SCHEDULE_COLORS_KEY,
  parseRecentScheduleColors,
  rememberRecentScheduleColor,
} from "@/lib/schedule/recent-colors"

/** Recently used custom colors, kept in this browser only. */
export function useRecentColors(open: boolean): {
  readonly recentColors: readonly string[]
  readonly rememberColor: (color: string) => void
} {
  const [recentColors, setRecentColors] = useState<readonly string[]>([])

  useEffect(() => {
    if (!open) return
    try {
      setRecentColors(parseRecentScheduleColors(window.localStorage.getItem(RECENT_SCHEDULE_COLORS_KEY)))
    } catch {
      // Recent colors are a convenience; without storage the list stays empty.
    }
  }, [open])

  function rememberColor(color: string): void {
    const nextRecentColors = rememberRecentScheduleColor(recentColors, color)
    if (nextRecentColors !== recentColors) {
      setRecentColors(nextRecentColors)
      try {
        window.localStorage.setItem(RECENT_SCHEDULE_COLORS_KEY, JSON.stringify(nextRecentColors))
      } catch {
        // Saving the item matters; remembering the color is optional.
      }
    }
  }

  return { recentColors, rememberColor }
}
