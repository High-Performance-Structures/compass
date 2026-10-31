"use client"

import { useEffect, useState } from "react"
import {
  DEFAULT_DISPLAY_COLOR_LABELS,
  DEFAULT_DISPLAY_COLOR_PALETTE,
  schedulePaletteLabelStorageKey,
  normalizeDisplayColorPalette,
  schedulePaletteStorageKey,
  type DisplayColor,
  type DisplayColorPalette,
} from "@/lib/schedule/appearance"
import { storedPaletteLabels } from "./gantt-view-rules"

export interface GanttPaletteState {
  readonly displayColorPalette: DisplayColorPalette
  readonly displayColorLabels: Record<DisplayColor, string>
  readonly updatePaletteColor: (color: DisplayColor, value: string) => void
  readonly updatePaletteLabel: (color: DisplayColor, value: string) => void
  readonly resetPalette: () => void
}

/** Personal bar colors and key meanings, kept in this browser per schedule. */
export function useGanttPalette(preferenceScopeKey: string): GanttPaletteState {
  const [displayColorPalette, setDisplayColorPalette] = useState<DisplayColorPalette>(
    DEFAULT_DISPLAY_COLOR_PALETTE
  )
  const [displayColorLabels, setDisplayColorLabels] = useState<Record<DisplayColor, string>>(
    DEFAULT_DISPLAY_COLOR_LABELS
  )
  const [hasLoadedPalette, setHasLoadedPalette] = useState(false)

  useEffect(() => {
    try {
      const storedPalette = window.localStorage.getItem(
        schedulePaletteStorageKey(preferenceScopeKey)
      )
      const storedLabels = window.localStorage.getItem(
        schedulePaletteLabelStorageKey(preferenceScopeKey)
      )
      if (storedPalette) {
        setDisplayColorPalette(normalizeDisplayColorPalette(JSON.parse(storedPalette)))
      }
      if (storedLabels) {
        const labels = storedPaletteLabels(JSON.parse(storedLabels))
        if (labels) setDisplayColorLabels(labels)
      }
    } catch {
      // A malformed or unavailable local preference falls back to the default palette.
    } finally {
      setHasLoadedPalette(true)
    }
  }, [preferenceScopeKey])

  useEffect(() => {
    if (!hasLoadedPalette) return
    window.localStorage.setItem(
      schedulePaletteStorageKey(preferenceScopeKey),
      JSON.stringify(displayColorPalette)
    )
    window.localStorage.setItem(
      schedulePaletteLabelStorageKey(preferenceScopeKey),
      JSON.stringify(displayColorLabels)
    )
  }, [
    displayColorLabels,
    displayColorPalette,
    hasLoadedPalette,
    preferenceScopeKey,
  ])

  const updatePaletteColor = (color: DisplayColor, value: string) => {
    setDisplayColorPalette((palette) => ({ ...palette, [color]: value }))
  }

  const updatePaletteLabel = (color: DisplayColor, value: string) => {
    setDisplayColorLabels((labels) => ({ ...labels, [color]: value }))
  }

  const resetPalette = () => {
    setDisplayColorPalette(DEFAULT_DISPLAY_COLOR_PALETTE)
    setDisplayColorLabels(DEFAULT_DISPLAY_COLOR_LABELS)
  }

  return {
    displayColorPalette,
    displayColorLabels,
    updatePaletteColor,
    updatePaletteLabel,
    resetPalette,
  }
}
