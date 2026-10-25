"use client"

import * as React from "react"
import { getPortfolioFires, getPortfolioWeather } from "@/app/actions/portfolio-weather"
import type { FireLayerData, WeatherLayerData, WeatherLimits } from "@/lib/weather/layer"

type LayerState<T> = {
  readonly data: T | null
  readonly limits: WeatherLimits | null
  readonly error: string | null
}

const REFRESH_MS = 10 * 60 * 1000
const WARMING_RETRY_MS = 60 * 1000

/**
 * Loads a map layer's data only while the layer is on, refreshing every 10
 * minutes while the page is visible (every minute while forecasts are still
 * being gathered for the first time).
 */
function useLayerData<T>(enabled: boolean, reloadKey: string, load: () => Promise<{ success: true; data: T; limits: WeatherLimits } | { success: false; error: string }>, warming: (data: T) => boolean): LayerState<T> {
  const [state, setState] = React.useState<LayerState<T>>({ data: null, limits: null, error: null })
  const loadRef = React.useRef(load)
  loadRef.current = load
  const warmingRef = React.useRef(warming)
  warmingRef.current = warming

  React.useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const run = async (): Promise<void> => {
      if (document.visibilityState === "hidden") {
        timer = setTimeout(() => void run(), REFRESH_MS)
        return
      }
      const result = await loadRef.current()
      if (cancelled) return
      if (result.success) {
        setState({ data: result.data, limits: result.limits, error: null })
        timer = setTimeout(() => void run(), warmingRef.current(result.data) ? WARMING_RETRY_MS : REFRESH_MS)
      } else {
        setState((current) => ({ ...current, error: result.error }))
        timer = setTimeout(() => void run(), REFRESH_MS)
      }
    }
    void run()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [enabled, reloadKey])

  return state
}

export function usePortfolioWeather(enabled: boolean, projectIds: readonly string[]): LayerState<WeatherLayerData> {
  // Reload when the set of jobs changes, not on every render.
  const key = [...projectIds].sort().join(",")
  const idsRef = React.useRef(projectIds)
  idsRef.current = projectIds
  const load = React.useCallback(() => getPortfolioWeather(idsRef.current), [])
  return useLayerData(enabled, key, load, (data) => data.warming)
}

export function usePortfolioFires(enabled: boolean, projectIds: readonly string[] = []): LayerState<FireLayerData> {
  const key = [...projectIds].sort().join(",")
  const idsRef = React.useRef(projectIds)
  idsRef.current = projectIds
  const load = React.useCallback(() => getPortfolioFires(idsRef.current), [])
  return useLayerData(enabled, key, load, (data) => data.updatedAt === null)
}
