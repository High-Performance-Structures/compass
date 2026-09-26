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

type StoredPreferences = Readonly<{
  readonly displayColorPalette: DisplayColorPalette
  readonly displayColorLabels: DisplayColorLabels
}>

export interface ScheduleDisplayPreferences extends StoredPreferences {
  readonly resetPreferences: () => void
  readonly updatePaletteColor: (color: DisplayColor, value: string) => void
  readonly updatePaletteLabel: (color: DisplayColor, value: string) => void
}

const DEFAULT_PREFERENCES: StoredPreferences = {
  displayColorPalette: { ...DEFAULT_DISPLAY_COLOR_PALETTE },
  displayColorLabels: { ...DEFAULT_DISPLAY_COLOR_LABELS },
}

const preferencesByScope = new Map<string, StoredPreferences>()
const listenersByScope = new Map<string, Set<() => void>>()
let observedStorage: Storage | null | undefined
let storageListenerStorage: Storage | null | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null

  try {
    return window.localStorage
  } catch {
    return null
  }
}

function resetCacheIfStorageChanged(): void {
  const storage = getLocalStorage()
  if (storage === observedStorage) return
  preferencesByScope.clear()
  observedStorage = storage
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

function defaultPreferences(): StoredPreferences {
  return {
    displayColorPalette: { ...DEFAULT_DISPLAY_COLOR_PALETTE },
    displayColorLabels: { ...DEFAULT_DISPLAY_COLOR_LABELS },
  }
}

function readPreferences(scopeKey: string): StoredPreferences {
  const storage = getLocalStorage()
  if (!storage) return defaultPreferences()

  try {
    return {
      displayColorPalette:
        readPalette(storage.getItem(schedulePaletteStorageKey(scopeKey))) ??
        { ...DEFAULT_DISPLAY_COLOR_PALETTE },
      displayColorLabels:
        readLabels(storage.getItem(schedulePaletteLabelStorageKey(scopeKey))) ??
        { ...DEFAULT_DISPLAY_COLOR_LABELS },
    }
  } catch {
    return defaultPreferences()
  }
}

function getPreferences(scopeKey: string): StoredPreferences {
  resetCacheIfStorageChanged()
  const cached = preferencesByScope.get(scopeKey)
  if (cached) return cached

  const preferences = readPreferences(scopeKey)
  preferencesByScope.set(scopeKey, preferences)
  return preferences
}

function notifyScope(scopeKey: string): void {
  const listeners = listenersByScope.get(scopeKey)
  if (!listeners) return

  for (const listener of listeners) listener()
}

function persistPreferences(scopeKey: string, preferences: StoredPreferences): void {
  const storage = getLocalStorage()
  if (!storage) return

  try {
    storage.setItem(
      schedulePaletteStorageKey(scopeKey),
      JSON.stringify(preferences.displayColorPalette)
    )
    storage.setItem(
      schedulePaletteLabelStorageKey(scopeKey),
      JSON.stringify(preferences.displayColorLabels)
    )
  } catch {
    // Local preferences are best effort and must not interrupt schedule rendering.
  }
}

function setPreferences(scopeKey: string, preferences: StoredPreferences): void {
  resetCacheIfStorageChanged()
  preferencesByScope.set(scopeKey, preferences)
  persistPreferences(scopeKey, preferences)
  notifyScope(scopeKey)
}

function scopeForStorageKey(key: string): string | null {
  const palettePrefix = "compass:schedule-display-palette:"
  const labelsPrefix = "compass:schedule-display-labels:"
  if (key.startsWith(palettePrefix)) return key.slice(palettePrefix.length)
  if (key.startsWith(labelsPrefix)) return key.slice(labelsPrefix.length)
  return null
}

function handleStorageChange(event: StorageEvent): void {
  const storage = getLocalStorage()
  if (event.storageArea && event.storageArea !== storage) return
  resetCacheIfStorageChanged()

  if (event.key === null) {
    for (const scopeKey of preferencesByScope.keys()) {
      preferencesByScope.set(scopeKey, readPreferences(scopeKey))
      notifyScope(scopeKey)
    }
    return
  }

  const scopeKey = scopeForStorageKey(event.key)
  if (!scopeKey) return
  if (!preferencesByScope.has(scopeKey) && !listenersByScope.has(scopeKey)) return
  preferencesByScope.set(scopeKey, readPreferences(scopeKey))
  notifyScope(scopeKey)
}

function ensureStorageListener(): void {
  if (typeof window === "undefined") return

  const storage = getLocalStorage()
  if (storage === storageListenerStorage) return
  if (storageListenerStorage) window.removeEventListener("storage", handleStorageChange)
  storageListenerStorage = storage
  if (storage) window.addEventListener("storage", handleStorageChange)
}

function subscribeToScope(scopeKey: string, listener: () => void): () => void {
  resetCacheIfStorageChanged()
  ensureStorageListener()
  persistPreferences(scopeKey, getPreferences(scopeKey))
  const listeners = listenersByScope.get(scopeKey) ?? new Set<() => void>()
  listeners.add(listener)
  listenersByScope.set(scopeKey, listeners)

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) listenersByScope.delete(scopeKey)
  }
}

export function useScheduleDisplayPreferences(
  scopeKey: string
): ScheduleDisplayPreferences {
  const subscribe = React.useCallback(
    (listener: () => void) => subscribeToScope(scopeKey, listener),
    [scopeKey]
  )
  const getSnapshot = React.useCallback(() => getPreferences(scopeKey), [scopeKey])
  const preferences = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULT_PREFERENCES
  )

  const updatePaletteColor = React.useCallback(
    (color: DisplayColor, value: string) => {
      const current = getPreferences(scopeKey)
      setPreferences(scopeKey, {
        displayColorPalette: { ...current.displayColorPalette, [color]: value },
        displayColorLabels: current.displayColorLabels,
      })
    },
    [scopeKey]
  )

  const updatePaletteLabel = React.useCallback(
    (color: DisplayColor, value: string) => {
      const current = getPreferences(scopeKey)
      setPreferences(scopeKey, {
        displayColorPalette: current.displayColorPalette,
        displayColorLabels: { ...current.displayColorLabels, [color]: value },
      })
    },
    [scopeKey]
  )

  const resetPreferences = React.useCallback(() => {
    setPreferences(scopeKey, defaultPreferences())
  }, [scopeKey])

  return {
    displayColorPalette: preferences.displayColorPalette,
    displayColorLabels: preferences.displayColorLabels,
    resetPreferences,
    updatePaletteColor,
    updatePaletteLabel,
  }
}