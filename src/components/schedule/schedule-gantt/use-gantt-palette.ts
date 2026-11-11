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
  // The schedule whose saved palette is in state. Saving waits until it matches the current
  // schedule, so switching jobs never writes one job's colors under another job's key.
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null)

  useEffect(() => {
    // Start each schedule from the defaults; its own saved palette replaces them below.
    setDisplayColorPalette(DEFAULT_DISPLAY_COLOR_PALETTE)
    setDisplayColorLabels(DEFAULT_DISPLAY_COLOR_LABELS)
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
      setLoadedScopeKey(preferenceScopeKey)
    }
  }, [preferenceScopeKey])

  useEffect(() => {
    if (loadedScopeKey !== preferenceScopeKey) return
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
    loadedScopeKey,
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
