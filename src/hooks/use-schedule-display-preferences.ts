"use client"

import * as React from "react"

import {
  DEFAULT_DISPLAY_COLOR_LABELS,
  DEFAULT_DISPLAY_COLOR_PALETTE,
  DISPLAY_COLORS,
  isCustomDisplayColor,
  normalizeDisplayColorPalette,
  schedulePaletteLabelStorageKey,
  schedulePaletteStorageKey,
  type DisplayColor,
  type DisplayColorPalette,
} from "@/lib/schedule/appearance"

type DisplayColorLabels = Record<DisplayColor, string>

export interface ScheduleDisplayPreferences {
  readonly displayColorPalette: DisplayColorPalette
  readonly displayColorLabels: DisplayColorLabels
  readonly resetPreferences: () => void
  readonly updatePaletteColor: (color: DisplayColor, value: string) => void
  readonly updatePaletteLabel: (color: DisplayColor, value: string) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readPalette(value: string | null): DisplayColorPalette | null {
  if (!value) return null

  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)) return null

    const candidate: Partial<Record<DisplayColor, string>> = {}
    for (const color of DISPLAY_COLORS) {
      const storedColor = parsed[color]
      if (typeof storedColor !== "string" || !isCustomDisplayColor(storedColor)) return null
      candidate[color] = storedColor
    }
    return normalizeDisplayColorPalette(candidate)
  } catch {
    return null
  }
}

function readLabels(value: string | null): DisplayColorLabels | null {
  if (!value) return null

  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)) return null

    const labels: DisplayColorLabels = { ...DEFAULT_DISPLAY_COLOR_LABELS }
    for (const color of DISPLAY_COLORS) {
      const label = parsed[color]
      if (typeof label !== "string" || !label.trim()) return null
      labels[color] = label
    }
    return labels
  } catch {
    return null
  }
}

function readPreferences(scopeKey: string): {
  readonly displayColorPalette: DisplayColorPalette
  readonly displayColorLabels: DisplayColorLabels
} {
  try {
    return {
      displayColorPalette:
        readPalette(window.localStorage.getItem(schedulePaletteStorageKey(scopeKey))) ??
        { ...DEFAULT_DISPLAY_COLOR_PALETTE },
      displayColorLabels:
        readLabels(window.localStorage.getItem(schedulePaletteLabelStorageKey(scopeKey))) ??
        { ...DEFAULT_DISPLAY_COLOR_LABELS },
    }
  } catch {
    return {
      displayColorPalette: { ...DEFAULT_DISPLAY_COLOR_PALETTE },
      displayColorLabels: { ...DEFAULT_DISPLAY_COLOR_LABELS },
    }
  }
}

export function useScheduleDisplayPreferences(
  scopeKey: string
): ScheduleDisplayPreferences {
  const [displayColorPalette, setDisplayColorPalette] = React.useState<DisplayColorPalette>(
    () => ({ ...DEFAULT_DISPLAY_COLOR_PALETTE })
  )
  const [displayColorLabels, setDisplayColorLabels] = React.useState<DisplayColorLabels>(
    () => ({ ...DEFAULT_DISPLAY_COLOR_LABELS })
  )
  const [loadedScopeKey, setLoadedScopeKey] = React.useState<string | null>(null)

  React.useEffect(() => {
    setLoadedScopeKey(null)
    const preferences = readPreferences(scopeKey)
    setDisplayColorPalette(preferences.displayColorPalette)
    setDisplayColorLabels(preferences.displayColorLabels)
    setLoadedScopeKey(scopeKey)
  }, [scopeKey])

  React.useEffect(() => {
    if (loadedScopeKey !== scopeKey) return

    try {
      window.localStorage.setItem(
        schedulePaletteStorageKey(scopeKey),
        JSON.stringify(displayColorPalette)
      )
      window.localStorage.setItem(
        schedulePaletteLabelStorageKey(scopeKey),
        JSON.stringify(displayColorLabels)
      )
    } catch {
      // Local preferences are best effort and must not interrupt schedule rendering.
    }
  }, [displayColorLabels, displayColorPalette, loadedScopeKey, scopeKey])

  const updatePaletteColor = React.useCallback((color: DisplayColor, value: string) => {
    setDisplayColorPalette((palette) => ({ ...palette, [color]: value }))
  }, [])

  const updatePaletteLabel = React.useCallback((color: DisplayColor, value: string) => {
    setDisplayColorLabels((labels) => ({ ...labels, [color]: value }))
  }, [])

  const resetPreferences = React.useCallback(() => {
    setDisplayColorPalette({ ...DEFAULT_DISPLAY_COLOR_PALETTE })
    setDisplayColorLabels({ ...DEFAULT_DISPLAY_COLOR_LABELS })
  }, [])

  return {
    displayColorPalette,
    displayColorLabels,
    resetPreferences,
    updatePaletteColor,
    updatePaletteLabel,
  }
}
