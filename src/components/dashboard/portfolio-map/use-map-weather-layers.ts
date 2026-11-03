"use client"

import * as React from "react"
import type { PortfolioMapJob } from "@/lib/portfolio-map/model"
import {
  ALL_WEATHER_SUBLAYERS,
  NO_LAYERS,
  readStoredLayers,
  readStoredWeatherSublayers,
  storeLayers,
  storeWeatherSublayers,
  type PortfolioLayerState,
} from "@/components/dashboard/portfolio-map/portfolio-layers"
import { jobWeatherRows, type PortfolioWeatherPanelData } from "@/components/dashboard/portfolio-map/portfolio-weather-panel"
import type { PortfolioWeatherProps } from "@/components/dashboard/portfolio-map/portfolio-terrain"
import type { WeatherSublayers } from "@/components/dashboard/portfolio-map/portfolio-weather-scene"
import { usePortfolioFires, usePortfolioWeather } from "@/components/dashboard/portfolio-map/use-portfolio-weather"
import { DEFAULT_WEATHER_LIMITS } from "@/lib/weather/layer"

/**
 * Weather and Fire & smoke for the client and trade partner maps: the layer
 * menu state, the data (loaded only while a layer is on), and the panel list.
 */
export function useMapWeatherLayers(jobs: readonly PortfolioMapJob[], mapShown: boolean): {
  readonly layers: { readonly state: PortfolioLayerState; readonly settings: null; readonly onChange: (next: PortfolioLayerState) => void }
  readonly weather: PortfolioWeatherProps
  readonly panel: PortfolioWeatherPanelData | null
} {
  const [state, setState] = React.useState<PortfolioLayerState>(NO_LAYERS)
  const [parts, setParts] = React.useState<WeatherSublayers>(ALL_WEATHER_SUBLAYERS)
  const [step, setStep] = React.useState(0)
  React.useEffect(() => {
    const stored = readStoredLayers()
    setState({ ...NO_LAYERS, weather: stored.weather, fire: stored.fire })
    setParts(readStoredWeatherSublayers())
  }, [])
  const onChange = React.useCallback((next: PortfolioLayerState): void => {
    setState(next)
    // Keep the office map's other layer choices as they were.
    storeLayers({ ...readStoredLayers(), weather: next.weather, fire: next.fire })
  }, [])
  const onParts = React.useCallback((next: WeatherSublayers): void => {
    setParts(next)
    storeWeatherSublayers(next)
  }, [])
  const ids = React.useMemo(() => jobs.map((job) => job.id), [jobs])
  const weatherOn = state.weather && mapShown
  const fireOn = state.fire && mapShown
  const weatherLayer = usePortfolioWeather(weatherOn, ids)
  const fireLayer = usePortfolioFires(fireOn, ids)
  const limits = weatherLayer.limits ?? fireLayer.limits
  const weather = React.useMemo<PortfolioWeatherProps>(
    () => ({ weather: weatherLayer.data, fire: fireLayer.data, limits, parts, onParts, error: weatherLayer.error, step, onStep: setStep }),
    [fireLayer.data, limits, onParts, parts, step, weatherLayer.data, weatherLayer.error],
  )
  const panel = React.useMemo<PortfolioWeatherPanelData | null>(() => {
    if (!weatherOn && !fireOn) return null
    const weatherData = weatherOn ? weatherLayer.data : null
    const fireData = fireOn ? fireLayer.data : null
    const at = Math.min(step, (weatherData?.steps ?? 1) - 1)
    return {
      title: weatherOn ? "WEATHER ON YOUR JOBS" : "FIRE & SMOKE NEAR YOUR JOBS",
      emptyText: weatherOn ? (weatherData ? "Nothing over the weather limits in the 24 hours from this time." : "Loading weather…") : fireData ? "No fire, smoke or poor air near." : "Loading fire and smoke…",
      rows: weatherData || fireData ? jobWeatherRows(jobs, weatherData, fireData, limits ?? DEFAULT_WEATHER_LIMITS, at, Date.now()) : [],
    }
  }, [fireLayer.data, fireOn, jobs, limits, step, weatherLayer.data, weatherOn])
  const layers = React.useMemo(() => ({ state, settings: null, onChange }), [onChange, state])
  return { layers, weather, panel }
}
