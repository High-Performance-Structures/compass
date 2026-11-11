"use client"

import * as React from "react"

import {
  DEFAULT_DISPLAY_COLOR_PALETTE,
  normalizeDisplayColorPalette,
  schedulePaletteStorageKey,
  type DisplayColorPalette,
} from "@/lib/schedule/appearance"

export function useScheduleDisplayPalette(
  projectId: string
): DisplayColorPalette {
  const [palette, setPalette] = React.useState<DisplayColorPalette>(
    DEFAULT_DISPLAY_COLOR_PALETTE
  )

  React.useEffect(() => {
    // Each schedule starts from the defaults so another job's colors never carry over.
    setPalette(DEFAULT_DISPLAY_COLOR_PALETTE)
    try {
      const stored = window.localStorage.getItem(
        schedulePaletteStorageKey(projectId)
      )
      if (stored) {
        setPalette(normalizeDisplayColorPalette(JSON.parse(stored)))
      }
    } catch {
      setPalette(DEFAULT_DISPLAY_COLOR_PALETTE)
    }
  }, [projectId])

  return palette
}
